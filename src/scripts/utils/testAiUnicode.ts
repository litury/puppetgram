import assert from 'node:assert/strict';
import { sanitizeApiText, truncateApiText } from '../../app/aiCommentGenerator/parts/apiText';
import { buildBusinessPrompt } from '../../app/aiCommentGenerator/parts/promptBuilder';
import { buildVisionMessages } from '../../app/aiCommentGenerator/parts/visionPromptBuilder';
import { AICommentGeneratorService } from '../../app/aiCommentGenerator/services/aiCommentGeneratorService';

async function run() {
  const hasLoneSurrogate = (text: string) => /[\uD800-\uDFFF]/u.test(text);
  const source = 'а'.repeat(499) + '📒' + 'остальной текст';
  assert.equal(hasLoneSurrogate(source.substring(0, 500)), true);
  assert.equal(truncateApiText(source, 500, '...'), 'а'.repeat(499) + '📒...');
  assert.equal(sanitizeApiText('😀\uD800text\uDC00'), '😀�text�');
  assert.equal(sanitizeApiText('a\u0000\u001fb\n\t\r'), 'ab\n\t\r');
  const literals = String.raw`C:\users\x\u123\uD800 "quoted"`;
  assert.equal(sanitizeApiText(literals), literals);
  assert.equal(JSON.parse(JSON.stringify(sanitizeApiText(literals))), literals);
  for (const text of ['русский فارسی العربية हिन्दी 😀', source, '😀'.repeat(501), '\uD800\uD800\uDC00\uDC00', literals]) {
    for (const limit of [0, 1, 2, 199, 200, 499, 500]) {
      const truncated = truncateApiText(text, limit);
      assert.equal(hasLoneSurrogate(truncated), false);
      assert.ok(Array.from(truncated).length <= limit);
      assert.equal(JSON.parse(JSON.stringify(truncated)), truncated);
    }
  }
  const post: any = { id: 1, channelUsername: 'test\uD800', channelTitle: 'Title\uDC00', text: source, hashtags: ['tag\uD800'], hasMedia: true, mediaType: 'photo', mediaBase64: 'test' };
  const prompt = buildBusinessPrompt(post);
  assert.equal(hasLoneSurrogate(prompt), false);
  assert.ok(prompt.includes('📒...'));
  post.text = 'а'.repeat(199) + '📒more';
  const vision = buildVisionMessages(post);
  assert.equal(hasLoneSurrogate(vision[0].content[0].text!), false);
  assert.ok(vision[0].content[0].text!.includes('📒'));
  assert.equal(vision[0].content[1].image_url!.url, 'data:image/jpeg;base64,test');
  const generator: any = Object.create(AICommentGeneratorService.prototype);
  generator.p_config = { enabled: true };
  let requests = 0;
  generator.p_client = { chat: { completions: { async create(request: any) {
    requests++;
    assert.equal(hasLoneSurrogate(request.messages[0].content), false);
    return { choices: [{ message: { content: 'Как это работает?' } }] };
  } } } };
  post.text = source;
  assert.equal((await generator.generateCommentAsync(post)).success, true);
  assert.equal(requests, 1);
  console.log('AI Unicode: split-emoji reproduction, valid prompts, literal escapes and request payload passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
