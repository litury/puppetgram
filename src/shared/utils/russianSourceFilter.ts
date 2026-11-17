const russianWords = new Set(`и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех можно при два об другой после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это как ещё всё её неё ему наш наши ваш ваши который которая которые новости канал русский русские российский россия москве москва сегодня люди жизнь работа работы мир день дня время всем привет автор видео фото книги книга истории история рецепты рецепт обучение технологии разработка программирование`.split(/\s+/));

export function isRussianSourceText(text: string, minimumLetters = 20): boolean {
  const cleaned = text.normalize('NFKC').toLowerCase()
    .replace(/(?:https?:\/\/|www\.|t\.me\/)[^\s]+/giu, ' ')
    .replace(/@[\p{L}\p{N}_]+/gu, ' ');
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  const russianLetters = cleaned.match(/[а-яё]/gu) ?? [];
  if (letters.length < minimumLetters || russianLetters.length / letters.length < 0.8) return false;
  if (/[іїєґўқғәөүұңһҳҷӣӯ]/u.test(cleaned)) return false;
  const words = cleaned.match(/[а-яё]+/gu) ?? [];
  return new Set(words.filter(word => russianWords.has(word))).size >= 2;
}

export function hasRussianSourcePosts(texts: string[]): boolean {
  const meaningful = texts.filter(text => (text.match(/\p{L}/gu) ?? []).length >= 20);
  return meaningful.length > 0 &&
    meaningful.filter(text => isRussianSourceText(text)).length / meaningful.length >= 0.6 &&
    isRussianSourceText(meaningful.join('\n'), 80);
}
