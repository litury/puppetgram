import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TargetChannelsRepository } from '../../shared/database/repositories/targetChannelsRepository';
import * as schema from '../../shared/database/schema';

process.env.PROCESS_MODE = 'repeat';
process.env.REPEAT_MIN_SUBSCRIBERS = '500';
process.env.TARGET_CHANNEL = '@sender';
const { SimpleAutoCommenter } = require('../../app/commenting/scripts/autoCommentSimple');

async function run() {
  assert.ok(process.env.TEST_DATABASE_URL, 'Use an isolated TEST_DATABASE_URL');
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const namespace = `repeat_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    for (const filename of ['001_init.sql', '002_done_views_pass.sql', '003_subscribers_pass.sql', '004_commenter_retries.sql', '005_repeat_visit.sql', '005_repeat_visit.sql']) {
      await client.query(readFileSync(path.join(__dirname, '../../shared/database/migrations', filename), 'utf8'));
    }
    await client.query(`INSERT INTO target_channels (username,participants,comments_state,status) VALUES
      ('oldest',500,'open','done'), ('second',999,'open','done'), ('recent',900000,'open','done'),
      ('small',499,'open','done'), ('closed',10000,'closed','done'), ('new',10000,'open','new'),
      ('error',10000,'open','error'), ('skipped',10000,'open','skipped'), ('no_history',10000,'open','done'),
      ('other_sender',10000,'open','done'), ('failed_send',10000,'open','done'), ('unknown_size',NULL,'open','done')`);
    await client.query(`INSERT INTO comments (channel_username,post_id,comment_id,account_name,target_channel,created_at)
      SELECT username,1,1,'worker','sender',timestamp '2026-01-01' FROM target_channels
      WHERE username NOT IN ('no_history','other_sender','failed_send');
      UPDATE comments SET channel_username='@Oldest',target_channel='@SENDER' WHERE channel_username='oldest';
      UPDATE comments SET created_at=timestamp '2026-01-02' WHERE channel_username='second';
      INSERT INTO comments(channel_username,post_id,comment_id,account_name,target_channel,created_at) VALUES
      ('recent',2,2,'worker','sender',timestamp '2026-02-01'),
      ('other_sender',1,1,'worker','another',timestamp '2025-01-01'),
      ('failed_send',1,NULL,'worker','sender',timestamp '2025-01-01');`);
    const makeRepository = () => {
      const repository = new TargetChannelsRepository();
      (repository as any).p_db = drizzle(client, { schema });
      return repository;
    };
    const repository = makeRepository();
    const names = async (limit = 20) => (await makeRepository().getNextRepeatByLastComment(limit, '@SENDER', 500)).map(row => row.username);
    assert.deepEqual(await names(), ['oldest', 'second', 'recent']);
    assert.deepEqual((await repository.getNextRepeatByLastComment(20, 'sender', 1000)).map(row => row.username), ['recent']);
    await assert.rejects(repository.getNextRepeatByLastComment(20, '', 500), /Invalid/);
    await assert.rejects(repository.getNextRepeatByLastComment(20, 'sender', NaN), /Invalid/);
    await client.query("INSERT INTO commenter_retries(sender,channel_username,retry_at,reason) VALUES('sender','oldest',now()+interval '1 hour','test')");
    assert.deepEqual(await names(1), ['second']);
    await client.query('DELETE FROM commenter_retries');
    await repository.finishRepeatVisit('@oldest');
    assert.deepEqual(await names(), ['second', 'recent']);
    await client.query("UPDATE target_channels SET last_repeat_visit_at=(now() AT TIME ZONE 'UTC')-interval '7 hours' WHERE username='oldest'");
    assert.deepEqual(await names(), ['second', 'recent', 'oldest']);
    await client.query("UPDATE target_channels SET last_repeat_visit_at=NULL");

    const commenter: any = Object.create(SimpleAutoCommenter.prototype);
    commenter.log = { info() {}, warn() {}, debug() {}, error() {}, child() { return this; } };
    commenter.targetChannelsRepo = repository;
    commenter.retriesRepo = { async clear() {}, async defer() { return new Date(); } };
    commenter.ensureWorkingOwner = async () => true;
    commenter.accountRotator = { getCurrentAccount: () => ({ name: 'worker', commentsCount: 0 }) };
    commenter.targetChannelOwner = { name: 'worker' };
    commenter.failedCount = 0;
    commenter.usedAccounts = new Set();
    commenter.commentsRepo = { async save() { assert.fail('Existing comment must not be saved again'); } };
    assert.equal((await commenter.loadChannels())[0].channelUsername, 'oldest');
    commenter.commentChannel = async () => ({ status: 'existing' });
    await commenter.processChannels([{ channelUsername: 'oldest' }]);
    assert.deepEqual(await names(), ['second', 'recent']);
    for (const failure of ['POST_SKIPPED', 'MSG_ID_INVALID', 'DISCUSSION_UNAVAILABLE']) {
      await client.query("UPDATE target_channels SET last_repeat_visit_at=NULL WHERE username='second'");
      commenter.commentChannel = async () => { throw new Error(failure); };
      await commenter.processChannels([{ channelUsername: 'second' }]);
      const row = (await client.query("SELECT status,last_repeat_visit_at FROM target_channels WHERE username='second'")).rows[0];
      assert.equal(row.status, 'done');
      assert.ok(row.last_repeat_visit_at);
      assert.ok(!(await names()).includes('second'));
    }
    await client.query("UPDATE target_channels SET last_repeat_visit_at=NULL WHERE username='second'");
    commenter.handleOwnerFloodWait = async () => {};
    commenter.commentChannel = async () => { throw Object.assign(new Error('FLOOD_WAIT_60'), { code: 420, seconds: 60 }); };
    await commenter.processChannels([{ channelUsername: 'second' }]);
    assert.equal((await client.query("SELECT last_repeat_visit_at FROM target_channels WHERE username='second'")).rows[0].last_repeat_visit_at, null);
    commenter.commentChannel = async () => { throw new Error('AI_GENERATION_FAILED:HTTP_402'); };
    await commenter.processChannels([{ channelUsername: 'second' }]);
    assert.equal((await client.query("SELECT last_repeat_visit_at FROM target_channels WHERE username='second'")).rows[0].last_repeat_visit_at, null);
    console.log('Repeat queue: sender history, oldest-last-comment, 500 boundary, pauses, restart, cooldown, skipped posts and FLOOD_WAIT passed');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
