/**
 * Interface representing a Telegram message
 */
export interface IMessage {
    id: number;
    peerId: number;
    date: Date;
    message?: string;
    text: string;
    fromId?: number;
    replyTo?: {
        replyToMsgId: number;
        replyToTopId?: number;
    };
    fwdFrom?: {
        fromId?: number;
        fromName?: string;
        date: Date;
    };
    media?: any;
    entities?: any[];
    views?: number;
    forwards?: number;
    replies?: {
        replies: number;
        repliesPts?: number;
    };
    editDate?: Date;
    postAuthor?: string;
    groupedId?: string;
    reactions?: any;
    restrictionReason?: any[];
    ttlPeriod?: number;
}

/**
 * Extended message interface with additional metadata
 */
export interface IMessageWithMetadata extends IMessage {
    channelId?: number;
    channelTitle?: string;
    channelUsername?: string;
    isForwarded?: boolean;
    isReply?: boolean;
    hasMedia?: boolean;
    messageLength?: number;
    engagement?: {
        views?: number;
        forwards?: number;
        replies?: number;
        reactions?: number;
    };
}
