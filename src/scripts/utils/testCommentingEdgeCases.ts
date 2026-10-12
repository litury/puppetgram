import assert from "node:assert/strict";
import { Api } from "telegram";
import bigInt from "big-integer";
import { CommentPosterService } from "../../app/commentPoster/services/commentPosterService";
import { resolveDiscussion } from "../../app/commentPoster/parts/resolveDiscussion";

const channelPeer = new Api.InputPeerChannel({ channelId: bigInt(100), accessHash: bigInt(1) });
const groupPeer = new Api.InputPeerChannel({ channelId: bigInt(200), accessHash: bigInt(2) });

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

async function run() {
  let failures = 0;
  for (const test of [testRepost, testServiceEvents]) {
    try { await test(); console.log(`PASS: ${test.name}`); }
    catch (error) { failures++; console.error(`FAIL: ${test.name}`, error); }
  }
  assert.equal(failures, 0);
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
