import assert from "node:assert/strict";
import { Api } from "telegram";
import bigInt from "big-integer";
import { CommentPosterService } from "../../app/commentPoster/services/commentPosterService";
import { resolveDiscussion } from "../../app/commentPoster/parts/resolveDiscussion";

function message(id: number, text = "", groupedId?: number) {
  return new Api.Message({
    id, message: text, date: 1700000000,
    peerId: new Api.PeerChannel({ channelId: bigInt(100) }),
    groupedId: groupedId === undefined ? undefined : bigInt(groupedId),
  } as any);
}

async function run() {
  {
    const calls: any[] = [];
    const service = new CommentPosterService({
      async getEntity() { return { id: bigInt(100), title: "Test" }; },
      async getMessages(_peer: any, options: any) {
        calls.push(options);
        return [message(209, "Короткий")];
      },
    } as any);
    const post = await service.extractPostContentAsync("test");
    assert.equal(post.id, 209);
    assert.equal(post.text, "Короткий");
    assert.deepEqual(calls, [{ limit: 1 }]);
    await assert.rejects(service.extractPostContentAsync("test", 208), /MSG_ID_INVALID/);
  }
  {
    const calls: any[] = [];
    const latest = message(209, "", 10);
    const root = message(207, "Это подпись последнего альбома, не предыдущий пост", 10);
    root.replies = new Api.MessageReplies({ replies: 0, repliesPts: 0, comments: true, channelId: bigInt(200) });
    const service = new CommentPosterService({
      async getEntity() { return { id: bigInt(100), title: "Test" }; },
      async getMessages(_peer: any, options: any) {
        calls.push(options);
        return options.limit === 1 ? [latest] : [latest, message(208, "", 10), root, message(206, "Не выбирать предыдущий пост")];
      },
    } as any);
    const post = await service.extractPostContentAsync("test");
    assert.equal(post.id, 207);
    assert.equal(post.discussionChannelId, "200");
    assert.equal(post.text, root.message);
    assert.deepEqual(post.publicationPostIds, [207, 208, 209]);
    assert.deepEqual(calls, [{ limit: 1 }, { limit: 10, offsetId: 210 }]);
  }
  {
    const root = message(500);
    root.peerId = new Api.PeerChannel({ channelId: bigInt(200) });
    root.fwdFrom = new Api.MessageFwdHeader({ date: 1700000000, fromId: new Api.PeerChannel({ channelId: bigInt(100) }), channelPost: 209 });
    const newer = message(505);
    newer.peerId = root.peerId;
    let discussionCalls = 0;
    const sent: any[] = [];
    const client: any = {
      async getInputEntity(peer: any) {
        return new Api.InputPeerChannel({ channelId: peer instanceof Api.PeerChannel ? peer.channelId : bigInt(100), accessHash: bigInt(1) });
      },
      async invoke(request: any) {
        if (request instanceof Api.messages.GetDiscussionMessage) {
          discussionCalls++;
          return { messages: [newer, root] };
        }
        assert.ok(request instanceof Api.messages.SendMessage);
        sent.push(request);
        return { updates: [{ message: { id: 900 } }] };
      },
    };
    const discussion = await resolveDiscussion(client, "test", 209);
    assert.equal(discussion.rootMessageId, 500);
    const service: any = new CommentPosterService(client);
    assert.equal(await service.postCommentAsync("test", "Комментарий", undefined, 209, discussion), 900);
    assert.equal(discussionCalls, 1);
    assert.equal(sent[0].replyTo.replyToMsgId, 500);
    assert.equal(sent[0].peer.channelId.toString(), "200");
    await assert.rejects(service.postCommentAsync("test", "Комментарий", undefined, 210, discussion), /DISCUSSION_MISMATCH/);
    client.invoke = async () => ({ messages: [] });
    await assert.rejects(resolveDiscussion(client, "test", 209), /DISCUSSION_UNAVAILABLE.*stage=messages.GetDiscussionMessage/);
    client.invoke = async () => { throw Object.assign(new Error("MSG_ID_INVALID"), { code: 400 }); };
    await assert.rejects(resolveDiscussion(client, "test", 209), /MSG_ID_INVALID.*stage=messages.GetDiscussionMessage.*postId=209/);
  }
  console.log("PASS: latest-only, album, discussion root, pinned send and diagnostic context");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
