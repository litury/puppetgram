'use client';

import { useState, useEffect } from 'react';
import { API_URL } from '@/lib/config';

interface Stats {
  totalComments: number;
  todayComments: number;
}

export function StatsCard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`${API_URL}/api/stats`);
        const data = await res.json();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 h-[100px] transition-all duration-300 hover:shadow-lg hover:shadow-accent-500/10">
      {loading ? (
        <div className="animate-pulse flex items-baseline gap-4 h-full">
          <div>
            <div className="h-10 bg-white/10 rounded w-32 mb-2"></div>
            <div className="h-4 bg-white/10 rounded w-40"></div>
          </div>
          <div className="ml-auto text-right">
            <div className="h-8 bg-white/10 rounded w-16 mb-1"></div>
            <div className="h-4 bg-white/10 rounded w-14"></div>
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-4">
          <div>
            <p className="text-4xl font-bold text-white">
              {stats?.totalComments.toLocaleString('ru-RU') ?? 0}
            </p>
            <p className="text-white/60 mt-1">всего комментариев</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl font-semibold text-violet-400">
              +{stats?.todayComments ?? 0}
            </p>
            <p className="text-white/40 text-sm">сегодня</p>
          </div>
        </div>
      )}
    </div>
  );
}
