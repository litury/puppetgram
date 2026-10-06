import assert from "node:assert/strict";
import { Api } from "telegram";
import bigInt from "big-integer";

process.env.ROTATION_TARGET_ACCOUNT = "viknick7";
const { SimpleAutoCommenter } = require("../../app/commenting/scripts/autoCommentSimple");

function makeAccount(name: string) {
  return { name, username: name, password: "test-only", commentsCount: 0, isActive: false };
}

function fixture() {
  const keeper = makeAccount("viknick7");
  const worker = makeAccount("pravku33");
  const spare = makeAccount("pravku32");
  const accounts = [keeper, worker, spare];
  const transfers: string[] = [];
  const marked: string[] = [];
  const queried: string[] = [];
  const premiums = new Map(accounts.map(account => [account.name, true]));
  const commenter: any = Object.create(SimpleAutoCommenter.prototype);
  let active = keeper;
  commenter.targetChannelOwner = keeper;
  commenter.targetChannelInfo = { id: "test-channel" };
  commenter.floodWaitAccounts = new Map();
  commenter.spammedAccounts = new Set();
  commenter.noPremiumAccounts = new Set();
  commenter.premiumCheckedAt = new Map();
  commenter.connectedAccountName = keeper.name;
  commenter.log = { info() {}, warn() {}, debug() {}, error() {}, child() { return this; } };
  commenter.accountsRepo = { async markNoPremium(name: string) { marked.push(name); } };
  commenter.bansRepo = { async addBan() {} };
  commenter.floodWaitRepo = { async setFloodWait() {}, async removeFloodWait() {} };
  commenter.accountRotator = {
    getAllAccounts: () => accounts,
    getCurrentAccount: () => active,
    setActiveAccount(name: string) { active = accounts.find(account => account.name === name)!; },
    resetAccountComments() {},
  };
  commenter.client = { getClient: () => ({
    async getMe() {
      queried.push(commenter.connectedAccountName);
      return new Api.User({ id: bigInt(1), premium: premiums.get(commenter.connectedAccountName) });
    },
  }) };
  commenter.spamChecker = { async isAccountSpammedReliable() { return false; } };
  commenter.connectAccount = async (account: typeof worker) => {
    commenter.connectedAccountName = account.name;
  };
  commenter.refreshTargetChannelInfo = async () => {};
  commenter.transferChannel = async (from: typeof worker, to: typeof worker) => {
    transfers.push(`${from.name}->${to.name}`);
    commenter.targetChannelOwner = to;
    commenter.accountRotator.setActiveAccount(to.name);
  };
  return { commenter, keeper, worker, spare, transfers, marked, queried, premiums };
}

