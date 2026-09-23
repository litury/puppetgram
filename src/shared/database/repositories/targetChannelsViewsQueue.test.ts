import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '../schema';
import { TargetChannelsRepository } from './targetChannelsRepository';

// Run against an isolated PostgreSQL with TEST_DATABASE_URL; all fixtures are TEMP.
test('done/views queue continues beyond 500 and survives restart without repeating the top', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const columns = Object.values(getTableColumns(schema.targetChannels));
    await client.query(`CREATE TEMP TABLE target_channels (${columns.map(c => `"${c.name}" ${c.getSQLType()}`).join(',')})`);
    await client.query(`INSERT INTO target_channels (id,username,status,avg_views,done_views_pass)
      SELECT i,'channel_'||i,'done',10000-i,0 FROM generate_series(1,600) i`);
    await client.query(`INSERT INTO target_channels (id,username,status,avg_views,done_views_pass) VALUES
      (601,'missing','done',NULL,0), (602,'zero','done',0,0),
      (603,'new','new',100000,0), (604,'error','error',100000,0),
      (605,'skipped','skipped',100000,0)`);
    // Missing subscriber count must not exclude an old channel with known views.
    const makeRepo = () => {
      const repo = new TargetChannelsRepository();
      (repo as any).p_db = drizzle(client, { schema });
      return repo;
    };
    const repo = makeRepo();
    const first = await repo.getNextDoneByViews(500);
    assert.deepEqual(first.map(c => c.id), Array.from({ length: 500 }, (_, i) => i + 1));
    assert.equal(first[0].participants, null);
    assert.deepEqual((await repo.getNextBatchByStatus(500, 'new')).map(c => c.id), [603]);
    // No completion acknowledgement: a FloodWait leaves the channel eligible.
    assert.equal((await makeRepo().getNextDoneByViews(1))[0].id, 1);
    for (const channel of first) await repo.finishDoneViewsVisit('@' + channel.username);
    // A metric refresh on a visited channel must not jump ahead of unfinished channels.
    await client.query(`UPDATE target_channels SET avg_views=999999 WHERE id=1`);
    const restarted = makeRepo();
    const remaining = await restarted.getNextDoneByViews(100);
    assert.deepEqual(remaining.map(c => c.id), Array.from({ length: 100 }, (_, i) => i + 501));
    for (const channel of remaining) await restarted.finishDoneViewsVisit(channel.username);
    assert.equal((await restarted.getNextDoneByViews(1))[0].id, 1);
    assert.equal((await restarted.getNextDoneByViews(1))[0].doneViewsPass, 1);
    // Deterministic ordering for equal view counts; current non-done rows disappear.
    await client.query(`UPDATE target_channels SET avg_views=999999 WHERE id=2`);
    assert.deepEqual((await restarted.getNextDoneByViews(2)).map(c => c.id), [1,2]);
    await client.query(`UPDATE target_channels SET status='error' WHERE id=1`);
    assert.equal((await restarted.getNextDoneByViews(1))[0].id, 2);
    await client.query(`UPDATE target_channels SET status='error'`);
    assert.deepEqual(await restarted.getNextDoneByViews(500), []);
  } finally {
    await client.end();
  }
});
