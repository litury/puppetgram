/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Golos Text"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        paper: '#FAFAF8',
        ink: '#16150F',
        muted: '#6E6A5E',
        line: '#E4E1D6',
        accent: '#E8410E',
      },
    },
  },
  plugins: [],
};
