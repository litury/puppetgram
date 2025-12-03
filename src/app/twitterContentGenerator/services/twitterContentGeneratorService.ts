import {
  IChannelData,
  ITwitterContentGeneratorConfig,
  ITwitterPost,
  IGenerationStats,
  IChannelMessage,
  ITwitterContentGenerator
} from '../interfaces';
import * as fs from 'fs/promises';
import * as path from 'path';

export class TwitterContentGeneratorService implements ITwitterContentGenerator {
  private readonly DEEPSEEK_PRICING = {
    inputTokenCacheHit: 0.07 / 1_000_000,    // $0.07 per 1M tokens (cache hit)
    inputTokenCacheMiss: 0.27 / 1_000_000,   // $0.27 per 1M tokens (cache miss)
    outputToken: 1.10 / 1_000_000,           // $1.10 per 1M tokens
    discountMultiplier: 0.5                  // 50% скидка в off-peak часы
  };

  private readonly TOKENS_PER_CHARACTER = 0.25; // Примерное соотношение символов к токенам

  /**
   * Удаляет эмодзи из текста
   */
  private removeEmojis(_text: string): string {
    return _text.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
  }

  /**
   * Проверяет, содержит ли сообщение медиа
   */
  private hasMedia(_message: IChannelMessage): boolean {
    const mediaIndicators = [
      '[ссылка',
      'http://',
      'https://',
      '📷',
      '🎥',
      '🖼️',
      'фото',
      'видео',
      'картинка'
    ];

    return mediaIndicators.some(indicator =>
      _message.text.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  /**
   * Генерирует Twitter-пост из сообщения канала
   */
  private async generateTwitterPost(
    _message: IChannelMessage,
    _config: ITwitterContentGeneratorConfig
  ): Promise<string> {
    const prompt = `Преобразуй этот пост из Telegram-канала в короткий Twitter-пост.

Требования:
- Коротко и ясно, в стиле Twitter (ориентируйся на ${_config.maxPostLength} символов)
- Не используй кавычки
- Избегай длинных предложений
- Не добавляй хэштеги и счетчики дней вроде "День N"

Исходный пост:
"${_message.text}"

Twitter-пост:`;

    const base = _config.baseUrl || 'https://api.deepseek.com/v1';
    const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_config.apiKey}`
      },
      body: JSON.stringify({
        model: _config.model || 'deepseek-chat',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: _config.maxTokens || 200,
        temperature: _config.temperature || 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    let generatedText = data.choices[0]?.message?.content?.trim() || '';

    // Очищаем от кавычек и лишних символов
    generatedText = generatedText.replace(/^["']|["']$/g, '').trim();

    return generatedText;
  }

  /**
   * Оценивает параметры генерации без выполнения
   */
  async estimateGeneration(_channelData: IChannelData): Promise<IGenerationStats> {
    const messagesWithText = _channelData.messages.filter(msg =>
      msg.text && msg.text.trim().length > 20
    );

    const messagesSkipped = _channelData.messages.length - messagesWithText.length;

    // Примерная оценка токенов
    const avgMessageLength = messagesWithText.reduce((sum, msg) => sum + msg.text.length, 0) / messagesWithText.length;
    const estimatedTokensPerMessage = avgMessageLength * this.TOKENS_PER_CHARACTER * 2; // x2 для промпта
    const totalEstimatedTokens = messagesWithText.length * estimatedTokensPerMessage;

    // Оценка стоимости (предполагаем cache miss)
    const estimatedCost = totalEstimatedTokens * this.DEEPSEEK_PRICING.inputTokenCacheMiss +
      (messagesWithText.length * 50 * this.DEEPSEEK_PRICING.outputToken); // 50 токенов на выход

    return {
      totalMessages: _channelData.messages.length,
      messagesWithText: messagesWithText.length,
      messagesSkipped,
      postsGenerated: messagesWithText.length, // Примерно
      threadsCreated: 0, // Пока не реализовано
      estimatedTokens: Math.round(totalEstimatedTokens),
      estimatedCost: Number(estimatedCost.toFixed(4))
    };
  }

  /**
   * Генерирует Twitter-посты из данных канала
   */
  async generateTwitterPosts(
    _channelData: IChannelData,
    _config: ITwitterContentGeneratorConfig,
    _batchSize?: number,
    _onBatchSave?: (_posts: ITwitterPost[]) => Promise<void> | void
  ): Promise<{ posts: ITwitterPost[]; stats: IGenerationStats }> {
    const posts: ITwitterPost[] = [];
    let messagesProcessed = 0;
    let messagesSkipped = 0;
    let threadsCreated = 0;

    console.log(`🚀 Начинаю генерацию Twitter-постов...`);
    console.log(`📊 Всего сообщений: ${_channelData.messages.length}`);

    const sortedMessages = [..._channelData.messages].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    for (const message of sortedMessages) {
      // Пропускаем сообщения без текста или слишком короткие
      if (!message.text || message.text.trim().length < 20) {
        messagesSkipped++;
        continue;
      }

      // Пропускаем сообщения с медиа если настроено
      if (_config.skipMediaPosts && this.hasMedia(message)) {
        messagesSkipped++;
        continue;
      }

      try {
        // Генерируем пост через AI
        let generatedContent = await this.generateTwitterPost(message, _config);

        // Убираем эмодзи если настроено
        if (_config.removeEmojis) {
          generatedContent = this.removeEmojis(generatedContent);
        }

        // Один пост на одно сообщение, без тредов
        posts.push({
          id: `post_${message.id}`,
          content: generatedContent,
          originalMessageId: message.id,
          originalDate: message.date,
          media: message.media || [],
          characterCount: generatedContent.length,
          isPartOfThread: false
        });

        if (_onBatchSave && _batchSize && _batchSize > 0 && posts.length % _batchSize === 0) {
          await _onBatchSave(posts.slice());
        }

        messagesProcessed++;

        if (messagesProcessed % 10 === 0) {
          console.log(`📝 Обработано сообщений: ${messagesProcessed}/${_channelData.messages.length}`);
        }

        // Небольшая задержка между запросами
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.warn(`⚠️ Ошибка обработки сообщения ${message.id}:`, error);
        messagesSkipped++;
      }
    }

    const stats: IGenerationStats = {
      totalMessages: _channelData.messages.length,
      messagesWithText: messagesProcessed + messagesSkipped,
      messagesSkipped,
      postsGenerated: posts.length,
      threadsCreated: 0,
      estimatedTokens: 0, // Будет рассчитано отдельно
      estimatedCost: 0    // Будет рассчитано отдельно
    };

    console.log(`✅ Генерация завершена!`);
    console.log(`📊 Статистика:`);
    console.log(`   • Постов создано: ${posts.length}`);
    console.log(`   • Тредов создано: ${threadsCreated}`);
    console.log(`   • Сообщений пропущено: ${messagesSkipped}`);

    return { posts, stats };
  }

  /**
   * Сохраняет посты в файл
   */
  async savePostsToFile(_posts: ITwitterPost[], _filePath: string): Promise<void> {
    const exportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        totalPosts: _posts.length,
        threadsCount: _posts.filter(p => p.isPartOfThread).length
      },
      posts: _posts.sort((a, b) => new Date(a.originalDate).getTime() - new Date(b.originalDate).getTime())
    };

    // Создаем директорию если не существует
    const dir = path.dirname(_filePath);
    await fs.mkdir(dir, { recursive: true });

    // Сохраняем JSON
    await fs.writeFile(_filePath, JSON.stringify(exportData, null, 2), 'utf-8');

    // Также создаем простой текстовый файл для удобства
    const txtPath = _filePath.replace('.json', '.txt');
    const txtContent = _posts
      .map(post => {
        const threadInfo = post.isPartOfThread ? ` [${post.threadIndex}/${post.totalThreadParts}]` : '';
        return `${post.content}${threadInfo}\n---\n`;
      })
      .join('\n');

    await fs.writeFile(txtPath, txtContent, 'utf-8');

    console.log(`💾 Посты сохранены:`);
    console.log(`   • JSON: ${_filePath}`);
    console.log(`   • TXT: ${txtPath}`);
  }
} 
