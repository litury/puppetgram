export type MediaRef =
  | { kind: 'photo'; url: string; w?: number; h?: number; blur?: string }
  | { kind: 'album'; items: { url: string; w?: number; h?: number; blur?: string }[] }
  | { kind: 'video'; url?: string; poster: string; duration?: number; w?: number; h?: number; blur?: string }
  | { kind: 'file'; name: string; ext?: string; size?: string }
  | { kind: 'link'; url: string; title?: string; site?: string; thumb?: string };

/** Telegram MessageEntity (упрощённый): форматирование и вшитые ссылки. offset/length в UTF-16. */
export interface TgEntity {
  type: string; // Bold | Italic | Code | Pre | Underline | Strike | Spoiler | TextUrl | Url | Mention | Blockquote | ...
  offset: number;
  length: number;
  url?: string;
  language?: string;
}

export interface FeedPost {
  id: number;
  channelId: string | null;
  channelUsername: string | null;
  tgMessageId: number | null;
  text: string | null;
  entities: TgEntity[] | null;
  mediaType: string | null;
  mediaRefs: MediaRef | MediaRef[] | null;
  views: number | null;
  reactions: Record<string, number> | null;
  forwards: number | null;
  repliesCount: number | null;
  postedAt: string | null;
  score: number | null;
  category: string | null;
  link: string | null;
}
