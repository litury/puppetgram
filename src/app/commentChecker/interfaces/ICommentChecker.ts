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
    totalComments?: number;
    recentCommentsCount?: number;
    lastCommentDate?: Date;
    participantsCount?: number;
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