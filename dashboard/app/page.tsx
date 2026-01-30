'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Header } from '@/components/Header';

// ============================================
// SVG ICONS
// ============================================

// Logo: использует готовый SVG из public/
function PuppetgramLogo({ className = "w-6 h-6", size = 24 }: { className?: string; size?: number }) {
  return (
    <Image
      src="/bot-avatar-masks.svg"
      alt="Puppetgram"
      width={size}
      height={size}
      className={`${className} rounded-full`}
    />
  );
}

// Feature icons
function TargetIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5c-1.5-1.5-4-1.5-5.5 0s-1.5 4 0 5.5" />
      <path d="M6.5 10c-1.5 1-2 3.5-.5 5s3.5 1.5 5 0" />
      <path d="M12 15c0 2 1.5 4.5 4 4.5s4-2.5 4-4.5" />
      <path d="M16 15c2-1 3-3 2-5s-3-3-5-2" />
      <path d="M12 4.5c1.5-1.5 4-1.5 5.5 0s1.5 4 0 5.5" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 4 5-6" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12" y2="18.01" />
    </svg>
  );
}

// ============================================
// ANIMATED NETWORK VISUALIZATION
// ============================================

function AnimatedNetwork() {
  // Bot node in center, channel nodes around it
  const botNode = { x: 400, y: 200 };
  const channelNodes = [
    { x: 150, y: 100, label: '@tech_news', delay: 0 },
    { x: 650, y: 100, label: '@crypto', delay: 0.5 },
    { x: 100, y: 300, label: '@startup', delay: 1 },
    { x: 700, y: 300, label: '@finance', delay: 1.5 },
    { x: 250, y: 350, label: '@ai_daily', delay: 2 },
    { x: 550, y: 350, label: '@marketing', delay: 2.5 },
  ];

  return (
    <svg
      viewBox="0 0 800 400"
      className="w-full h-full max-w-3xl mx-auto"
      style={{ filter: 'drop-shadow(0 0 40px rgba(139, 124, 246, 0.15))' }}
    >
      <defs>
        {/* Gradient for connections */}
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8b7cf6" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#8b7cf6" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#8b7cf6" stopOpacity="0.1" />
        </linearGradient>

        {/* Glow filter */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connection lines */}
      {channelNodes.map((node, i) => (
        <g key={`line-${i}`}>
          <line
            x1={botNode.x}
            y1={botNode.y}
            x2={node.x}
            y2={node.y}
            stroke="url(#lineGradient)"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="opacity-40"
          />
          {/* Animated pulse traveling along the line */}
          <circle r="4" fill="#8b7cf6" filter="url(#glow)">
            <animateMotion
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay}s`}
              path={`M${botNode.x},${botNode.y} L${node.x},${node.y}`}
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay}s`}
            />
          </circle>
        </g>
      ))}

      {/* Bot node (center) */}
      <g className="animate-pulse" style={{ animationDuration: '3s' }}>
        <circle
          cx={botNode.x}
          cy={botNode.y}
          r="50"
          fill="none"
          stroke="#8b7cf6"
          strokeWidth="1"
          strokeDasharray="8 4"
          className="opacity-30"
        />
        <circle
          cx={botNode.x}
          cy={botNode.y}
          r="35"
          fill="#1a1a22"
          stroke="#8b7cf6"
          strokeWidth="2"
          filter="url(#glow)"
        />
        {/* Bot icon - robot */}
        <g transform={`translate(${botNode.x - 14}, ${botNode.y - 14})`}>
          {/* Head */}
          <rect x="4" y="6" width="20" height="16" rx="3" fill="none" stroke="#a291f7" strokeWidth="1.5" />
          {/* Eyes */}
          <circle cx="10" cy="13" r="2" fill="#a291f7" />
          <circle cx="18" cy="13" r="2" fill="#a291f7" />
          {/* Antenna */}
          <line x1="14" y1="6" x2="14" y2="2" stroke="#a291f7" strokeWidth="1.5" />
          <circle cx="14" cy="1.5" r="1.5" fill="#a291f7" />
          {/* Smile */}
          <path d="M9 17c1.5 1.5 4.5 1.5 6 0" fill="none" stroke="#a291f7" strokeWidth="1.2" />
        </g>
      </g>

      {/* Channel nodes */}
      {channelNodes.map((node, i) => (
        <g key={`node-${i}`} style={{ animationDelay: `${node.delay * 200}ms` }} className="animate-fade-in">
          <circle
            cx={node.x}
            cy={node.y}
            r="30"
            fill="#121218"
            stroke="#3a3a45"
            strokeWidth="1"
          />
          <circle
            cx={node.x}
            cy={node.y}
            r="22"
            fill="#1a1a22"
          />
          {/* Channel icon - broadcast symbol */}
          <g transform={`translate(${node.x - 8}, ${node.y - 8})`}>
            <circle cx="8" cy="8" r="2" fill="none" stroke="#6b6b78" strokeWidth="1.5" />
            <path d="M4 4c2.2-2.2 5.8-2.2 8 0" fill="none" stroke="#6b6b78" strokeWidth="1.5" />
            <path d="M4 12c2.2 2.2 5.8 2.2 8 0" fill="none" stroke="#6b6b78" strokeWidth="1.5" />
          </g>
          {/* Channel label */}
          <text
            x={node.x}
            y={node.y + 50}
            textAnchor="middle"
            className="fill-text-tertiary text-xs"
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            {node.label}
          </text>
        </g>
      ))}

      {/* Flying comments */}
      {channelNodes.map((node, i) => (
        <g key={`comment-${i}`}>
          <rect
            width="50"
            height="16"
            rx="3"
            fill="#8b7cf6"
            fillOpacity="0.15"
          >
            <animateMotion
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
              path={`M${botNode.x - 25},${botNode.y - 8} L${node.x - 25},${node.y - 8}`}
            />
            <animate
              attributeName="fill-opacity"
              values="0;0.25;0.25;0"
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
            />
          </rect>
          {/* Comment icon */}
          <g>
            <animateMotion
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
              path={`M${botNode.x - 20},${botNode.y - 2} L${node.x - 20},${node.y - 2}`}
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
            />
            <rect x="0" y="-4" width="10" height="8" rx="1" fill="none" stroke="#a291f7" strokeWidth="1" />
            <path d="M0 4l3 3v-3" fill="#a291f7" />
          </g>
        </g>
      ))}
    </svg>
  );
}

