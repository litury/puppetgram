'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

// API URL - ws-server
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';

// States for the auth flow
type AuthState = 'idle' | 'waiting' | 'success' | 'error';

// User type
interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
}

// Telegram icon component
function TelegramIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

// Animated puppet strings background
function PuppetStrings() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Vertical strings */}
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="absolute top-0 w-px bg-gradient-to-b from-accent-500/20 via-accent-500/5 to-transparent"
          style={{
            left: `${15 + i * 17.5}%`,
            height: '40%',
            animation: `string-sway ${3 + i * 0.5}s ease-in-out infinite`,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}

      {/* Floating particles */}
      {[...Array(12)].map((_, i) => (
        <div
          key={`particle-${i}`}
          className="absolute rounded-full bg-accent-500/10"
          style={{
            width: `${2 + Math.random() * 4}px`,
            height: `${2 + Math.random() * 4}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `float ${5 + Math.random() * 5}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 5}s`,
          }}
        />
      ))}
    </div>
  );
}

// QR Code component with custom styling
function QRCode({ value, size = 180 }: { value: string; size?: number }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Dynamic import for QR code generation
    async function generateQR() {
      try {
        const QRCodeLib = await import('qrcode');
        const url = await QRCodeLib.toDataURL(value, {
          width: size,
          margin: 2,
          color: {
            dark: '#fafafa',
            light: '#00000000',
          },
          errorCorrectionLevel: 'M',
        });
        setQrDataUrl(url);
      } catch (err) {
        console.error('QR generation failed:', err);
      }
    }
    generateQR();
  }, [value, size]);

  if (!qrDataUrl) {
    return (
      <div
        className="bg-neutral-800/50 rounded-2xl animate-pulse"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div className="relative group">
      {/* Glow effect */}
      <div className="absolute -inset-4 bg-accent-500/10 rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* QR container */}
      <div className="relative bg-neutral-850/80 backdrop-blur-sm p-4 rounded-2xl border border-neutral-700/50">
        <img
          src={qrDataUrl}
          alt="QR Code"
          width={size}
          height={size}
          className="block"
        />

        {/* Center logo overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 bg-[#2AABEE] rounded-xl flex items-center justify-center shadow-lg shadow-[#2AABEE]/30">
            <TelegramIcon className="w-6 h-6 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Waiting spinner with pulse effect
function WaitingIndicator() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {/* Outer ring */}
        <div className="w-16 h-16 rounded-full border-2 border-accent-500/20" />

        {/* Spinning arc */}
        <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-transparent border-t-accent-500 animate-spin" />

        {/* Inner pulse */}
        <div className="absolute inset-2 rounded-full bg-accent-500/10 animate-pulse" />

        {/* Center dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-accent-500" />
        </div>
      </div>

      <p className="text-text-secondary text-sm animate-pulse">
        Ожидание подтверждения...
      </p>
    </div>
  );
}

// Success checkmark animation
function SuccessIndicator() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-success/20 animate-ping" />
        <div className="absolute inset-0 rounded-full bg-success/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path
              d="M5 13l4 4L19 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-draw-check"
            />
          </svg>
        </div>
      </div>
      <p className="text-success text-sm font-medium">Успешно!</p>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Detect mobile
  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Connect to WebSocket and subscribe to auth confirmation
  const connectWebSocket = useCallback((authToken: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Subscribe to auth confirmation for this token
      ws.send(JSON.stringify({ type: 'auth:subscribe', token: authToken }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'auth:confirmed') {
          const { sessionId, user } = message.data as { sessionId: string; user: User };

          // Save session to cookie
          document.cookie = `session=${sessionId}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;

          // Also save to localStorage for API calls
          localStorage.setItem('sessionId', sessionId);
          localStorage.setItem('user', JSON.stringify(user));

          setAuthState('success');

          // Close WebSocket
          ws.close();

          // Redirect to dashboard after animation
          setTimeout(() => {
            router.push('/dashboard');
          }, 1500);
        }
      } catch (error) {
        console.error('WebSocket message parse error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
    };
  }, [router]);

  // Start auth flow
  const handleLogin = useCallback(async () => {
    try {
      setAuthState('waiting');

      const res = await fetch(`${API_URL}/auth/login`, { method: 'POST' });
      const data = await res.json();

      if (data.error) {
        console.error('Login error:', data.error);
        setAuthState('error');
        return;
      }

      if (data.token && data.deepLink) {
        setToken(data.token);
        setDeepLink(data.deepLink);

        // Connect to WebSocket for real-time notification
        connectWebSocket(data.token);

        // On mobile, redirect to Telegram
        if (isMobile) {
          window.location.href = data.deepLink;
        }
      }
    } catch (error) {
      console.error('Login failed:', error);
      setAuthState('error');
    }
  }, [isMobile, connectWebSocket]);

  // Reset to idle
  const handleCancel = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setAuthState('idle');
    setDeepLink(null);
    setToken(null);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 relative">
      {/* Background decoration */}
      <PuppetStrings />

      {/* Gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-500/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[#2AABEE]/5 rounded-full blur-3xl" />

      {/* Main card */}
      <div className="relative w-full max-w-md">
        {/* Card glow */}
        <div className="absolute -inset-1 bg-gradient-to-r from-accent-500/20 via-[#2AABEE]/20 to-accent-500/20 rounded-3xl blur-xl opacity-50" />

        {/* Card content */}
        <div className="relative bg-neutral-900/80 backdrop-blur-xl rounded-3xl border border-neutral-800/50 p-8 md:p-10">
          {/* Logo & Title */}
          <div className="text-center mb-8 animate-fade-in">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500/20 to-accent-600/10 border border-accent-500/20 mb-4">
              <span className="text-3xl">🎭</span>
            </div>
            <h1 className="text-2xl font-semibold text-text-primary mb-2">
              Puppetgram
            </h1>
            <p className="text-text-tertiary text-sm">
              Войдите через Telegram для доступа к дашборду
            </p>
          </div>

          {/* Auth states */}
          <div className="min-h-[280px] flex flex-col items-center justify-center">
            {authState === 'idle' && (
              <div className="w-full space-y-4 animate-scale-in">
                <button
                  onClick={handleLogin}
                  className="w-full flex items-center justify-center gap-3 bg-[#2AABEE] hover:bg-[#229ED9] text-white font-medium rounded-xl px-6 py-4 transition-all duration-300 shadow-lg shadow-[#2AABEE]/25 hover:shadow-xl hover:shadow-[#2AABEE]/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
                >
                  <TelegramIcon className="w-5 h-5" />
                  <span>Войти через Telegram</span>
                </button>

                <p className="text-center text-text-disabled text-xs">
                  Безопасный вход через официальный Telegram бот
                </p>
              </div>
            )}

            {authState === 'waiting' && deepLink && (
              <div className="flex flex-col items-center gap-6 animate-fade-in">
                {!isMobile ? (
                  <>
                    <QRCode value={deepLink} size={180} />
                    <div className="text-center space-y-2">
                      <p className="text-text-secondary text-sm">
                        Отсканируйте QR-код камерой телефона
                      </p>
                      <p className="text-text-disabled text-xs">
                        или{' '}
                        <a
                          href={deepLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-400 hover:text-accent-300 underline underline-offset-2"
                        >
                          откройте ссылку
                        </a>
                      </p>
                    </div>
                    <WaitingIndicator />
                  </>
                ) : (
                  <>
                    <WaitingIndicator />
                    <p className="text-text-secondary text-sm text-center">
                      Подтвердите вход в Telegram боте
                    </p>
                  </>
                )}

                <button
                  onClick={handleCancel}
                  className="text-text-tertiary hover:text-text-secondary text-sm transition-colors"
                >
                  Отмена
                </button>
              </div>
            )}

            {authState === 'success' && (
              <div className="animate-scale-in">
                <SuccessIndicator />
              </div>
            )}

            {authState === 'error' && (
              <div className="text-center space-y-4 animate-fade-in">
                <div className="w-16 h-16 mx-auto rounded-full bg-error/10 flex items-center justify-center">
                  <span className="text-2xl">⚠️</span>
                </div>
                <p className="text-error text-sm">Произошла ошибка</p>
                <button
                  onClick={handleCancel}
                  className="text-text-secondary hover:text-text-primary text-sm underline underline-offset-2"
                >
                  Попробовать снова
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom styles for animations */}
      <style jsx>{`
        @keyframes string-sway {
          0%, 100% { transform: translateX(0) scaleY(1); }
          50% { transform: translateX(3px) scaleY(1.02); }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
          50% { transform: translateY(-20px) translateX(10px); opacity: 0.6; }
        }

        @keyframes draw-check {
          0% { stroke-dasharray: 0 100; }
          100% { stroke-dasharray: 100 0; }
        }

        .animate-draw-check {
          stroke-dasharray: 100;
          animation: draw-check 0.5s ease-out forwards;
          animation-delay: 0.2s;
        }
      `}</style>
    </main>
  );
}
