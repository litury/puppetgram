import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { CommenterRetriesRepository } from '../../shared/database/repositories/commenterRetriesRepository';
import { TargetChannelsRepository } from '../../shared/database/repositories/targetChannelsRepository';
import * as schema from '../../shared/database/schema';

async function run() {
  assert.ok(process.env.TEST_DATABASE_URL, 'Укажите изолированную TEST_DATABASE_URL');
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const namespace = `retry_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    for (const filename of ['001_init.sql', '002_done_views_pass.sql', '003_subscribers_pass.sql', '004_commenter_retries.sql', '004_commenter_retries.sql']) {
      await client.query(readFileSync(path.join(__dirname, '../../shared/database/migrations', filename), 'utf8'));
    }
    const database = drizzle(client, { schema });
    const makeRetries = () => {
      const repository = new CommenterRetriesRepository();
      (repository as any).p_db = database;
      return repository;
    };
    const retries = makeRetries();
    const targets = new TargetChannelsRepository();
    (targets as any).p_db = database;
    await client.query(`INSERT INTO target_channels (username, participants, comments_state, status, avg_views)
      VALUES ('largest', 100000, 'open', 'new', 100000), ('smaller', 1000, 'open', 'new', 1000)`);
    const now = new Date((await client.query('SELECT now() AS time')).rows[0].time).getTime();
    for (const hours of [6, 12, 24, 24]) {
      const until = await makeRetries().defer('@SENDER', '@Largest', 'SEND_AS_PEER_INVALID', 21600, 86400);
      assert.equal(until.getTime() - now, hours * 3600000);
    }
    assert.equal((await targets.getNextNewOpenBySubscribers(1, 'sender'))[0].username, 'smaller');
    assert.equal((await targets.getNextBySubscribers(1, '@SENDER'))[0].username, 'smaller');
    assert.equal((await targets.getNextBatchByStatus(1, 'new', 'sender'))[0].username, 'smaller');
    assert.equal((await targets.getNextNewOpenBySubscribers(1, 'other'))[0].username, 'largest');
    await client.query("UPDATE target_channels SET status='done'");
    assert.equal((await targets.getNextDoneByViews(1, 'sender'))[0].username, 'smaller');
    const before = (await client.query("SELECT retry_at FROM commenter_retries WHERE sender='sender'")).rows[0].retry_at;
    await retries.defer('sender', 'largest', 'temporary', 60, 900);
    assert.equal((await client.query("SELECT retry_at FROM commenter_retries WHERE sender='sender'")).rows[0].retry_at.getTime(), before.getTime());
    assert.equal(await retries.getGlobalPause('sender'), null);
    const pause = await retries.defer('sender', '', 'AI_GENERATION_FAILED:HTTP_402', 3600, 86400);
    assert.equal((await makeRetries().getGlobalPause('@SENDER'))?.getTime(), pause.getTime());
    assert.equal(await retries.getGlobalPause('other'), null);
    await retries.clear('sender', '');
    assert.equal(await retries.getGlobalPause('sender'), null);
    await client.query("UPDATE commenter_retries SET retry_at=now()-interval '1 second'");
    assert.equal((await targets.getNextDoneByViews(1, 'sender'))[0].username, 'largest');
    await retries.clear('@SENDER', '@Largest');
    await retries.defer('sender', 'largest', 'again', 21600, 86400);
    assert.equal((await client.query('SELECT attempts FROM commenter_retries')).rows[0].attempts, 1);
    console.log('Commenter retries: migration, backoff, restart, namespaces, queue filtering, expiry and clear passed');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
