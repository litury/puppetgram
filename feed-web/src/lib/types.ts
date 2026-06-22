export type MediaRef =
  | { kind: 'photo'; url: string; w?: number; h?: number; blur?: string }
  | { kind: 'album'; items: { url: string; w?: number; h?: number; blur?: string }[] }
  | { kind: 'video'; poster: string; duration?: number; w?: number; h?: number }
  | { kind: 'file'; name: string; ext?: string; size?: string }
  | { kind: 'link'; url: string; title?: string; site?: string; thumb?: string };

export interface FeedPost {
  id: number;
  channelId: string | null;
  channelUsername: string | null;
  tgMessageId: number | null;
  text: string | null;
  mediaType: string | null;
  mediaRefs: MediaRef | null;
  views: number | null;
  reactions: Record<string, number> | null;
  forwards: number | null;
  repliesCount: number | null;
  postedAt: string | null;
  score: number | null;
  category: string | null;
  link: string | null;
}
