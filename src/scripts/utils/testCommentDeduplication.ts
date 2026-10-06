import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { Api } from "telegram";
import bigInt from "big-integer";
import { CommentPosterService } from "../../app/commentPoster/services/commentPosterService";
import { CommentsRepository } from "../../shared/database/repositories/commentsRepository";
import * as schema from "../../shared/database/schema";

process.env.TARGET_CHANNEL = "divatoz";
const { SimpleAutoCommenter } = require("../../app/commenting/scripts/autoCommentSimple");

function fixture() {
  const commenter: any = Object.create(SimpleAutoCommenter.prototype);
  const threads = new Map<number, any[]>();
  const reads: number[] = [];
  const telegram = {
    async getInputEntity() { return new Api.InputPeerChannel({ channelId: bigInt(2166891915), accessHash: bigInt(1) }); },
    async invoke(request: any) {
      reads.push(request.msgId);
      return { messages: [new Api.Message({ id: request.msgId + 1000, peerId: new Api.PeerChannel({ channelId: bigInt(99) }) } as any)] };
    },
    async *iterMessages(peer: any, options: any) {
      assert.equal(peer.channelId.toString(), "99");
      assert.equal(options.limit, undefined);
      yield* threads.get(options.replyTo - 1000) || [];
    },
  };
  commenter.client = { getClient: () => telegram };
  commenter.targetChannelInfo = { id: "1391417310", username: "divatoz" };
  commenter.commentsRepo = { async hasPublishedComment() { return false; } };
  commenter.log = { info() {}, warn() {}, error() {} };
  commenter.accountRotator = { getCurrentAccount: () => ({ name: "worker" }) };
  const check = (postId = 206) => commenter.checkExistingComment("ChuvashMemess", postId, "2166891915");
  return { commenter, telegram, threads, reads, check };
}

async function testDatabase() {
  assert.ok(process.env.TEST_DATABASE_URL, "Укажите TEST_DATABASE_URL для изолированного PostgreSQL");
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const namespace = `dedup_test_${randomUUID().replace(/-/g, "")}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    await client.query(readFileSync(path.join(__dirname, "../../shared/database/migrations/001_init.sql"), "utf8"));
    await client.query(`INSERT INTO comments (channel_username, post_id, comment_id, account_name, target_channel)
      VALUES ('ChuvashMemess', 206, 677, 'worker6', 'divatoz'),
             ('ChuvashMemess', 206, 678, 'worker1', 'divatoz'),
             ('ChuvashMemess', 207, NULL, 'worker1', 'divatoz'),
             ('ChuvashMemess', 208, 679, 'worker1', 'another_sender')`);
    const repository = new CommentsRepository();
    (repository as any).p_db = drizzle(client, { schema });
    assert.equal(await repository.hasPublishedComment("@chuvashmemess", 206, "@DIVATOZ"), true);
    assert.equal(await repository.hasPublishedComment("ChuvashMemess", 207, "divatoz"), false);
    assert.equal(await repository.hasPublishedComment("ChuvashMemess", 208, "divatoz"), false);
    assert.equal(await repository.hasPublishedComment("other_channel", 206, "divatoz"), false);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM comments")).rows[0].count, 4);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

async function run() {
  {
    const { commenter, check, reads } = fixture();
    commenter.commentsRepo.hasPublishedComment = async (...args: any[]) => {
      assert.deepEqual(args, ["ChuvashMemess", 206, "divatoz"]);
      return true;
    };
    assert.equal(await check(), true);
    assert.deepEqual(reads, []);
  }
  {
    const { threads, check, reads } = fixture();
    threads.set(206, [
      ...Array.from({ length: 150 }, (_, index) => ({ id: index, fromId: new Api.PeerUser({ userId: bigInt(1) }) })),
      { id: 677, fromId: new Api.PeerChannel({ channelId: bigInt(1391417310) }) },
    ]);
    threads.set(207, [{ id: 678, fromId: new Api.PeerChannel({ channelId: bigInt(42) }), sender: { title: "Same title" } }]);
    assert.equal(await check(206), true);
    assert.equal(await check(207), false);
    assert.deepEqual(reads, [206, 207]);
  }
  for (const failure of ["database", "discussion", "pagination", "missing_root"]) {
    const { commenter, telegram, check } = fixture();
    const fail = async () => { throw new Error("read failed"); };
    if (failure === "database") commenter.commentsRepo.hasPublishedComment = fail;
    if (failure === "discussion") telegram.invoke = fail;
    if (failure === "missing_root") telegram.invoke = async () => ({ messages: [] });
    if (failure === "pagination") telegram.iterMessages = async function* () {
      yield { id: 1 };
      throw new Error("read failed");
    };
    await assert.rejects(check(), /DUPLICATE_CHECK_FAILED/);
  }
  {
    const { telegram, check } = fixture();
    telegram.invoke = async () => { throw Object.assign(new Error("FLOOD_WAIT"), { code: 420, seconds: 90 }); };
    await assert.rejects(check(), (error: any) => error.code === 420 && error.seconds === 90);
  }
  const post: any = {
    id: 206, channelId: "2166891915", channelUsername: "ChuvashMemess", date: new Date(),
    text: "", hasMedia: true, mediaType: "photo", mediaBase64: "test", views: 50, reactions: 3,
  };
  {
    const { commenter } = fixture();
    let sent = 0;
    commenter.commentPoster = {
      async extractPostContentAsync() { return post; },
      async postCommentsWithAIAsync(options: any) {
        sent++;
        assert.equal(options.targets[0].targetPostId, 206);
        assert.equal(options.targets[0].preparedPost, post);
        return { successfulComments: 1, results: [{ postId: 206, postedMessageId: 700 }] };
      },
    };
    commenter.checkExistingComment = async (...args: any[]) => {
      assert.deepEqual(args, ["ChuvashMemess", 206, "2166891915"]);
      return false;
    };
    assert.equal((await commenter.commentChannel({ channelUsername: "ChuvashMemess" })).postId, 206);
    commenter.checkExistingComment = async () => true;
    assert.deepEqual(await commenter.commentChannel({ channelUsername: "ChuvashMemess" }), { status: "existing" });
    commenter.checkExistingComment = async () => { throw new Error("DUPLICATE_CHECK_FAILED"); };
    await assert.rejects(commenter.commentChannel({ channelUsername: "ChuvashMemess" }), /DUPLICATE_CHECK_FAILED/);
    assert.equal(sent, 1);
  }
  {
    const service: any = new CommentPosterService({} as any);
    let sent = 0;
    service.extractPostContentAsync = async () => { throw new Error("Must not select another post"); };
    service.postCommentAsync = async (...args: any[]) => {
      assert.equal(args[3], 206);
      sent++;
      return 700;
    };
    const options: any = {
      targets: [{ channelUsername: "ChuvashMemess", targetPostId: 206, preparedPost: post }],
      messages: [], useAI: true, dryRun: false,
      aiGenerator: { async generateCommentAsync() { return { comment: "Test", success: true, isValid: true }; } },
    };
    assert.equal((await service.postCommentsWithAIAsync(options)).successfulComments, 1);
    options.targets[0].targetPostId = 207;
    const rejected = await service.postCommentsWithAIAsync(options);
    assert.equal(rejected.successfulComments, 0);
    assert.match(rejected.results[0].error, /POST_ID_MISMATCH/);
    assert.equal(sent, 1);
  }
  await testDatabase();
  console.log("PASS: дедупликация по посту, полная ветка, ошибки, pinned vision и PostgreSQL");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
