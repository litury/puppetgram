/**
 * Design Tokens - Single Source of Truth
 *
 * Эти токены используются в:
 * - globals.css (CSS переменные)
 * - manifest.json (PWA theme)
 * - meta tags (browser UI)
 */

export const designTokens = {
  // Colors - Accent
  accent: {
    400: '#a291f7',
    500: '#8b7cf6', // Primary brand color
    600: '#6d5cd6',
    950: '#1e1a35',
  },

  // Colors - Neutral (Dark theme)
  neutral: {
    950: '#0a0a0f',
    900: '#121218',
    850: '#1a1a22',
    800: '#252530',
    700: '#3a3a45',
  },

  // Colors - Text
  text: {
    primary: '#fafafa',
    secondary: '#a0a0ab',
    tertiary: '#6b6b78',
    disabled: '#4a4a55',
  },

  // Colors - Semantic
  semantic: {
    success: '#6ee7b7',
    warning: '#fbbf24',
    error: '#f87171',
  },
} as const;

// Export commonly used colors
export const BRAND_COLOR = designTokens.accent[500]; // #8b7cf6
export const BACKGROUND_COLOR = designTokens.neutral[950]; // #0a0a0f
