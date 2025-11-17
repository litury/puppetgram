/**
 * Интерфейсы для модуля автоматического комментирования постов
 * Следует стандартам компании согласно proj-struct-guideline.md
 */

// Импорты для AI интеграции
import {
  IAICommentGenerator,
  IAICommentResult,
} from "../../aiCommentGenerator/interfaces";

export interface ICommentTarget {
  channelUsername: string;
  channelUrl: string;
  channelTitle?: string;
  targetPostId?: number; // ID конкретного поста, если указан
  isActive: boolean;
}

export interface ICommentTargetWithCache {
  channelId: string;
  accessHash: string;
  channelUsername: string;
  channelTitle: string;
  commentsEnabled: boolean;
  commentsPolicy:
    | "enabled"
    | "disabled"
    | "restricted"
    | "members_only"
    | "approval_required"
    | "unknown";
  linkedDiscussionGroup?: {
    id: string;
    title: string;
    username?: string;
    url?: string;
  };
  canPostComments: boolean;
  canReadComments: boolean;
  targetPostId?: number;
  isActive: boolean;
}

export interface ICommentMessage {
  text: string;
  weight: number; // Вес для случайного выбора (1-10)
  category: "general" | "appreciation" | "question" | "insight"; // Категория комментария
}

export interface ICommentingSession {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  targetsProcessed: number;
  successfulComments: number;
  failedComments: number;
  errors: string[];
  isActive: boolean;
}

export interface ICommentingOptions {
  targets: ICommentTarget[];
  messages: ICommentMessage[];
  delayBetweenComments: number; // мс между комментариями
  maxCommentsPerSession: number; // Лимит комментариев за сессию
  randomizeOrder: boolean; // Случайный порядок обработки
  skipRecentlyCommented: boolean; // Пропускать недавно прокомментированные
  dryRun: boolean; // Тестовый режим без реального комментирования
  sendAsOptions?: ISendAsOptions; // Настройки отправки от имени канала
}

export interface ICommentResult {
  target: ICommentTarget;
  success: boolean;
  commentText?: string;
  postedMessageId?: number;
  error?: string;
  timestamp: Date;
  retryCount: number;
}

export interface ICommentingResponse {
  sessionId: string;
  totalTargets: number;
  successfulComments: number;
  failedComments: number;
  results: ICommentResult[];
  duration: number; // Длительность в мс
  summary: {
    successRate: number; // Процент успешных комментариев
    averageDelay: number; // Средняя задержка между комментариями
    errorsByType: { [errorType: string]: number };
  };
}

export interface IBulkCommentingOptions {
  inputFiles: string[]; // Пути к файлам с целями
  messageTemplates: ICommentMessage[];
  sessionSettings: {
    maxCommentsPerSession: number;
    delayRange: { min: number; max: number }; // Случайная задержка
    parallelSessions: boolean;
    pauseBetweenSessions: number; // мс между сессиями
  };
  safetyLimits: {
    maxCommentsPerHour: number;
    maxCommentsPerDay: number;
    respectFloodWait: boolean;
  };
  filters: {
    skipChannelsWithoutComments: boolean;
    onlyActiveChannels: boolean;
    skipPrivateChannels: boolean;
  };
}

export interface ICommentingStats {
  totalSessionsRun: number;
  totalCommentsPosted: number;
  totalTargetsProcessed: number;
  successRate: number;
  averageCommentsPerSession: number;
  mostActiveHours: number[]; // Часы с наибольшей активностью
  errorStats: { [errorType: string]: number };
  lastSessionDate: Date;
}

export interface IChannelMembershipInfo {
  channelUsername: string;
  isMember: boolean;
  membershipRequired: boolean;
  accessLevel: "public" | "private" | "restricted";
  canJoin: boolean;
  joinError?: string;
}

export interface ICommentAccessResult {
  channel: ICommentTarget;
  membershipInfo: IChannelMembershipInfo;
  commentingAllowed: boolean;
  needsJoining: boolean;
  errorDetails?: string;
}

