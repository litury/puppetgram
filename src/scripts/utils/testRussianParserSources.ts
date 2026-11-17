import assert from 'node:assert/strict';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { isRussianSourceText, hasRussianSourcePosts } from '../../shared/utils/russianSourceFilter';
import { SourcesParserService } from '../../app/sourcesParser/services/sourcesParserService';

const russian = 'Сегодня мы расскажем, как выбрать книгу для чтения. Здесь есть истории и новости, которые можно обсудить вместе.';
const persian = 'این کانال برای اخبار و مطالب آموزشی است و مطالب جدید منتشر می کند';
const uzbek = 'Kanalda Iphonega asosan kontentlar chiqadi. Biz ijod qilamiz siz esa kuzating.';
const ukrainian = 'Сьогодні ми розповімо, як обрати книгу для читання. Тут є цікаві історії та новини.';

async function main(): Promise<void> {
  assert.ok(isRussianSourceText(russian));
  assert.ok(isRussianSourceText('Книги и новости для читателей нашего канала'));
  for (const text of [persian, uzbek, ukrainian, 'Ўзбекистон янгиликлари бу каналда',
    'Which games are you playing today?', 'Apple Iphone', '@russian_news https://example.com/новости-россия']) {
    assert.equal(isRussianSourceText(text), false, text);
  }
  assert.equal(hasRussianSourcePosts([]), false);
  assert.equal(hasRussianSourcePosts(['Фото', 'Видео', 'https://example.com']), false);
  assert.ok(hasRussianSourcePosts([russian, russian, russian, russian, persian]));
  assert.equal(hasRussianSourcePosts([russian, russian, russian, persian, uzbek]), false);
  assert.equal(hasRussianSourcePosts([russian, persian, uzbek]), false);
  assert.equal(hasRussianSourcePosts([russian, ukrainian, ukrainian]), false);

  const previous = process.env.PARSER_SOURCE_LANGUAGE;
  try {
    process.env.PARSER_SOURCE_LANGUAGE = 'ru';
    const service: any = new SourcesParserService([]);
    service.delay = async () => {};
    service.repo = {
      async getAllUsernames() { return new Set(); },
      async getUnparsed() { assert.fail('Unfiltered queue must not be used'); },
      async getUnparsedRussianSources() { return [{ username: 'russian', title: 'Книги и новости' }]; },
      async getParsedStats() { return { parsed: 0, unparsed: 1 }; },
    };
    await service.loadData();
    assert.deepEqual(service.sources, [{ username: 'russian' }]);
    let recommendationCalls = 0;
    let postTexts = [russian];
    service.currentClient = {
      async invoke(request: unknown) {
        if (request instanceof Api.contacts.ResolveUsername) {
          return { chats: [{ id: bigInt(1), accessHash: bigInt(2) }] };
        }
        assert.ok(request instanceof Api.channels.GetChannelRecommendations);
        recommendationCalls++;
        return { chats: [] };
      },
      async getMessages() { return postTexts.map(message => ({ message })); },
    };
    await service.getRecommendations('russian');
    assert.equal(recommendationCalls, 1);
    for (postTexts of [[persian], [uzbek], [ukrainian], []]) {
      await assert.rejects(service.getRecommendations('foreign'), /SOURCE_LANGUAGE_REJECTED/);
    }
    assert.equal(recommendationCalls, 1);
    service.currentClient.getMessages = async () => { throw new Error('FLOOD_WAIT_60'); };
    await assert.rejects(service.getRecommendations('limited'), /FLOOD_WAIT_60/);
    let marked = false;
    let deferred = false;
    service.accounts = [{ name: 'worker' }];
    service.sources = [{ username: 'uncertain' }];
    service.repo.markParsed = async () => { marked = true; };
    service.repo.deferRussianSource = async () => { deferred = true; };
    service.getRecommendations = async () => { throw new Error('SOURCE_LANGUAGE_REJECTED'); };
    await service.parseAll();
    assert.equal(marked, false);
    assert.equal(deferred, true);
    process.env.PARSER_SOURCE_LANGUAGE = 'invalid';
    assert.throws(() => new SourcesParserService([]), /PARSER_SOURCE_LANGUAGE/);
  } finally {
    if (previous === undefined) delete process.env.PARSER_SOURCE_LANGUAGE;
    else process.env.PARSER_SOURCE_LANGUAGE = previous;
  }
  console.log('Russian parser sources: metadata, recent posts, no foreign recommendations, preserved progress and FLOOD_WAIT passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
