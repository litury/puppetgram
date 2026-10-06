import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { TargetChannelsRepository } from "../../shared/database/repositories/targetChannelsRepository";
import * as schema from "../../shared/database/schema";

process.env.PROCESS_MODE = "subscribers";
const { SimpleAutoCommenter } = require("../../app/commenting/scripts/autoCommentSimple");

async function run() {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, "Укажите TEST_DATABASE_URL для изолированного PostgreSQL");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const namespace = `subscriber_test_${randomUUID().replace(/-/g, "")}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    for (const filename of ["001_init.sql", "002_done_views_pass.sql"]) {
      await client.query(readFileSync(path.join(__dirname, "../../shared/database/migrations", filename), "utf8"));
    }
    await client.query(`INSERT INTO target_channels (username, participants, comments_state, status, avg_views, done_views_pass)
      VALUES ('largest', 1000000, 'open', 'new', NULL, 99),
             ('equal_first', 5000, 'open', 'done', 10, 15),
             ('equal_second', 5000, 'open', 'error', NULL, 0),
             ('boundary', 1000, 'open', 'skipped', 999999, 0),
             ('too_small', 999, 'open', 'done', 9999999, 0),
             ('closed', 2000000, 'closed', 'done', 5, 0),
             ('unknown_state', 3000000, NULL, 'new', NULL, 0),
             ('unknown_size', NULL, 'open', 'done', 5, 0),
             ('join_required', 9000000, 'join_required', 'new', NULL, 0)`);
    const migration = readFileSync(path.join(__dirname, "../../shared/database/migrations/003_subscribers_pass.sql"), "utf8");
    await client.query(migration);
    await client.query(migration);
    const makeRepository = () => {
      const repository = new TargetChannelsRepository();
      (repository as any).p_db = drizzle(client, { schema });
      return repository;
    };
    const repository = makeRepository();
    const names = async (limit = 20) => (await repository.getNextBySubscribers(limit)).map(channel => channel.username);
    assert.deepEqual(await names(), ["largest", "equal_first", "equal_second", "boundary"]);
    assert.deepEqual(await names(2), ["largest", "equal_first"]);
    await repository.finishSubscribersVisit("@largest");
    assert.deepEqual((await makeRepository().getNextBySubscribers(2)).map(channel => channel.username), ["equal_first", "equal_second"]);
    for (const username of ["equal_first", "equal_second", "boundary"]) {
      await repository.finishSubscribersVisit(username);
    }
    assert.deepEqual(await names(), ["largest", "equal_first", "equal_second", "boundary"]);
    assert.equal((await client.query("SELECT done_views_pass FROM target_channels WHERE username='largest'")).rows[0].done_views_pass, 99);
    await repository.setCommentsState("largest", "closed");
    assert.ok(!(await names()).includes("largest"));
    await repository.setCommentsState("largest", "open");

    const commenter: any = Object.create(SimpleAutoCommenter.prototype);
    commenter.log = { info() {}, warn() {}, debug() {}, error() {}, child() { return this; } };
    commenter.targetChannelsRepo = repository;
    assert.equal((await commenter.loadChannels())[0].channelUsername, "largest");
    commenter.ensureWorkingOwner = async () => true;
    commenter.accountRotator = { getCurrentAccount: () => ({ name: "worker", commentsCount: 0 }) };
    commenter.failedCount = 0;
    commenter.usedAccounts = new Set();
    commenter.targetChannelOwner = { name: "worker" };
    commenter.commentsRepo = { async save() { assert.fail("Existing comments must not be saved as publications"); } };
    commenter.commentChannel = async () => ({ status: "existing" });
    await commenter.processChannels([{ channelUsername: "largest" }]);
    assert.equal((await client.query("SELECT subscribers_pass FROM target_channels WHERE username='largest'")).rows[0].subscribers_pass, 2);

    commenter.commentChannel = async () => { throw Object.assign(new Error("FLOOD_WAIT_60"), { code: 420, seconds: 60 }); };
    commenter.handleOwnerFloodWait = async () => {};
    await commenter.processChannels([{ channelUsername: "equal_first" }]);
    assert.equal((await client.query("SELECT subscribers_pass FROM target_channels WHERE username='equal_first'")).rows[0].subscribers_pass, 1);

    commenter.commentChannel = async () => { throw new Error("POST_SKIPPED"); };
    await commenter.processChannels([{ channelUsername: "boundary" }]);
    assert.equal((await client.query("SELECT subscribers_pass FROM target_channels WHERE username='boundary'")).rows[0].subscribers_pass, 2);
    console.log("Subscriber queue: migration, eligibility, sorting, restart, round-robin, existing comments and FLOOD_WAIT passed");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
