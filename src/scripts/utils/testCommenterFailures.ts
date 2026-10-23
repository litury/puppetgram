import assert from 'node:assert/strict';
import { CommentPosterService } from '../../app/commentPoster/services/commentPosterService';
import { aiFailure } from '../../app/aiCommentGenerator/parts/aiFailure';
import { AICommentGeneratorService } from '../../app/aiCommentGenerator/services/aiCommentGeneratorService';

process.env.TARGET_CHANNEL = 'test_sender';
process.env.PROCESS_MODE = 'new';
process.env.DEEPSEEK_API_KEY = 'test-only';
process.env.ROTATION_TARGET_ACCOUNT = '';
const { SimpleAutoCommenter } = require('../../app/commenting/scripts/autoCommentSimple');

function fixture() {
  const commenter: any = Object.create(SimpleAutoCommenter.prototype);
  const events: string[] = [];
  const pauses: any[][] = [];
  commenter.log = { info() {}, warn() {}, error() {}, child() { return this; } };
  commenter.ensureWorkingOwner = async () => true;
  commenter.accountRotator = { getCurrentAccount: () => ({ name: 'worker' }), incrementCommentCount() {} };
  commenter.retriesRepo = { async defer(...args: any[]) { pauses.push(args); return new Date(); }, async clear() {} };
  commenter.commentsRepo = { async save() { events.push('save'); } };
  commenter.saveSuccessfulChannel = async () => { events.push('done'); };
  commenter.saveFailedChannel = async () => { assert.fail('Infrastructure failure must not mark target error'); };
  commenter.targetChannelsRepo = { async markSkipped() { assert.fail('Infrastructure failure must not skip target'); } };
  commenter.successfulCount = 0;
  commenter.failedCount = 0;
  commenter.usedAccounts = new Set();
  return { commenter, events, pauses };
}