export interface IChannelFilteringResponse {
  accessibleChannels: ICommentTarget[];
  channelsNeedingJoin: ICommentTarget[];
  inaccessibleChannels: ICommentTarget[];
  membershipResults: ICommentAccessResult[];
}

export interface IUserChannel {
  id: string;
  title: string;
  username?: string;
  participantsCount?: number;
  isChannel: boolean;
  canPost: boolean;
}

export interface ISendAsOptions {
  useChannelAsSender: boolean;
  selectedChannelId?: string;
  selectedChannelTitle?: string;
}

export interface ICommentingOptionsWithCache {
  targets: ICommentTargetWithCache[];
  messages: ICommentMessage[];
  delayBetweenComments: number;
  maxCommentsPerSession: number;
  randomizeOrder: boolean;
  skipRecentlyCommented: boolean;
  dryRun: boolean;
  sendAsOptions?: ISendAsOptions;
}

export interface IProgressFileData {
  lastUpdate: string;
  processedChannels: number;
  totalChannels: number;
  lastProcessedChannel: string;
  results: Array<{
    channel: {
      channelId: string;
      channelTitle: string;
      channelUsername: string;
      accessHash: string;
      commentsEnabled: boolean;
      commentsPolicy: string;
      linkedDiscussionGroup?: {
        id: string;
        title: string;
        username?: string;
        url?: string;
      };
      canPostComments: boolean;
      canReadComments: boolean;
    };
    success: boolean;
    error?: string;
  }>;
}

// === НОВЫЕ ИНТЕРФЕЙСЫ ДЛЯ РАБОТЫ С КОНТЕНТОМ ПОСТОВ ===

/**
 * Информация о контенте поста
 */
export interface IPostContent {
  id: number;
  text: string;
  date: Date;
  views: number;
  forwards: number;
  reactions: number;
  hasMedia: boolean;
  mediaType?:
    | "photo"
    | "video"
    | "document"
    | "audio"
    | "sticker"
    | "voice"
    | "animation"
    | "poll"
    | "contact"
    | "location";
  channelId: string;
  channelUsername: string;
  channelTitle: string;
  messageLength: number;
  hasLinks: boolean;
  hashtags: string[];
  mentions: string[];
}

/**
 * Расширенный результат комментирования с контентом поста
 */
export interface ICommentResultWithContent extends ICommentResult {
  postContent?: IPostContent;
  contentExtracted: boolean;
  contentExtractionError?: string;
}

/**
 * Расширенный ответ комментирования с контентом постов
 */
export interface ICommentingResponseWithContent extends ICommentingResponse {
  results: ICommentResultWithContent[];
  postsAnalyzed: number;
  contentStats: {
    totalPosts: number;
    postsWithText: number;
    postsWithMedia: number;
    averageViews: number;
    averageForwards: number;
    averageReactions: number;
    topHashtags: string[];
  };
}

/**
 * Опции для тестирования извлечения контента
 */
export interface IContentExtractionTestOptions {
  targets: ICommentTargetWithCache[];
  extractContent: boolean;
  saveResults: boolean;
  outputFormat: "json" | "csv" | "txt";
  includeMetrics: boolean;
  includeFullText: boolean;
}

/**
 * Результат тестирования извлечения контента
 */
export interface IContentExtractionTestResult {
  sessionId: string;
  totalChannels: number;
  successfulExtractions: number;
  failedExtractions: number;
  posts: IPostContent[];
  contentStats: {
    totalPosts: number;
    postsWithText: number;
    postsWithMedia: number;
    averageViews: number;
    averageForwards: number;
    averageReactions: number;
    topHashtags: string[];
    mediaTypeDistribution: { [mediaType: string]: number };
  };
  errors: string[];
  duration: number;
  savedFile?: string;
}

