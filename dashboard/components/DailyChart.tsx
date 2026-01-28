'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTheme } from './ThemeProvider';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  time: string;
  count: number;
}

interface Stats {
  totalComments: number;
  todayComments: number;
}

type ViewMode = 'daily' | 'hourly';

export function DailyChart() {
  const { resolvedTheme } = useTheme();
  const [dailyData, setDailyData] = useState<DataPoint[]>([]);
  const [hourlyData, setHourlyData] = useState<DataPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');

  // Theme-aware chart colors
  const chartColors = resolvedTheme === 'light' ? {
    grid: 'rgba(0,0,0,0.08)',
    axis: 'rgba(0,0,0,0.15)',
    axisText: '#8a8a95',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e5e5e8',
    tooltipText: '#1a1a1f',
    tooltipLabel: '#8a8a95',
  } : {
    grid: 'rgba(255,255,255,0.03)',
    axis: 'rgba(255,255,255,0.1)',
    axisText: '#6b6b78',
    tooltipBg: '#1a1a22',
    tooltipBorder: '#3a3a45',
    tooltipText: '#fafafa',
    tooltipLabel: '#a0a0ab',
  };

  // WebSocket: обновление счётчиков в реальном времени
  const handleWsMessage = useCallback((msg: { type: string }) => {
    if (msg.type === 'new_comment') {
      setStats(prev => prev ? {
        ...prev,
        totalComments: prev.totalComments + 1,
        todayComments: prev.todayComments + 1,
      } : prev);
    }
  }, []);

  useWebSocket(handleWsMessage);

  // Загрузка статистики
  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    }
    fetchStats();
  }, []);

  // Загрузка данных графика
  useEffect(() => {
    async function fetchData() {
      const currentData = viewMode === 'daily' ? dailyData : hourlyData;
      if (currentData.length === 0) {
        setLoading(true);
      }

      try {
        const endpoint = viewMode === 'daily' ? '/api/daily' : '/api/timeline';
        const res = await fetch(endpoint);
        const json = await res.json();

        if (viewMode === 'daily') {
          setDailyData(json.data || []);
        } else {
          setHourlyData(json.data || []);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const formatDayTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
  };

  const formatHourTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', timeZone: 'Europe/Moscow' });
  };

  const formatDayTooltip = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
  };

  const formatHourTooltip = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow'
    });
  };

  const currentData = viewMode === 'daily' ? dailyData : hourlyData;
  const hasData = currentData.length > 0;
  const formatTime = viewMode === 'daily' ? formatDayTime : formatHourTime;
  const formatTooltip = viewMode === 'daily' ? formatDayTooltip : formatHourTooltip;

  return (
    <div className="bg-neutral-900 rounded-xl p-6 md:p-8 border border-neutral-800 h-full flex flex-col">
      {/* Заголовок секции */}
      <p className="text-xs uppercase tracking-wide text-tertiary mb-6">
        Активность комментирования
      </p>

      {/* Статистика */}
      <div className="flex items-baseline gap-6 mb-6 pb-6 border-b border-neutral-800">
        {/* Всего */}
        <div>
          <p className="text-3xl font-semibold tracking-tight text-primary tabular-nums">
            {stats?.totalComments.toLocaleString('ru-RU') ?? '—'}
          </p>
          <p className="text-xs text-tertiary mt-1">Всего комментариев</p>
        </div>

        {/* Разделитель */}
        <div className="h-10 w-px bg-neutral-800" />

        {/* Сегодня */}
        <div>
          <p className="text-2xl font-semibold tracking-tight text-accent-500 tabular-nums">
            +{stats?.todayComments ?? 0}
          </p>
          <p className="text-xs text-tertiary mt-1">Сегодня</p>
        </div>
      </div>

      {/* Toggle кнопки */}
      <div className="flex gap-1 bg-neutral-850 rounded-lg p-1 w-fit mb-4">
        <button
          onClick={() => setViewMode('daily')}
          className={`px-4 py-2 text-sm rounded-md transition-all duration-[250ms] ${
            viewMode === 'daily'
              ? 'bg-accent-500/10 text-accent-400 border border-accent-500/20'
              : 'text-secondary hover:text-primary hover:bg-neutral-800'
          }`}
        >
          По дням
        </button>
        <button
          onClick={() => setViewMode('hourly')}
          className={`px-4 py-2 text-sm rounded-md transition-all duration-[250ms] ${
            viewMode === 'hourly'
              ? 'bg-accent-500/10 text-accent-400 border border-accent-500/20'
              : 'text-secondary hover:text-primary hover:bg-neutral-800'
          }`}
        >
          По часам
        </button>
      </div>

      {/* График - растягивается на всю оставшуюся высоту */}
      <div className="flex-1 min-h-[180px]">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-full h-full bg-neutral-850 rounded-lg animate-pulse" />
          </div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-tertiary">
            Нет данных
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={180}>
            <AreaChart data={currentData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b7cf6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#8b7cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} strokeWidth={0.5} />
              <XAxis
                dataKey="time"
                tickFormatter={formatTime}
                stroke={chartColors.axis}
                fontSize={11}
                tick={{ fill: chartColors.axisText }}
              />
              <YAxis
                stroke={chartColors.axis}
                fontSize={11}
                tick={{ fill: chartColors.axisText }}
                width={35}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: chartColors.tooltipBg,
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  borderRadius: '8px',
                  color: chartColors.tooltipText,
                  fontSize: '13px',
                  padding: '8px 12px',
                }}
                labelStyle={{ color: chartColors.tooltipLabel, fontSize: '11px' }}
                labelFormatter={formatTooltip}
                formatter={(value) => [value as number, 'Комментариев']}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#8b7cf6"
                strokeWidth={1.5}
                fillOpacity={1}
                fill="url(#colorCount)"
                isAnimationActive={true}
                animationDuration={300}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
