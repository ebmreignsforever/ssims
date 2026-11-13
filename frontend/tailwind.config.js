/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07111f',
          900: '#0b1829',
          800: '#12263d',
          700: '#1b3654',
          600: '#284b70',
        },
        brand: {
          50: '#ecfdf8',
          100: '#d2faee',
          200: '#a8f3dd',
          300: '#6ee7c8',
          400: '#2dd4ad',
          500: '#10b394',
          600: '#0b8f78',
          700: '#0b7262',
          800: '#0c5a50',
          900: '#0c4a43',
        },
        accent: {
          100: '#fdf3d7',
          200: '#fae6a8',
          300: '#f4d276',
          400: '#edba47',
          500: '#d9a441',
          600: '#b88225',
          700: '#93651f',
        },
        canvas: '#f4f7fa',
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Display"', '"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Code"', '"SFMono-Regular"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(7,17,31,0.04), 0 14px 40px -24px rgba(7,17,31,0.22)',
        float: '0 24px 70px -25px rgba(7,17,31,0.35)',
        glow: '0 0 0 1px rgba(16,179,148,0.15), 0 18px 45px -20px rgba(16,179,148,0.5)',
      },
      backgroundImage: {
        'grid-dark':
          "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
        'radial-brand': 'radial-gradient(circle at 30% 20%, rgba(45,212,173,0.16), transparent 50%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(16,179,148,0.35)' },
          '70%': { boxShadow: '0 0 0 10px rgba(16,179,148,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(16,179,148,0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-ring': 'pulse-ring 2.2s infinite',
      },
    },
  },
  plugins: [],
};