async function run() {
  for (const status of [402, 429, 500]) {
    const generator: any = Object.create(AICommentGeneratorService.prototype);
    generator.p_config = { enabled: true };
    generator.p_client = { chat: { completions: { async create() { throw { status }; } } } };
    const result = await generator.generateCommentAsync({ id: 1, channelUsername: 'test', text: 'Достаточно длинный пост о разработке программного обеспечения.' });
    assert.equal(result.error, `AI_GENERATION_FAILED:HTTP_${status}`);
  }
  assert.equal(aiFailure({ status: 402, message: 'private data' }), 'AI_GENERATION_FAILED:HTTP_402');
  assert.equal(aiFailure(new Error('private data')), 'AI_GENERATION_FAILED:TRANSPORT');
  for (const failure of ['AI_GENERATION_FAILED:HTTP_402', 'AI_GENERATION_FAILED:HTTP_429', 'AI_GENERATION_FAILED:TRANSPORT', 'POST_SKIPPED: sensitive']) {
    const service: any = new CommentPosterService({} as any);
    service.postCommentAsync = async () => { assert.fail('No fallback publication after AI failure'); };
    let calls = 0;
    const target = { channelUsername: 'test', preparedPost: { id: 1, channelUsername: 'test', text: 'Это достаточно длинный тестовый пост о разработке программного обеспечения.' } };
    const response = await service.postCommentsWithAIAsync({
      targets: failure.startsWith('AI_') ? [target, target] : [target],
      useAI: true, messages: [{ text: 'Must not publish' }],
      aiGenerator: { async generateCommentAsync() { calls++; return { success: false, isValid: false, comment: '', error: failure }; } },
    });
    assert.equal(calls, 1);
    assert.equal(response.successfulComments, 0);
    assert.equal(response.totalTargets, 1);
    assert.equal(response.results[0].error, failure);
  }
  for (const media of [false, true]) {
    const service: any = new CommentPosterService({} as any);
    service.postCommentAsync = async () => assert.fail('Empty AI response must not publish');
    const response = await service.postCommentsWithAIAsync({
      targets: [{ channelUsername: 'test', preparedPost: { id: 1, channelUsername: 'test', text: media ? '' : 'Достаточно длинный пост для проверки генерации комментария.', mediaBase64: media ? 'test' : undefined } }],
      useAI: true, messages: [],
      aiGenerator: { async generateCommentAsync() { return { success: true, isValid: true, comment: ' ' }; } },
    });
    assert.equal(response.results[0].error, 'AI_GENERATION_FAILED:INVALID_RESPONSE');
  }
  for (const failure of ['AI_GENERATION_FAILED:HTTP_402', 'AI_GENERATION_FAILED:HTTP_429']) {
    const { commenter, pauses, events } = fixture();
    let calls = 0;
    commenter.commentChannel = async () => { calls++; throw new Error(failure); };
    await commenter.processChannels([{ channelUsername: 'test' }, { channelUsername: 'next' }]);
    assert.equal(calls, 1);
    assert.deepEqual(events, []);
    assert.equal(pauses[0][1], '');
    assert.equal(pauses[0][3], failure.endsWith('402') ? 3600 : 60);
  }
  {
    const { commenter, pauses } = fixture();
    commenter.commentChannel = async () => { throw new Error('SEND_AS_PEER_INVALID'); };
    commenter.isPremiumWorker = async () => true;
    await commenter.processChannels([{ channelUsername: 'test' }]);
    assert.equal(pauses[0][1], 'test');
    assert.equal(pauses[0][3], 21600);
  }
  {
    const { commenter, events, pauses } = fixture();
    commenter.commentChannel = async () => ({ status: 'published', postId: 1, commentId: 2, commentText: 'Test comment' });
    await commenter.processChannels([{ channelUsername: 'test' }]);
    assert.deepEqual(events, ['save', 'done']);
    assert.equal(pauses.length, 0);
    events.length = 0;
    commenter.commentsRepo.save = async () => { throw new Error('database unavailable'); };
    await commenter.processChannels([{ channelUsername: 'test' }]);
    assert.deepEqual(events, []);
    assert.equal(pauses[0][2], 'PUBLICATION_PERSIST_FAILED');
  }
  for (const outcome of ['denied', 'unavailable', 'flood']) {
    const { commenter } = fixture();
    commenter.targetChannelInfo = { id: '123' };
    commenter.commentPoster = {
      async extractPostContentAsync() { return { id: 1, channelId: '456' }; },
      async canSendAsChannelAsync() {
        if (outcome === 'unavailable') throw new Error('network');
        if (outcome === 'flood') throw Object.assign(new Error('FLOOD_WAIT_60'), { code: 420, seconds: 60 });
        return false;
      },
      async postCommentsWithAIAsync() { assert.fail('Preflight failure must not call AI'); },
    };
    commenter.checkExistingComment = async (_channel: string, _post: number, _id: string, target: any) => {
      target.preparedDiscussion = { peer: {}, rootMessageId: 1 };
      return false;
    };
    await assert.rejects(commenter.commentChannel({ channelUsername: 'test' }), (error: any) => {
      if (outcome === 'flood') assert.equal(error.seconds, 60);
      else assert.match(error.message, outcome === 'denied' ? /SEND_AS_PEER_INVALID/ : /SEND_AS_CHECK_FAILED/);
      return true;
    });
  }
  for (const initiallyPaused of [false, true]) {
    const { commenter } = fixture();
    const stop = new Error('test complete');
    let waits = 0;
    let loads = 0;
    let batches = 0;
    commenter.log.operationStart = () => {};
    commenter.loadCommenterPool = async () => {};
    commenter.accountRotator.getAllAccounts = () => [{ name: 'worker' }];
    commenter.countSuccessfulChannels = async () => 0;
    commenter.floodWaitRepo = { async getActiveFloodWaits() { return []; } };
    commenter.floodWaitAccounts = new Map();
    commenter.spammedAccounts = new Set();
    commenter.bansRepo = { async getActiveBannedNames() { return []; } };
    commenter.findTargetChannel = async () => { commenter.targetChannelOwner = {}; commenter.targetChannelInfo = {}; };
    commenter.retriesRepo.getGlobalPause = async () => initiallyPaused && waits === 0 ? new Date(Date.now() + 60000) : null;
    commenter.transferToPinnedOwnerIfNeeded = async () => {};
    commenter.waitForWork = async () => { waits++; };
    commenter.loadChannels = async () => {
      loads++;
      if (initiallyPaused) assert.ok(waits > 0, 'Must wait before loading paused queue');
      return loads === 1 ? [] : [{ channelUsername: 'new_target' }];
    };
    commenter.processChannels = async () => { batches++; throw stop; };
    commenter.cleanup = async () => { throw stop; };
    await assert.rejects(commenter.start(), error => error === stop);
    assert.equal(loads, 2);
    assert.equal(batches, 1);
    assert.equal(waits, initiallyPaused ? 2 : 1);
  }
  console.log('Commenter failures: AI stop, no fallback, preflight, save-before-done and idle recovery passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
