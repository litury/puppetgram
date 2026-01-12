'use client';

interface CommentCardProps {
  channel: string;
  text: string;
  postId: number | null;
  createdAt: string | null;
}

export function CommentCard({ channel, text, postId, createdAt }: CommentCardProps) {
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    });
  };

  const channelName = channel.replace('@', '');
  const truncatedText = text.length > 120 ? text.slice(0, 120) + '...' : text;
  const postUrl = postId ? `https://t.me/${channelName}/${postId}` : null;

  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:bg-white/8 transition-all duration-200">
      <div className="flex justify-between items-start gap-2 mb-2">
        <a
          href={`https://t.me/${channelName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-400 font-medium hover:text-violet-300 transition-colors text-sm"
        >
          {channel}
        </a>
        <div className="flex items-center gap-2">
          {postUrl && (
            <a
              href={postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 hover:text-violet-400 text-xs transition-colors"
              title="Открыть пост"
            >
              пост ↗
            </a>
          )}
          <span className="text-white/40 text-xs whitespace-nowrap">{formatTime(createdAt)}</span>
        </div>
      </div>
      <p className="text-white/70 text-sm leading-relaxed">{truncatedText}</p>
    </div>
  );
}
