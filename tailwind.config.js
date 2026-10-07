/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0f1115', panel: '#161920', raised: '#1d212b', hover: '#252a36' },
        line: '#2a2f3b',
        fg: { DEFAULT: '#e6e8ee', muted: '#9aa1b2', dim: '#6b7285' },
        accent: { DEFAULT: '#6d8bff', hover: '#859dff', soft: 'rgba(109,139,255,0.15)' },
        danger: '#ff6b6b',
        warn: '#f5b84a',
        ok: '#4fd18b',
      },
      fontFamily: { mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};
