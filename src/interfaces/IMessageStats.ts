/**
 * Interface for message statistics
 */
export interface IMessageStats {
  totalMessages: number;
  estimatedCostUSD?: number;
  estimatedCostRUB?: number;
  averageViews?: number;
  averageForwards?: number;
  averageReplies?: number;
  messagesWithMedia?: number;
  messagesWithLinks?: number;
  messagesWithMentions?: number;
  averageMessageLength?: number;
  topWords?: { word: string; count: number }[];
  topHashtags?: { tag: string; count: number }[];
  peakHours?: { hour: number; count: number }[];
  dateRange?: {
    from: Date;
    to: Date;
  };
}

/**
 * Channel statistics interface
 */
export interface IChannelStats extends IMessageStats {
  channelId: number;
  channelTitle: string;
  channelUsername?: string;
  subscribersCount?: number;
  description?: string;
  createdAt?: Date;
  lastPostDate?: Date;
  averagePostsPerDay?: number;
  engagementRate?: number;
}