async function run() {
  {
    const { commenter, keeper, worker, transfers, queried } = fixture();
    commenter.spammedAccounts.add(keeper.name);
    commenter.floodWaitAccounts.set(keeper.name, new Date(Date.now() + 60000));
    assert.equal(await commenter.ensureWorkingOwner(), true);
    assert.equal(commenter.targetChannelOwner.name, worker.name);
    assert.deepEqual(transfers, [`${keeper.name}->${worker.name}`]);
    assert.ok(!queried.includes(keeper.name));
    commenter.accountRotator.setActiveAccount(keeper.name);
    await assert.rejects(commenter.commentChannel({}), /Хранитель канала/);
  }
  {
    const { commenter, keeper, worker, spare, transfers } = fixture();
    commenter.targetChannelOwner = worker;
    commenter.spammedAccounts.add(keeper.name);
    commenter.spammedAccounts.add(spare.name);
    commenter.floodWaitAccounts.set(keeper.name, new Date(Date.now() + 120000));
    commenter.floodWaitAccounts.set(worker.name, new Date(Date.now() + 60000));
    commenter.waitForAccountUnlock = async () => {
      assert.equal(commenter.targetChannelOwner.name, keeper.name);
      commenter.floodWaitAccounts.set(worker.name, new Date(Date.now() - 1));
      return worker;
    };
    assert.equal(await commenter.ensureWorkingOwner(), true);
    assert.deepEqual(transfers, [`${worker.name}->${keeper.name}`, `${keeper.name}->${worker.name}`]);
    assert.equal(commenter.floodWaitAccounts.has(worker.name), false);
  }
  {
    const { commenter, keeper, worker, spare } = fixture();
    commenter.spammedAccounts.add(worker.name);
    commenter.noPremiumAccounts.add(spare.name);
    assert.equal(await commenter.ensureWorkingOwner(), false);
    assert.equal(commenter.targetChannelOwner.name, keeper.name);
    assert.equal(commenter.hasAvailableAccounts(), false);
  }
  {
    const { commenter, keeper, worker, spare } = fixture();
    commenter.floodWaitAccounts.set(keeper.name, new Date(Date.now() - 1));
    commenter.floodWaitAccounts.set(spare.name, new Date(Date.now() - 1));
    commenter.noPremiumAccounts.add(spare.name);
    assert.equal(await commenter.waitForAccountUnlock(), null);
    commenter.floodWaitAccounts.set(worker.name, new Date(Date.now() - 1));
    assert.equal((await commenter.waitForAccountUnlock()).name, worker.name);
  }
  {
    const { commenter, worker, spare, premiums, marked } = fixture();
    premiums.set(worker.name, false);
    assert.equal(await commenter.ensureWorkingOwner(), true);
    assert.equal(commenter.targetChannelOwner.name, spare.name);
    assert.deepEqual(marked, [worker.name]);
  }
  {
    const { commenter, worker, premiums, marked, queried } = fixture();
    await commenter.connectAccount(worker);
    assert.equal(await commenter.isPremiumWorker(worker), true);
    assert.equal(await commenter.isPremiumWorker(worker), true);
    assert.equal(queried.length, 1);
    assert.equal(await commenter.isPremiumWorker(worker, true), true);
    assert.deepEqual(marked, []);
    premiums.set(worker.name, false);
    assert.equal(await commenter.isPremiumWorker(worker, true), false);
    assert.deepEqual(marked, [worker.name]);
  }
  {
    const { commenter, worker, marked } = fixture();
    await commenter.connectAccount(worker);
    commenter.client = { getClient: () => ({ async getMe() { throw new Error("RPC unavailable"); } }) };
    await assert.rejects(commenter.isPremiumWorker(worker, true), /RPC unavailable/);
    assert.deepEqual(marked, []);
    assert.equal(commenter.noPremiumAccounts.has(worker.name), false);
  }
  {
    const { commenter, worker, spare, keeper } = fixture();
    commenter.targetChannelOwner = worker;
    commenter.spammedAccounts.add(worker.name);
    commenter.spammedAccounts.add(spare.name);
    commenter.transferChannel = async () => { throw new Error("transfer failed"); };
    await assert.rejects(commenter.ensureWorkingOwner(), /transfer failed/);
    assert.notEqual(commenter.targetChannelOwner.name, keeper.name);
  }
  {
    const { commenter, worker, marked } = fixture();
    await commenter.connectAccount(worker);
    commenter.client = { getClient: () => ({
      async getMe() { throw Object.assign(new Error("FLOOD_WAIT_60"), { code: 420, seconds: 60 }); },
    }) };
    assert.equal(await commenter.isPremiumWorker(worker, true), false);
    assert.equal(commenter.hasActiveFloodWait(worker.name), true);
    assert.deepEqual(marked, []);
    assert.equal(commenter.noPremiumAccounts.has(worker.name), false);
  }
  {
    const { commenter, keeper, worker, spare, transfers } = fixture();
    commenter.targetChannelOwner = worker;
    commenter.spammedAccounts.add(spare.name);
    commenter.floodWaitAccounts.set(worker.name, new Date(Date.now() + 60000));
    const waitForUnlock = commenter.waitForAccountUnlock.bind(commenter);
    commenter.waitForAccountUnlock = async () => {
      assert.equal(commenter.targetChannelOwner.name, keeper.name);
      commenter.floodWaitAccounts.set(worker.name, new Date(Date.now() - 1));
      commenter.spamChecker.isAccountSpammedReliable = async () => true;
      commenter.waitForAccountUnlock = waitForUnlock;
      return worker;
    };
    assert.equal(await commenter.ensureWorkingOwner(), false);
    assert.deepEqual(transfers, [`${worker.name}->${keeper.name}`]);
    assert.equal(commenter.spammedAccounts.has(worker.name), true);
  }
  {
    const { commenter, keeper, worker } = fixture();
    commenter.commentPoster = { async getUserChannelsAsync() { return []; } };
    await assert.rejects(
      SimpleAutoCommenter.prototype.transferChannel.call(commenter, keeper, worker),
      /больше не владеет каналом/,
    );
    assert.equal(commenter.targetChannelOwner.name, keeper.name);
  }
  console.log("Keeper/Premium: 11 regression scenarios passed");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