// === УПРОЩЕННЫЕ ИНТЕРФЕЙСЫ ДЛЯ AI ИНТЕГРАЦИИ ===

/**
 * Простые опции комментирования с AI
 */
export interface ICommentingOptionsWithAI extends ICommentingOptions {
  /**
   * Использовать AI для генерации комментариев
   */
  useAI: boolean;

  /**
   * Генератор AI комментариев
   */
  aiGenerator?: IAICommentGenerator;

  /**
   * Задержка между целями (мс)
   */
  delayBetweenTargets?: number;
}

/**
 * Простой результат комментирования с AI
 */
export interface ICommentingResponseWithAI extends ICommentingResponse {
  /**
   * Результаты AI генерации
   */
  aiResults: IAICommentResult[];

  /**
   * Простая сводка по AI
   */
  aiSummary: {
    totalAIRequests: number;
    successfulAIRequests: number;
    failedAIRequests: number;
    skippedPosts: number;
  };
}

// === ОСНОВНОЙ ИНТЕРФЕЙС МОДУЛЯ ===

/**
 * Основной интерфейс для модуля комментирования постов
 */
export interface ICommentPoster {
  /**
   * Стандартное комментирование с шаблонами
   */
  postCommentsAsync(
    _options: ICommentingOptionsWithCache,
  ): Promise<ICommentingResponseWithContent>;

  /**
   * Комментирование с AI генерацией
   */
  postCommentsWithAIAsync(
    _options: ICommentingOptionsWithAI,
  ): Promise<ICommentingResponseWithAI>;

  /**
   * Тестирование извлечения контента без комментирования
   */
  testContentExtractionAsync(
    _options: IContentExtractionTestOptions,
  ): Promise<IContentExtractionTestResult>;

  /**
   * Проверка доступности каналов для комментирования
   */
  checkChannelAccessAsync(
    _targets: ICommentTarget[],
  ): Promise<IChannelFilteringResponse>;

  /**
   * Получение статистики комментирования
   */
  getCommentingStats(): ICommentingStats;

  /**
   * Получение списка каналов пользователя для отправки от имени
   */
  getUserChannelsAsync(): Promise<IUserChannel[]>;
}

// === ИНТЕРФЕЙСЫ ДЛЯ УПРАВЛЕНИЯ КАНАЛАМИ ===

/**
 * Причины действий с каналами
 */
export type ChannelManagementReason =
  | "successful_comment"
  | "flood_wait"
  | "access_denied"
  | "comment_failed"
  | "media_only_post"
  | "channel_not_found"
  | "comments_disabled"
  | "other";

/**
 * Действие с каналом после комментирования
 */
export interface IChannelManagementAction {
  channelId: string;
  channelUsername: string;
  channelTitle: string;
  action: "remove" | "move_to_retry" | "move_to_archive" | "keep_active";
  reason: ChannelManagementReason;
  timestamp: Date;
  sessionId: string;
  postContent?: IPostContent;
  commentResult: ICommentResult;
  retryAfter?: Date;
  metadata?: any;
}

/**
 * Опции управления каналами
 */
export interface IChannelManagementOptions {
  removeAfterSuccess: boolean;
  archiveMediaOnlyChannels: boolean;
  createRetryDatabase: boolean;
  maxRetries: number;
  retryIntervalHours: number;
  saveActionLogs: boolean;
  archivePath: string;
  logsPath: string;
}

/**
 * Результат управления каналами
 */
export interface IChannelManagementResult {
  sessionId: string;
  totalChannels: number;
  removedChannels: number;
  archivedChannels: number;
  retryChannels: number;
  keptChannels: number;
  actions: IChannelManagementAction[];
  createdFiles: {
    originalUpdated?: string;
    archiveDatabase?: string;
    retryDatabase?: string;
    actionLog?: string;
  };
  summary: {
    totalProcessed: number;
    successRate: number;
    byAction: { [action: string]: number };
    byReason: { [reason: string]: number };
  };
}