// Mobile version: wide and short layout to fit viewport
function AnimatedNetworkMobile() {
  const botNode = { x: 250, y: 100 };
  const channelNodes = [
    { x: 60, y: 50, label: '@tech', delay: 0 },
    { x: 160, y: 170, label: '@news', delay: 0.7 },
    { x: 340, y: 170, label: '@crypto', delay: 1.4 },
    { x: 440, y: 50, label: '@startup', delay: 2.1 },
  ];

  return (
    <svg
      viewBox="0 0 500 220"
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      style={{ filter: 'drop-shadow(0 0 20px rgba(139, 124, 246, 0.15))' }}
    >
      <defs>
        <linearGradient id="lineGradientMobile" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8b7cf6" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#8b7cf6" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#8b7cf6" stopOpacity="0.1" />
        </linearGradient>
        <filter id="glowMobile">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connection lines */}
      {channelNodes.map((node, i) => (
        <g key={`line-m-${i}`}>
          <line
            x1={botNode.x}
            y1={botNode.y}
            x2={node.x}
            y2={node.y}
            stroke="url(#lineGradientMobile)"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="opacity-40"
          />
          <circle r="3" fill="#8b7cf6" filter="url(#glowMobile)">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              begin={`${node.delay}s`}
              path={`M${botNode.x},${botNode.y} L${node.x},${node.y}`}
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="2.5s"
              repeatCount="indefinite"
              begin={`${node.delay}s`}
            />
          </circle>
        </g>
      ))}

      {/* Bot node (center) */}
      <g className="animate-pulse" style={{ animationDuration: '3s' }}>
        <circle
          cx={botNode.x}
          cy={botNode.y}
          r="40"
          fill="none"
          stroke="#8b7cf6"
          strokeWidth="1"
          strokeDasharray="6 3"
          className="opacity-30"
        />
        <circle
          cx={botNode.x}
          cy={botNode.y}
          r="28"
          fill="#1a1a22"
          stroke="#8b7cf6"
          strokeWidth="1.5"
          filter="url(#glowMobile)"
        />
        {/* Bot icon */}
        <g transform={`translate(${botNode.x - 12}, ${botNode.y - 12})`}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="#a291f7" strokeWidth="1.3" />
          <circle cx="9" cy="11" r="1.8" fill="#a291f7" />
          <circle cx="15" cy="11" r="1.8" fill="#a291f7" />
          <line x1="12" y1="5" x2="12" y2="2" stroke="#a291f7" strokeWidth="1.3" />
          <circle cx="12" cy="1.5" r="1.3" fill="#a291f7" />
          <path d="M8 15c1.2 1.2 3.8 1.2 5 0" fill="none" stroke="#a291f7" strokeWidth="1" />
        </g>
      </g>

      {/* Channel nodes */}
      {channelNodes.map((node, i) => (
        <g key={`node-m-${i}`} style={{ animationDelay: `${node.delay * 200}ms` }} className="animate-fade-in">
          <circle
            cx={node.x}
            cy={node.y}
            r="24"
            fill="#121218"
            stroke="#3a3a45"
            strokeWidth="1"
          />
          <circle
            cx={node.x}
            cy={node.y}
            r="18"
            fill="#1a1a22"
          />
          {/* Broadcast icon */}
          <g transform={`translate(${node.x - 6}, ${node.y - 6})`}>
            <circle cx="6" cy="6" r="1.5" fill="none" stroke="#6b6b78" strokeWidth="1.2" />
            <path d="M3 3c1.7-1.7 4.3-1.7 6 0" fill="none" stroke="#6b6b78" strokeWidth="1.2" />
            <path d="M3 9c1.7 1.7 4.3 1.7 6 0" fill="none" stroke="#6b6b78" strokeWidth="1.2" />
          </g>
          <text
            x={node.x}
            y={node.y + 32}
            textAnchor="middle"
            className="fill-text-tertiary"
            style={{ fontFamily: 'var(--font-sans)', fontSize: '9px' }}
          >
            {node.label}
          </text>
        </g>
      ))}

      {/* Flying comments */}
      {channelNodes.map((node, i) => (
        <g key={`comment-m-${i}`}>
          <rect
            width="30"
            height="12"
            rx="2"
            fill="#8b7cf6"
            fillOpacity="0.15"
          >
            <animateMotion
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay + 0.8}s`}
              path={`M${botNode.x - 15},${botNode.y - 6} L${node.x - 15},${node.y - 6}`}
            />
            <animate
              attributeName="fill-opacity"
              values="0;0.25;0.25;0"
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay + 0.8}s`}
            />
          </rect>
        </g>
      ))}
    </svg>
  );
}

