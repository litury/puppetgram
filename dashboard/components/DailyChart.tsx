'use client';

import { useState, useEffect, useRef } from 'react';
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

type ViewMode = 'hours' | 'days';

export function DailyChart() {
  const [data, setData] = useState<DataPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('hours');
  const [period, setPeriod] = useState(24);
  const [loading, setLoading] = useState(true);
  const isInitialLoad = useRef(true);

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
      if (isInitialLoad.current) {
        setLoading(true);
      }

      try {
        let res;
        if (viewMode === 'hours') {
          res = await fetch(`/api/timeline?hours=${period}`);
        } else {
          res = await fetch(`/api/daily?days=${period}`);
        }
        const json = await res.json();

        const rawData = json.data || [];
        if (viewMode === 'days') {
          setData(rawData.map((d: { date: string; count: number }) => ({
            time: d.date,
            count: d.count,
          })));
        } else {
          setData(rawData);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
        isInitialLoad.current = false;
      }
    }
    fetchData();
  }, [viewMode, period]);

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    if (viewMode === 'hours') {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
  };

  const formatTooltipLabel = (timeStr: string) => {
    const date = new Date(timeStr);
    if (viewMode === 'hours') {
      return date.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        timeZone: 'Europe/Moscow',
      }) + ':00 МСК';
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
  };

  const periodOptions = viewMode === 'hours'
    ? [{ value: 6, label: '6ч' }, { value: 24, label: '24ч' }, { value: 72, label: '3д' }]
    : [{ value: 7, label: '7д' }, { value: 30, label: '30д' }, { value: 90, label: '90д' }];

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 md:p-6 border border-white/20 h-full flex flex-col">
      {/* Header с заголовком, статистикой и переключателями */}
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

        {/* Переключатели */}
        <div className="flex flex-wrap gap-2">
          {/* Режим: часы/дни */}
          <div className="flex gap-1">
            <button
              onClick={() => { setViewMode('hours'); setPeriod(24); }}
              className={`px-2 py-1 rounded-lg text-xs transition-all ${
                viewMode === 'hours'
                  ? 'bg-violet-500/30 text-violet-300 border border-violet-400/30'
                  : 'bg-white/5 text-white/40 hover:bg-white/10'
              }`}
            >
              Часы
            </button>
            <button
              onClick={() => { setViewMode('days'); setPeriod(30); }}
              className={`px-2 py-1 rounded-lg text-xs transition-all ${
                viewMode === 'days'
                  ? 'bg-violet-500/30 text-violet-300 border border-violet-400/30'
                  : 'bg-white/5 text-white/40 hover:bg-white/10'
              }`}
            >
              Дни
            </button>
          </div>
          {/* Период */}
          <div className="flex gap-1">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`w-9 md:w-10 py-1 rounded-lg text-xs md:text-sm transition-all text-center ${
                  period === opt.value
                    ? 'bg-white/20 text-white'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* График - растягивается на всю оставшуюся высоту */}
      <div className="flex-1 min-h-[180px]">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-full h-full bg-white/5 rounded-lg animate-pulse" />
          </div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/40">
            Нет данных за выбранный период
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
                labelFormatter={formatTooltipLabel}
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
