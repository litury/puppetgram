/**
 * feedEnricherService — воркер очереди feed_jobs (MVP: без AI).
 *
 * Забирает партию (SKIP LOCKED) → для каждого поста: снимок метрик, baseline канала (медиана,
 * кэш на батч), score по формуле (ER + overperformance + time-decay) → setScore → markDone.
 * AI-слой (эмбеддинги/категории/дедуп) добавляется сюда же отдельной фазой.
 */

import { createLogger } from '../../../shared/utils/logger';
import { FeedJobsRepository } from '../../../shared/database/repositories/feedJobsRepository';
import { PostsRepository } from '../../../shared/database/repositories/postsRepository';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { scorePost } from './feedRanker';
import { totalReactions } from './postExtractor';

const log = createLogger('FeedEnricher');

export class FeedEnricherService {
  private jobs = new FeedJobsRepository();
  private posts = new PostsRepository();
  private cursors = new ChannelCursorsRepository();

  /** Обработать одну партию заданий. Возвращает число обработанных. */
  async processBatch(limit: number = 50): Promise<number> {
    const batch = await this.jobs.claimBatch(limit);
    if (batch.length === 0) return 0;

    // baseline канала кэшируем на время батча (одна медиана на канал, не на каждый пост)
    const baselineCache = new Map<number, number | null>();

    for (const job of batch) {
      try {
        const post = await this.posts.getByChannelMsg(job.channelId, job.tgMessageId);
        if (!post) {
          // listener ещё не успел записать пост — оставим job на повтор (не done)
          await this.jobs.markError(job.id, 'post_not_found_yet');
          continue;
        }

        // снимок метрик (для скорости набора/baseline во времени)
        const reactionsTotal = totalReactions((post.reactions as Record<string, number>) ?? null);
        await this.posts.recordMetricSnapshot(post.id, {
          views: post.views,
          reactions: reactionsTotal,
          forwards: post.forwards,
          repliesCount: post.repliesCount,
        });

        // baseline канала
        let baseline = baselineCache.get(job.channelId);
        if (baseline === undefined) {
          const cursor = await this.cursors.get(job.channelId);
          baseline = cursor?.baselineViews ?? (await this.posts.channelMedianViews(job.channelId));
          baselineCache.set(job.channelId, baseline ?? null);
          if (baseline) await this.cursors.setBaselineViews(job.channelId, Math.round(baseline));
        }

        const score = scorePost({
          views: post.views,
          forwards: post.forwards,
          repliesCount: post.repliesCount,
          totalReactions: reactionsTotal,
          postedAt: post.postedAt,
          baselineViews: baseline ?? null,
        });

        await this.posts.setScore(post.id, score);
        await this.jobs.markDone(job.id);
      } catch (e: any) {
        log.warn('Ошибка обработки job', { jobId: job.id, error: e?.message });
        await this.jobs.markError(job.id, String(e?.message || e).slice(0, 200));
      }
    }
    log.debug('Партия обработана', { count: batch.length });
    return batch.length;
  }
}
