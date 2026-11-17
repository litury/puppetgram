import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TargetChannelsRepository } from '../../shared/database/repositories/targetChannelsRepository';
import * as schema from '../../shared/database/schema';

async function main(): Promise<void> {
  assert.ok(process.env.TEST_DATABASE_URL, 'Use an isolated TEST_DATABASE_URL');
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const namespace = `ru_source_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    for (const filename of ['001_init.sql', '002_done_views_pass.sql', '003_subscribers_pass.sql', '005_repeat_visit.sql']) {
      await client.query(readFileSync(path.join(__dirname, '../../shared/database/migrations', filename), 'utf8'));
    }
    await client.query(`INSERT INTO target_channels(username,title)
      SELECT 'foreign_'||sequence,'Ўзбекистон янгиликлари бу каналда' FROM generate_series(1,1001) sequence;
      INSERT INTO target_channels(username,title,status,comments_state,channel_meta,parsed) VALUES
      ('russian','Книги и новости для читателей нашего канала','new','open','{"about":"Новости и истории для читателей","linkedChatId":"123"}',false),
      ('latin_title','Developer','done',null,'{"about":"Мы рассказываем про технологии и разработку программ для людей"}',false),
      ('persian','ایران برندینگ','new','open',null,false),
      ('parsed','Книги и новости для читателей нашего канала','new','open',null,true);`);
    const repository = new TargetChannelsRepository();
    (repository as any).p_db = drizzle(client, { schema });
    const names = async (limit = 10) => (await repository.getUnparsedRussianSources(limit)).map(row => row.username);
    assert.deepEqual(await names(), ['russian', 'latin_title']);
    assert.deepEqual(await names(1), ['russian']);
    assert.equal((await repository.getUnparsed(1)).length, 1);
    await assert.rejects(repository.getUnparsedRussianSources(0), /Invalid/);
    await repository.deferRussianSource('@RUSSIAN');
    assert.deepEqual(await names(), ['latin_title']);
    const row = (await client.query("SELECT parsed,status,comments_state,channel_meta FROM target_channels WHERE username='russian'")).rows[0];
    assert.equal(row.parsed, false);
    assert.equal(row.status, 'new');
    assert.equal(row.comments_state, 'open');
    assert.equal(row.channel_meta.linkedChatId, '123');
    assert.equal(row.channel_meta.about, 'Новости и истории для читателей');
    assert.ok(Date.parse(row.channel_meta.parserSourceRuRetryAt) > Date.now() + 6 * 86400000);
    await client.query(`UPDATE target_channels SET channel_meta=channel_meta||'{"parserSourceRuRetryAt":"2020-01-01T00:00:00.000Z"}'::jsonb WHERE username='russian'`);
    assert.deepEqual(await names(), ['russian', 'latin_title']);
    console.log('Russian source queue: pagination beyond 1000, metadata, ordering, parsed exclusion, persisted deferral and unchanged channel status passed');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