// ============================================
// ANIMATED COUNTER
// ============================================

function AnimatedCounter({ target, suffix = '', duration = 2000 }: { target: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const startTime = performance.now();

          const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(easeOut * target));

            if (progress < 1) {
              requestAnimationFrame(animate);
            }
          };

          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [target, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {count.toLocaleString('ru-RU')}{suffix}
    </span>
  );
}

// ============================================
// FEATURE CARD
// ============================================

function FeatureCard({ icon, title, description, delay }: { icon: React.ReactNode; title: string; description: string; delay: number }) {
  return (
    <div
      className="group p-6 bg-neutral-900 border border-neutral-800 rounded-xl hover:border-accent-500/30 transition-all duration-300 animate-slide-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      <div className="w-12 h-12 rounded-lg bg-accent-500/10 flex items-center justify-center mb-4 group-hover:bg-accent-500/20 transition-colors text-accent-400">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-primary mb-2">{title}</h3>
      <p className="text-sm text-tertiary leading-relaxed">{description}</p>
    </div>
  );
}

// ============================================
// MAIN LANDING PAGE
// ============================================

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Header currentPage="landing" />

      {/* ============================================
          HERO SECTION
          ============================================ */}
      <section className="min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)] flex flex-col px-4 sm:px-6">
        <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-16 pt-6 sm:pt-10 pb-6">
          {/* Text Content */}
          <div className="lg:flex-1 text-center lg:text-left animate-fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-500/10 border border-accent-500/20 text-accent-400 text-xs sm:text-sm mb-4 sm:mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
              Автоматизация комментирования
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-primary mb-4 sm:mb-6 tracking-tight animate-slide-up" style={{ animationDelay: '100ms' }}>
              Умный бот для
              <br />
              <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
                Telegram-каналов
              </span>
            </h1>
            <p className="text-base sm:text-lg text-secondary max-w-2xl mx-auto lg:mx-0 mb-6 sm:mb-8 animate-slide-up" style={{ animationDelay: '200ms' }}>
              AI-комментирование через DeepSeek/OpenAI с ротацией аккаунтов.
              Детект shadowban, защита от блокировок, real-time аналитика.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 sm:gap-4 animate-slide-up" style={{ animationDelay: '300ms' }}>
              <a
                href="https://github.com/litury/puppetgram"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto px-8 py-3 bg-accent-500 hover:bg-accent-600 text-white font-medium rounded-lg transition-colors text-center inline-flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Клонировать
              </a>
              <Link
                href="/dashboard"
                className="w-full sm:w-auto px-8 py-3 bg-neutral-850 hover:bg-neutral-800 text-primary font-medium rounded-lg border border-neutral-700 transition-colors text-center"
              >
                Открыть Dashboard
              </Link>
            </div>
          </div>

          {/* Network Animation - fills remaining space */}
          <div className="flex-1 min-h-0 animate-scale-in" style={{ animationDelay: '400ms' }}>
            {/* Desktop: full AnimatedNetwork */}
            <div className="hidden lg:block h-full min-h-100">
              <AnimatedNetwork />
            </div>
            {/* Mobile/Tablet: wide compact AnimatedNetworkMobile */}
            <div className="lg:hidden w-full max-w-md mx-auto">
              <AnimatedNetworkMobile />
            </div>
          </div>
        </div>
      </section>

      {/* ============================================
          STATS SECTION
          ============================================ */}
      <section className="py-16 px-6 border-y border-neutral-800/50 bg-neutral-900/30">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-primary mb-1">
                <AnimatedCounter target={50000} suffix="+" />
              </p>
              <p className="text-sm text-tertiary">Комментариев</p>
            </div>
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-accent-500 mb-1">
                <AnimatedCounter target={150} suffix="+" />
              </p>
              <p className="text-sm text-tertiary">Активных каналов</p>
            </div>
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-primary mb-1">
                <AnimatedCounter target={99} suffix="%" />
              </p>
              <p className="text-sm text-tertiary">Uptime</p>
            </div>
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-primary mb-1">
                <AnimatedCounter target={24} suffix="/7" />
              </p>
              <p className="text-sm text-tertiary">Мониторинг</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================
          FEATURES SECTION
          ============================================ */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-widest text-accent-400 mb-3">Возможности</p>
            <h2 className="text-3xl md:text-4xl font-bold text-primary">
              Всё что нужно для автоматизации
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<BrainIcon />}
              title="DeepSeek / OpenAI"
              description="AI-генерация комментариев через DeepSeek или OpenAI. Контекстные ответы с учётом тональности канала."
              delay={0}
            />
            <FeatureCard
              icon={<DevicesIcon />}
              title="Ротация аккаунтов"
              description="Лимит 100 комментариев на аккаунт. Автоматическое переключение между профилями для масштабирования."
              delay={100}
            />
            <FeatureCard
              icon={<ShieldIcon />}
              title="Детект shadowban"
              description="Автоматическое определение бана через @SpamBot. Мгновенное переключение на резервный аккаунт."
              delay={200}
            />
            <FeatureCard
              icon={<ChartIcon />}
              title="Real-time аналитика"
              description="Dashboard с графиками активности, статистикой комментариев и лентой в реальном времени."
              delay={300}
            />
            <FeatureCard
              icon={<TargetIcon />}
              title="AI-фильтрация"
              description="Интерактивная фильтрация каналов. Автоматическая отписка от нерелевантных источников."
              delay={400}
            />
            <FeatureCard
              icon={<BoltIcon />}
              title="GramJS + TypeScript"
              description="Нативная интеграция с Telegram API. Управление сессиями, 2FA, конвертация SQLite/TData."
              delay={500}
            />
          </div>
        </div>
      </section>

      {/* ============================================
          CTA SECTION
          ============================================ */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="p-12 bg-gradient-to-br from-accent-500/10 to-accent-600/5 rounded-2xl border border-accent-500/20">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">
              Open Source
            </h2>
            <p className="text-secondary mb-8 max-w-xl mx-auto">
              Puppetgram — open source проект. Клонируйте репозиторий, настройте .env и запускайте свою автоматизацию.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://github.com/litury/puppetgram"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 bg-accent-500 hover:bg-accent-600 text-white font-medium rounded-lg transition-colors inline-flex items-center gap-2"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                GitHub
              </a>
              <Link
                href="/dashboard"
                className="text-secondary hover:text-primary transition-colors"
              >
                Смотреть демо
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================
          FOOTER
          ============================================ */}
      <footer className="py-8 px-6 md:px-8 lg:px-12 border-t border-neutral-800/50">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-accent-400">
            <PuppetgramLogo className="w-14 h-14" size={56} />
            <span className="text-sm text-tertiary">Puppetgram 2026</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/litury/puppetgram" target="_blank" rel="noopener noreferrer" className="text-sm text-tertiary hover:text-secondary transition-colors">
              GitHub
            </a>
            <a href="https://t.me/divatoz" target="_blank" rel="noopener noreferrer" className="text-sm text-tertiary hover:text-secondary transition-colors">
              Telegram
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
