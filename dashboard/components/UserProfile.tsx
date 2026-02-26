'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useScopedI18n } from '@/locales/client';
import { API_URL, WS_URL } from '@/lib/config';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const ADMIN_USERNAME = 'pravku';

interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
}

interface Post {
  channel: string;
  postId: number;
  commentText: string | null;
  createdAt: string | null;
}

type AuthFlowState = 'idle' | 'loading' | 'waiting' | 'success';

function TelegramIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function getInitials(user: User | null): string {
  if (!user) return 'U';
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
  return (user.firstName || user.username || 'U')[0].toUpperCase();
}

function ExpandableSection({ id, icon, title, subtitle, expanded, onToggle, children }: {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <>
      <button
        onClick={() => onToggle(id)}
        className="bg-neutral-850 rounded-lg p-4 border border-neutral-800 flex items-center gap-3 shrink-0 hover:border-neutral-700 transition-colors w-full text-left cursor-pointer"
      >
        <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-secondary">{title}</p>
          {subtitle && <p className="text-xs text-tertiary">{subtitle}</p>}
        </div>
        <svg
          className={`w-4 h-4 text-tertiary transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      {expanded && children}
    </>
  );
}

function TelegramPost({ channel, postId }: { channel: string; postId: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-post', `${channel}/${postId}`);
    script.setAttribute('data-width', '100%');

    containerRef.current.appendChild(script);
  }, [channel, postId]);

  return <div ref={containerRef} className="w-full p-2 [&_iframe]:rounded-lg" />;
}

function CommentCard({ post, formatTime }: { post: Post; formatTime: (s: string | null) => string }) {
  const t = useScopedI18n('dashboard');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-neutral-850 border border-neutral-800 rounded-lg hover:border-neutral-700 transition-colors overflow-hidden shrink-0">
      <div className={`p-3 ${expanded ? 'border-b border-neutral-800' : ''}`}>
        <div className="flex justify-between items-center gap-2 mb-2">
          <a
            href={`https://t.me/${post.channel}/${post.postId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs uppercase tracking-wide text-accent-500 hover:text-accent-400 transition-colors truncate"
          >
            @{post.channel}
          </a>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs tabular-nums text-tertiary whitespace-nowrap">
              {formatTime(post.createdAt)}
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-tertiary hover:text-secondary transition-colors text-xs px-2 py-1 rounded-md hover:bg-neutral-800"
            >
              {expanded ? t('hide') : t('show')}
            </button>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-primary/90">
          {post.commentText || '—'}
        </p>
      </div>
      {expanded && (
        <div className="border-t border-neutral-800">
          <TelegramPost channel={post.channel} postId={post.postId} />
        </div>
      )}
    </div>
  );
}

function BlurredProfileMockup() {
  return (
    <div className="flex flex-col gap-4 blur-[3px] select-none pointer-events-none">
      {/* Fake avatar + name */}
      <div className="flex items-center gap-4 pb-6 border-b border-neutral-800">
        <div className="w-16 h-16 rounded-full bg-neutral-800 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-5 w-32 bg-neutral-800 rounded" />
          <div className="h-3.5 w-20 bg-neutral-850 rounded" />
        </div>
      </div>

      {/* Fake placeholder sections */}
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-neutral-850 rounded-lg p-4 border border-neutral-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-neutral-800 shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3.5 w-24 bg-neutral-800 rounded" />
              <div className="h-2.5 w-16 bg-neutral-850 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UserProfile() {
  const t = useScopedI18n('dashboard');

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authFlowState, setAuthFlowState] = useState<AuthFlowState>('idle');
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Admin comments state
  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const limit = 10;

  const isAdmin = user?.username === ADMIN_USERNAME;

  // Check auth on mount
  useEffect(() => {
    const sessionId = localStorage.getItem('sessionId');
    const savedUser = localStorage.getItem('user');
    if (sessionId && savedUser) {
      setIsAuthenticated(true);
      setUser(JSON.parse(savedUser));
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Generate QR code when deepLink changes
  useEffect(() => {
    if (!deepLink) return;

    async function generateQR() {
      try {
        const QRCodeLib = await import('qrcode');
        const isDark = !document.documentElement.classList.contains('light');
        const url = await QRCodeLib.toDataURL(deepLink!, {
          width: 180,
          margin: 2,
          color: {
            dark: isDark ? '#fafafa' : '#1a1a1f',
            light: '#00000000',
          },
          errorCorrectionLevel: 'M',
        });
        setQrDataUrl(url);
      } catch {
        // Error handled silently
      }
    }
    generateQR();
  }, [deepLink]);

  // Start login flow
  const startLogin = useCallback(async () => {
    try {
      setAuthFlowState('loading');

      const res = await fetch(`${API_URL}/auth/login`, { method: 'POST' });
      const data = await res.json();

      if (data.token && data.deepLink) {
        setDeepLink(data.deepLink);
        setAuthFlowState('waiting');

        if (wsRef.current) {
          wsRef.current.close();
        }

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'auth:subscribe', token: data.token }));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'auth:confirmed') {
              const { sessionId, user: confirmedUser } = message.data as { sessionId: string; user: User };

              document.cookie = `session=${sessionId}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
              localStorage.setItem('sessionId', sessionId);
              localStorage.setItem('user', JSON.stringify(confirmedUser));

              setAuthFlowState('success');
              ws.close();

              setTimeout(() => {
                setIsAuthenticated(true);
                setUser(confirmedUser);
              }, 800);
            }
          } catch {
            // Error handled silently
          }
        };
      }
    } catch {
      setAuthFlowState('idle');
    }
  }, []);

  // Cancel login flow
  const cancelLogin = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setAuthFlowState('idle');
    setDeepLink(null);
    setQrDataUrl(null);
  }, []);

  // Handle logout
  const handleLogout = useCallback(() => {
    localStorage.removeItem('sessionId');
    localStorage.removeItem('user');
    document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    setIsAuthenticated(false);
    setUser(null);
    setPosts([]);
    setAuthFlowState('idle');
  }, []);

  // Admin: WebSocket for real-time comment updates
  const handleWsMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'new_comment' && isAdmin) {
      const data = msg.data as { channel: string; postId: number; commentText: string; createdAt: string };
      setPosts((prev) => [
        { channel: data.channel, postId: data.postId, commentText: data.commentText, createdAt: data.createdAt },
        ...prev,
      ]);
    }
  }, [isAdmin]);

  useWebSocket(handleWsMessage);

  // Admin: Fetch posts
  const fetchPosts = useCallback(async (offset: number, append = false) => {
    try {
      if (append) setLoadingMore(true);
      else setLoadingPosts(true);
      const res = await fetch(`${API_URL}/api/recent-posts?limit=${limit}&offset=${offset}`);
      if (res.ok) {
        const data = await res.json();
        if (data.posts.length < limit) setHasMore(false);
        setPosts((prev) => (append ? [...prev, ...data.posts] : data.posts));
      }
    } catch {
      // Error handled silently
    } finally {
      setLoadingPosts(false);
      setLoadingMore(false);
    }
  }, []);

  // Admin: Fetch posts on auth
  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      fetchPosts(0);
    }
  }, [fetchPosts, isAuthenticated, isAdmin]);

  // Admin: Intersection Observer for infinite scroll
  useEffect(() => {
    if (!isAdmin || loadingPosts) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchPosts(posts.length, true);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [isAdmin, loadingPosts, hasMore, loadingMore, posts.length, fetchPosts, expandedSection]);

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

  // Not authenticated — blurred teaser + auth flow
  if (isAuthenticated === false) {
    return (
      <div className="bg-neutral-900 rounded-xl p-4 md:p-6 border border-neutral-800 h-full flex flex-col relative overflow-hidden">
        <BlurredProfileMockup />

        {/* Gradient overlay */}
        <div className="absolute inset-0 pointer-events-none rounded-xl">
          <div className="absolute bottom-0 left-0 right-0 h-4/5 bg-linear-to-t from-neutral-900 via-neutral-900/95 to-transparent" />
        </div>

        {/* Glass box — auth flow */}
        <div className="absolute bottom-6 left-4 right-4 pointer-events-auto">
          <div className="bg-neutral-900/70 backdrop-blur-xl border border-neutral-700/50 rounded-2xl p-6 shadow-2xl shadow-black/30 text-center max-w-xs mx-auto h-80 flex flex-col justify-center">

            {/* Idle state — CTA */}
            {authFlowState === 'idle' && (
              <div className="animate-modal-content">
                <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-accent-500/10 flex items-center justify-center">
                  <svg className="w-7 h-7 text-accent-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-primary mb-2">{t('accessTitle')}</h3>
                <p className="text-sm text-tertiary mb-5">{t('accessMessage')}</p>
                <button
                  onClick={startLogin}
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white font-medium rounded-xl px-5 py-3 transition-colors shadow-lg shadow-[#2AABEE]/20"
                >
                  <TelegramIcon className="w-5 h-5" />
                  {t('loginTelegram')}
                </button>
              </div>
            )}

            {/* Loading state — spinner */}
            {authFlowState === 'loading' && (
              <div className="animate-modal-fade">
                <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-accent-500/10 flex items-center justify-center">
                  <TelegramIcon className="w-7 h-7 text-accent-400" />
                </div>
                <div className="flex items-center justify-center gap-2 text-tertiary">
                  <div className="w-4 h-4 border-2 border-accent-500/20 border-t-accent-500 rounded-full animate-spin" />
                  <span className="text-sm">{t('preparing')}</span>
                </div>
              </div>
            )}

            {/* Waiting state — QR code */}
            {authFlowState === 'waiting' && deepLink && (
              <div className="space-y-4 animate-modal-fade">
                {qrDataUrl ? (
                  <div className="relative inline-block mx-auto animate-qr-scale">
                    <div className="bg-neutral-850/80 p-3 rounded-xl border border-neutral-700/50">
                      <img src={qrDataUrl} alt="QR Code" width={140} height={140} className="block" />
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-neutral-900 rounded-lg flex items-center justify-center border border-neutral-700/50">
                      <TelegramIcon className="w-5 h-5 text-[#2AABEE]" />
                    </div>
                  </div>
                ) : (
                  <div className="w-35 h-35 bg-neutral-800/50 rounded-xl mx-auto flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-accent-500/20 border-t-accent-500 rounded-full animate-spin" />
                  </div>
                )}

                <div>
                  <p className="text-sm text-tertiary">
                    {t('scanOr')}{' '}
                    <a
                      href={deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-400 hover:text-accent-300 underline underline-offset-2"
                    >
                      {t('openInTelegram')}
                    </a>
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2 text-tertiary">
                  <div className="w-3 h-3 border-2 border-accent-500/20 border-t-accent-500 rounded-full animate-spin" />
                  <span className="text-xs">{t('waiting')}</span>
                </div>

                <button
                  onClick={cancelLogin}
                  className="text-xs text-tertiary hover:text-secondary transition-colors"
                >
                  {t('cancel')}
                </button>
              </div>
            )}

            {/* Success state — checkmark */}
            {authFlowState === 'success' && (
              <div className="animate-qr-scale">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-success/20 flex items-center justify-center">
                  <svg className="w-7 h-7 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-success font-medium">{t('success')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isAuthenticated === null) {
    return (
      <div className="bg-neutral-900 rounded-xl p-4 md:p-6 border border-neutral-800 h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500/20 border-t-accent-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated — show profile
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || 'User';
  const [photoError, setPhotoError] = useState(false);
  const photoSrc = user?.telegramId ? `${API_URL}/api/photo/${user.telegramId}` : null;

  return (
    <div className="bg-neutral-900 rounded-xl p-4 md:p-6 border border-neutral-800 h-full flex flex-col">
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-4 pb-4 border-b border-neutral-800 shrink-0">
        {photoSrc && !photoError ? (
          <img
            src={photoSrc}
            alt={displayName}
            className="w-14 h-14 rounded-full border-2 border-neutral-700 shrink-0 object-cover"
            onError={() => setPhotoError(true)}
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-accent-500/15 flex items-center justify-center border-2 border-neutral-700 shrink-0">
            <span className="text-lg font-semibold text-accent-400">
              {getInitials(user)}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-primary truncate">{displayName}</h2>
          {user?.username && (
            <a
              href={`https://t.me/${user.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-tertiary hover:text-accent-400 transition-colors truncate block"
            >
              @{user.username}
            </a>
          )}
        </div>
      </div>

      {/* Sections */}
      <div className={`flex flex-col gap-2 ${expandedSection ? 'flex-1 min-h-0' : 'shrink-0'}`}>
        {/* My Channels */}
        {(!expandedSection || expandedSection === 'channels') && (
          <ExpandableSection
            id="channels"
            icon={
              <svg className="w-5 h-5 text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            }
            title={t('myChannels')}
            subtitle={t('comingSoon')}
            expanded={expandedSection === 'channels'}
            onToggle={(id) => setExpandedSection((prev) => prev === id ? null : id)}
          >
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
              <svg className="w-10 h-10 text-tertiary/40 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-sm text-tertiary">{t('channelsEmpty')}</p>
            </div>
          </ExpandableSection>
        )}

        {/* Settings */}
        {(!expandedSection || expandedSection === 'settings') && (
          <ExpandableSection
            id="settings"
            icon={
              <svg className="w-5 h-5 text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            }
            title={t('settings')}
            subtitle=""
            expanded={expandedSection === 'settings'}
            onToggle={(id) => setExpandedSection((prev) => prev === id ? null : id)}
          >
            <div className="flex flex-col gap-3 py-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm text-secondary">{t('theme')}</span>
                <ThemeToggle />
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="text-sm text-secondary">{t('language')}</span>
                <LanguageSwitcher />
              </div>
            </div>
          </ExpandableSection>
        )}

        {/* Admin: Comments */}
        {isAdmin && (!expandedSection || expandedSection === 'comments') && (
          <ExpandableSection
            id="comments"
            icon={
              <svg className="w-5 h-5 text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
            title={t('recentComments')}
            subtitle={loadingPosts ? t('loading') : `${posts.length}+`}
            expanded={expandedSection === 'comments'}
            onToggle={(id) => setExpandedSection((prev) => prev === id ? null : id)}
          >
            <div className="flex flex-col flex-1 min-h-0">
              {loadingPosts ? (
                <div className="flex-1 flex items-center justify-center py-6">
                  <div className="w-6 h-6 border-2 border-accent-500/20 border-t-accent-500 rounded-full animate-spin" />
                </div>
              ) : posts.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-6">
                  <p className="text-sm text-tertiary">{t('noData')}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
                  {posts.map((post, index) => (
                    <CommentCard key={`${post.channel}-${post.postId}-${index}`} post={post} formatTime={formatTime} />
                  ))}
                  <div ref={loadMoreRef} className="h-8 shrink-0">
                    {loadingMore && (
                      <div className="flex items-center justify-center py-2">
                        <div className="w-4 h-4 border-2 border-accent-500/20 border-t-accent-500 rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ExpandableSection>
        )}
      </div>

      {/* Logout */}
      <div className="mt-auto pt-4 border-t border-neutral-800 shrink-0">
        <button
          onClick={handleLogout}
          className="w-full text-sm text-tertiary hover:text-red-400 transition-colors py-2 rounded-lg hover:bg-red-500/5"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  );
}
