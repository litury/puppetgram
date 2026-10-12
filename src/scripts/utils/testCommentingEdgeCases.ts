import assert from "node:assert/strict";
import { Api } from "telegram";
import bigInt from "big-integer";
import { CommentPosterService } from "../../app/commentPoster/services/commentPosterService";
import { resolveDiscussion } from "../../app/commentPoster/parts/resolveDiscussion";

const channelPeer = new Api.InputPeerChannel({ channelId: bigInt(100), accessHash: bigInt(1) });
const groupPeer = new Api.InputPeerChannel({ channelId: bigInt(200), accessHash: bigInt(2) });
const senderPeer = new Api.InputPeerChannel({ channelId: bigInt(300), accessHash: bigInt(3) });

function post(id: number, text = "Текст последней публикации") {
  return new Api.Message({ id, message: text, date: 1700000000, peerId: new Api.PeerChannel({ channelId: bigInt(100) }) } as any);
}

async function testRepost() {
  const root = post(50);
  root.peerId = new Api.PeerChannel({ channelId: bigInt(200) });
  root.fromId = new Api.PeerChannel({ channelId: bigInt(100) });
  root.fwdFrom = new Api.MessageFwdHeader({ date: 1, fromId: new Api.PeerChannel({ channelId: bigInt(999) }), channelPost: 7 });
  const client: any = {
    async getInputEntity(peer: any) { return typeof peer === "string" ? channelPeer : groupPeer; },
    async invoke() { return { messages: [post(60), root] }; },
  };
  assert.equal((await (resolveDiscussion as any)(client, "target", 10, "200")).rootMessageId, 50);
  await assert.rejects((resolveDiscussion as any)(client, "target", 10, "201"), /DISCUSSION_MISMATCH/);
  root.fromId = new Api.PeerChannel({ channelId: bigInt(777) });
  await assert.rejects(resolveDiscussion(client, "target", 10), /DISCUSSION_MISMATCH/);
}

async function testServiceEvents() {
  const serviceEvent = new Api.MessageService({ id: 20, date: 1, peerId: new Api.PeerChannel({ channelId: bigInt(100) }), action: new Api.MessageActionPinMessage() });
  const calls: any[] = [];
  const service = new CommentPosterService({
    async getEntity() { return { id: bigInt(100), title: "Test" }; },
    async getMessages(_peer: any, options: any) {
      calls.push(options);
      return options.limit === 1 || options.ids ? [serviceEvent] : [post(19, "Короткий"), post(18)];
    },
  } as any);
  assert.equal((await service.extractPostContentAsync("target")).id, 19);
  assert.deepEqual(calls, [{ limit: 1 }, { limit: 10, offsetId: 20 }]);
  await assert.rejects(service.extractPostContentAsync("target", 20), /POST_SKIPPED/);
  const missing = new CommentPosterService({
    async getEntity() { return { id: bigInt(100) }; },
    async getMessages() { return [new Api.MessageEmpty({ id: 20 })]; },
  } as any);
  await assert.rejects(missing.extractPostContentAsync("target", 20), /MSG_ID_INVALID.*20/);
}

async function testSendAs() {
  let lookups = 0;
  let sends = 0;
  let premium = true;
  let allowed = false;
  let rejectSend = true;
  let lookupError: Error | undefined;
  const client: any = {
    async getInputEntity(peer: any) { return peer === "sender" ? senderPeer : typeof peer === "string" ? channelPeer : peer; },
    async getEntity() { return senderPeer; },
    async getMe() { return new Api.User({ id: bigInt(1), premium }); },
    async invoke(request: any) {
      if (request instanceof Api.channels.GetSendAs) {
        lookups++;
        assert.ok(request.peer instanceof Api.InputPeerChannel);
        assert.equal(request.peer.channelId.toString(), "200");
        if (lookupError) throw lookupError;
        return {
          peers: allowed ? [new Api.SendAsPeer({ peer: new Api.PeerChannel({ channelId: bigInt(300) }), premiumRequired: true })] : [],
          chats: [new Api.Channel({ id: bigInt(300), title: "Not proof of eligibility", photo: new Api.ChatPhotoEmpty(), date: 1 } as any)],
        };
      }
      assert.ok(request instanceof Api.messages.SendMessage);
      sends++;
      if (!rejectSend) return { updates: [{ message: { id: 901 } }] };
      throw Object.assign(new Error("SEND_AS_PEER_INVALID"), { errorMessage: "SEND_AS_PEER_INVALID" });
    },
  };
  const service: any = new CommentPosterService(client);
  service.setActiveAccount("worker1");
  assert.equal(await service.canSendAsChannelAsync("300", groupPeer), false);
  assert.equal(await service.canSendAsChannelAsync("300", groupPeer), false);
  assert.equal(lookups, 1);
  const discussion = { channelUsername: "target", postId: 10, peer: groupPeer, rootMessageId: 50 };
  await assert.rejects(service.postCommentAsync("target", "Text", { useChannelAsSender: true, selectedChannelId: "sender" }, 10, discussion), /SEND_AS_PEER_INVALID.*available=false/);
  assert.equal(sends, 1);
  assert.equal(lookups, 1);
  service.setActiveAccount("worker2");
  allowed = true;
  assert.equal(await service.canSendAsChannelAsync("300", groupPeer), true);
  premium = false;
  assert.equal(await service.canSendAsChannelAsync("300", groupPeer), false);
  assert.equal(lookups, 2);
  service.setActiveAccount("worker3");
  lookupError = Object.assign(new Error("FLOOD_WAIT_90"), { code: 420, seconds: 90 });
  await assert.rejects(service.canSendAsChannelAsync("300", groupPeer), (error: any) => error.seconds === 90);
  await assert.rejects(service.postCommentAsync("target", "Text", { useChannelAsSender: true, selectedChannelId: "sender" }, 10, discussion), (error: any) => error.seconds === 90);
  assert.equal(sends, 2);
  service.setActiveAccount("worker4");
  lookupError = undefined;
  rejectSend = false;
  const lookupsBeforeSuccess = lookups;
  assert.equal(await service.postCommentAsync("target", "Text", { useChannelAsSender: true, selectedChannelId: "sender" }, 10, discussion), 901);
  assert.equal(lookups, lookupsBeforeSuccess);
  premium = true;
  await service.canSendAsChannelAsync("300", groupPeer);
  for (const cached of service.p_sendAsPermissions.values()) cached.expiresAt = 0;
  await service.canSendAsChannelAsync("300", groupPeer);
  assert.equal(lookups, lookupsBeforeSuccess + 2);
}

async function run() {
  let failures = 0;
  for (const test of [testRepost, testServiceEvents, testSendAs]) {
    try { await test(); console.log(`PASS: ${test.name}`); }
    catch (error) { failures++; console.error(`FAIL: ${test.name}`, error); }
  }
  assert.equal(failures, 0);
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
