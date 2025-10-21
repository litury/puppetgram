export interface IChannelRecommendation {
  id: string;
  title: string;
  username?: string;
  description?: string;
  subscribersCount?: number;
  isVerified?: boolean;
  photoUrl?: string;
}

export interface IChannelRecommendationsResponse {
  channels: IChannelRecommendation[];
  totalCount: number;
  hasMore: boolean;
  searchDepth?: number;
  duplicatesRemoved?: number;
}

export interface IRecommendationOptions {
  sourceChannel?: string;
  limit?: number;
  global?: boolean;
  recursiveSearch?: boolean;
  maxDepth?: number;
  removeDuplicates?: boolean;
}
