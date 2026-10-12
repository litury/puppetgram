import assert from 'node:assert/strict';
import { SourcesParserService } from '../../app/sourcesParser/services/sourcesParserService';
import { IParserAccount } from '../../app/sourcesParser/interfaces';
import { AccountFloodWait } from '../../shared/database/schema';

function account(name: string): IParserAccount {
  return { name, sessionKey: name, sessionValue: '', apiId: 1, apiHash: 'test' };
}

function waitRow(name: string, unlockAt: Date): AccountFloodWait {
  return { id: 1, accountName: name, unlockAt, reason: 'test', createdAt: new Date(), updatedAt: new Date() };
}

function setup(names: string[], initialWaits: AccountFloodWait[] = []) {
  const saved = new Map(initialWaits.map(row => [row.accountName, row]));
  const connected: string[] = [];
  const repository = {
    async getActiveFloodWaits() {
      return [...saved.values()].filter(row => row.unlockAt.getTime() > Date.now());
    },
    async setFloodWait(name: string, unlockAt: Date) {
      const row = waitRow(name, unlockAt);
      saved.set(name, row);
      return row;
    },
  };
  const service = new SourcesParserService(names.map(account), repository);
  const internal = service as any;
  internal.connectAccount = async (selected: IParserAccount) => {
    connected.push(selected.name);
    return { connected: true };
  };
  return { service, internal, repository, saved, connected };
}

async function main(): Promise<void> {
  const later = new Date(Date.now() + 3_600_000);
  const startup = setup(['old', 'new'], [waitRow('old', later), waitRow('commenter-only', later)]);
  assert.equal(await startup.service.connectFirstAccount(), true);
  assert.deepEqual(startup.connected, ['new']);
  assert.equal(startup.internal.floodWaitAccounts.has('commenter-only'), false);
  assert.equal(startup.saved.get('old')?.unlockAt, later);

  const rotated = setup(['first', 'second']);
  await rotated.service.connectFirstAccount();
  assert.equal(await rotated.internal.rotateAccount(3600), true);
  assert.ok(rotated.saved.get('first')!.unlockAt.getTime() > Date.now());
  assert.deepEqual(rotated.connected, ['first', 'second']);
  const restarted = setup(['first', 'second'], [...rotated.saved.values()]);
  await restarted.service.connectFirstAccount();
  assert.deepEqual(restarted.connected, ['second']);

  const expiry = setup(['expired', 'ready']);
  expiry.internal.floodWaitAccounts.set('expired', new Date(Date.now() - 1));
  await expiry.service.connectFirstAccount();
  assert.deepEqual(expiry.connected, ['expired']);
  assert.equal(expiry.internal.floodWaitAccounts.has('expired'), false);

  const waiting = setup(['waiting'], [waitRow('waiting', later)]);
  let delayMs = 0;
  waiting.internal.delay = async (duration: number) => { delayMs = duration; };
  assert.equal(await waiting.service.connectFirstAccount(), true);
  assert.ok(delayMs >= 3_600_000 && delayMs <= 3_660_000);
  assert.deepEqual(waiting.connected, ['waiting']);

  const unavailable = setup(['revoked', 'no-premium'], [waitRow('revoked', later), waitRow('no-premium', later)]);
  unavailable.internal.revokedAccounts.add('revoked');
  unavailable.internal.noPremiumAccounts.add('no-premium');
  unavailable.internal.delay = async () => { assert.fail('Do not wait for excluded accounts'); };
  assert.equal(await unavailable.service.connectFirstAccount(), false);
  assert.deepEqual(unavailable.connected, []);

  const noOverwrite = setup(['first', 'second']);
  noOverwrite.internal.floodWaitAccounts.set('first', later);
  await noOverwrite.internal.rotateAccount();
  assert.equal(noOverwrite.internal.floodWaitAccounts.get('first'), later);
  assert.equal(noOverwrite.saved.size, 0);
  await noOverwrite.internal.saveFloodWait('first', new Date(Date.now() + 1000), 'test');
  assert.equal(noOverwrite.saved.get('first')?.unlockAt, later);

  const readFailure = setup(['ready']);
  readFailure.repository.getActiveFloodWaits = async () => { throw new Error('database unavailable'); };
  await assert.rejects(readFailure.service.connectFirstAccount(), /database unavailable/);
  assert.deepEqual(readFailure.connected, []);
  const writeFailure = setup(['first', 'second']);
  writeFailure.repository.setFloodWait = async () => { throw new Error('database unavailable'); };
  await assert.rejects(writeFailure.internal.rotateAccount(3600), /database unavailable/);
  assert.deepEqual(writeFailure.connected, []);
  assert.ok(writeFailure.internal.floodWaitAccounts.get('first') > new Date());
  console.log('Parser FLOOD persistence tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
