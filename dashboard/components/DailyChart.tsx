'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
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
  const [dailyData, setDailyData] = useState<DataPoint[]>([]);
  const [hourlyData, setHourlyData] = useState<DataPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');

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
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 md:p-6 border border-white/20 h-full flex flex-col">
      {/* Header с заголовком и статистикой */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 md:mb-6">
        {/* Заголовок и статистика */}
        <div className="flex items-baseline gap-4 md:gap-6 flex-wrap">
          <div>
            <h1 className="text-lg md:text-xl font-semibold text-white">Комментарии</h1>
            <p className="text-white/40 text-xs">активность бота</p>
          </div>
          <div className="flex items-baseline gap-4">
            <div>
              <p className="text-xl md:text-2xl font-bold text-white">
                {stats?.totalComments.toLocaleString('ru-RU') ?? '—'}
              </p>
              <p className="text-white/50 text-xs">всего</p>
            </div>
            <div>
              <p className="text-lg md:text-xl font-semibold text-violet-400">
                +{stats?.todayComments ?? 0}
              </p>
              <p className="text-white/40 text-xs">сегодня</p>
            </div>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
          <button
            onClick={() => setViewMode('daily')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              viewMode === 'daily'
                ? 'bg-violet-500 text-white'
                : 'text-white/60 hover:text-white'
            }`}
          >
            По дням
          </button>
          <button
            onClick={() => setViewMode('hourly')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              viewMode === 'hourly'
                ? 'bg-violet-500 text-white'
                : 'text-white/60 hover:text-white'
            }`}
          >
            По часам
          </button>
        </div>
      </div>

      {/* График - растягивается на всю оставшуюся высоту */}
      <div className="flex-1 min-h-[180px]">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-full h-full bg-white/5 rounded-lg animate-pulse" />
          </div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-white/40">
            Нет данных
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={180}>
            <AreaChart data={currentData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="time"
                tickFormatter={formatTime}
                stroke="rgba(255,255,255,0.4)"
                fontSize={11}
                tick={{ fill: 'rgba(255,255,255,0.4)' }}
              />
              <YAxis
                stroke="rgba(255,255,255,0.4)"
                fontSize={11}
                tick={{ fill: 'rgba(255,255,255,0.4)' }}
                width={35}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  color: 'white',
                }}
                labelFormatter={formatTooltip}
                formatter={(value) => [value as number, 'Комментариев']}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#8b5cf6"
                strokeWidth={2}
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
