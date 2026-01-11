'use client';

interface CommentCardProps {
  channel: string;
  text: string;
  createdAt: string | null;
}

export function CommentCard({ channel, text, createdAt }: CommentCardProps) {
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

  // Убираем @ для ссылки
  const channelName = channel.replace('@', '');

  // Обрезаем текст если слишком длинный
  const truncatedText = text.length > 120 ? text.slice(0, 120) + '...' : text;

  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200">
      <div className="flex justify-between items-start gap-2 mb-2">
        <a
          href={`https://t.me/${channelName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-400 font-medium hover:text-violet-300 transition-colors text-sm"
        >
          {channel}
        </a>
        <span className="text-white/40 text-xs whitespace-nowrap">{formatTime(createdAt)}</span>
      </div>
      <p className="text-white/70 text-sm leading-relaxed">{truncatedText}</p>
    </div>
  );
}
