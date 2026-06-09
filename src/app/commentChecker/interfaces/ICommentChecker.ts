export interface IChannelCommentInfo {
    channelId: string;
    channelTitle: string;
    channelUsername?: string;
    channelUrl?: string;
    accessHash?: string;
    commentsEnabled: boolean;
    commentsPolicy: 'enabled' | 'disabled' | 'restricted' | 'members_only' | 'approval_required' | 'unknown';
    linkedDiscussionGroup?: {
        id: string;
        title: string;
        username?: string;
        url?: string;
    };
    accessRequirements?: {
        joinToSend: boolean;
        joinRequest: boolean;
        membershipRequired: boolean;
    };
    restrictionReason?: string;
    canPostComments: boolean;
    canReadComments: boolean;
    // true только если GetFullChannel реально отработал (linkedChatId достоверен).
    // false → сработал фоллбэк на голый ResolveUsername, политику комментов
    // определять НЕЛЬЗЯ (отсутствие linkedChatId здесь не значит «комментов нет»).
    fullInfoFetched?: boolean;
    totalComments?: number;
    recentCommentsCount?: number;
    lastCommentDate?: Date;
    participantsCount?: number;
    // Точное число участников (из GetFullChannel) — для приоритизации крупных каналов.
    participantsExact?: number;
    // Гибкий блоб «бесплатных» метаданных канала (about, тип, scam/fake, slowmode, boosts и т.д.).
    // Пишется чекером в колонку channel_meta (jsonb). Заполняется только при fullInfoFetched.
    meta?: Record<string, any>;
}

export interface ICommentCheckOptions {
    channelName: string;
    checkRecentActivity?: boolean;
    activityDays?: number;
    includeStatistics?: boolean;
    checkMembershipRequirements?: boolean;
}

export interface ICommentCheckResponse {
    channel: IChannelCommentInfo;
    checkDate: Date;
    success: boolean;
    error?: string;
    recommendations?: string[];
}

export interface IBulkCommentCheckOptions {
    channels: string[];
    exportResults?: boolean;
    exportFormat?: 'json' | 'markdown' | 'csv';
    parallelLimit?: number;
    delayBetweenRequests?: number;
}

export interface IBulkCommentCheckResponse {
    results: ICommentCheckResponse[];
    totalChecked: number;
    successfulChecks: number;
    failedChecks: number;
    summary: {
        enabledComments: number;
        disabledComments: number;
        restrictedComments: number;
        membersOnlyComments: number;
        approvalRequiredComments: number;
        withDiscussionGroups: number;
    };
} 