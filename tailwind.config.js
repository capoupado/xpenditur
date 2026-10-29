/** @type {import('tailwindcss').Config} */

// xPenditur design system — dark "field" palette: near-black green ink,
// cream type, lime accent, brick red for spend. The default Tailwind gray /
// emerald / red / amber scales are REMAPPED onto these tokens so every
// existing `text-gray-500` / `bg-emerald-600` in the app re-skins at once.
const cream = (a) => `rgba(242, 232, 207, ${a})`;

export default {
  darkMode: 'class',
  content: ['./src/client/**/*.{js,jsx,ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Raw tokens — prefer these in new code.
        ink: { DEFAULT: '#080d0a', raised: '#0a110d', panel: '#0b120e' },
        cream: {
          DEFAULT: '#f2e8cf',
          dim: cream(0.72),
          muted: cream(0.52),
          faint: cream(0.38),
          line: cream(0.14),
          hair: cream(0.1),
          film: cream(0.05),
        },
        lime: { 50: '#e4f0c4', DEFAULT: '#a7c957', mid: '#6a994e', deep: '#386641' },
        brick: { DEFAULT: '#bc4749', light: '#e88f8f' },
        sand: '#cbbf9a',
        amber: { DEFAULT: '#d99a4e', 400: '#d99a4e', 500: '#d99a4e' },

        // Remapped defaults so legacy utility classes land on the palette.
        gray: {
          50: '#ffffff',
          100: '#f2e8cf',
          200: cream(0.86),
          300: cream(0.72),
          400: cream(0.6),
          500: cream(0.46),
          600: cream(0.32),
          700: cream(0.18),
          800: cream(0.12),
          900: cream(0.05),
          950: '#080d0a',
        },
        emerald: {
          300: '#e4f0c4',
          400: '#a7c957',
          500: '#a7c957',
          600: '#6a994e',
          700: '#386641',
          800: '#2b4f33',
          900: '#1d3524',
        },
        red: {
          300: '#f0b0b0',
          400: '#e88f8f',
          500: '#bc4749',
          600: '#bc4749',
          700: '#8f3335',
          900: '#4a1d1e',
        },
        yellow: { 400: '#cbbf9a', 500: '#cbbf9a' },
        orange: { 400: '#d99a4e', 500: '#d99a4e' },
      },
      borderRadius: {
        // The reference design is strictly square-cornered.
        DEFAULT: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '0px',
      },
      letterSpacing: {
        label: '0.1em',
        tight: '-0.02em',
        tighter: '-0.035em',
      },
      keyframes: {
        xpBloom: {
          '0%,100%': { opacity: '.75', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.06)' },
        },
        xpSheen: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(340%)' },
        },
      },
      animation: {
        bloom: 'xpBloom 15s ease-in-out infinite',
        'bloom-slow': 'xpBloom 19s ease-in-out infinite reverse',
        sheen: 'xpSheen 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
