'use client';

import { useState, useEffect } from 'react';
import { useTheme } from './ThemeProvider';

// SVG иконки
function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // До монтирования — placeholder той же формы чтобы избежать hydration mismatch
  if (!mounted) {
    return (
      <div className="flex gap-1 bg-neutral-850 rounded-lg p-1">
        <div className="p-2 rounded-md w-8 h-8" />
        <div className="p-2 rounded-md w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="flex gap-1 bg-neutral-850 rounded-lg p-1">
      <button
        onClick={() => setTheme('light')}
        title="Светлая тема"
        aria-label="Светлая тема"
        className={`p-2 rounded-md transition-all duration-[250ms] ${
          theme === 'light'
            ? 'bg-accent-500 text-white shadow-sm'
            : 'text-tertiary hover:text-primary hover:bg-neutral-800'
        }`}
      >
        <SunIcon />
      </button>

      <button
        onClick={() => setTheme('dark')}
        title="Тёмная тема"
        aria-label="Тёмная тема"
        className={`p-2 rounded-md transition-all duration-[250ms] ${
          theme === 'dark'
            ? 'bg-accent-500 text-white shadow-sm'
            : 'text-tertiary hover:text-primary hover:bg-neutral-800'
        }`}
      >
        <MoonIcon />
      </button>
    </div>
  );
}
