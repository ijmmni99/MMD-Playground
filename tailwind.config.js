/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0f1115', panel: '#161920', raised: '#1d212b', hover: '#252a36' },
        line: '#2a2f3b',
        // dim/muted keep ≥ 4.5:1 on the panel background for small text (WCAG AA).
        fg: { DEFAULT: '#e6e8ee', muted: '#a3aaba', dim: '#8b93a7' },
        // `strong` is for filled backgrounds behind white text (≥ 4.5:1).
        accent: { DEFAULT: '#6d8bff', hover: '#3f5ddb', strong: '#4c6bea', soft: 'rgba(109,139,255,0.15)' },
        danger: '#ff6b6b',
        warn: '#f5b84a',
        ok: '#4fd18b',
      },
      screens: {
        // Touch-first devices (phones, tablets): bigger targets, no hover reveals.
        coarse: { raw: '(pointer: coarse)' },
      },
      fontFamily: { mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};
