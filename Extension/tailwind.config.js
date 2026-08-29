/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        h1: ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        h2: ['20px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      colors: {
        brand: {
          teal: '#007F8B',
          'teal-dark': '#006C76',
          accent: '#A87500',
          soft: '#C8D0CF',
          gradientFrom: '#00A0A8',
          gradientTo: '#006C76',
        },
        surface: {
          dark: '#111820',
          'dark-elevated': '#182229',
          light: '#F1F3F1',
          card: '#FFFFFF',
        },
        border: {
          DEFAULT: '#344249',
        },
        muted: '#53616B',
      },
      borderRadius: {
        popup: '12px',
      },
      boxShadow: {
        'glow-teal': '0 0 24px rgba(0, 127, 139, 0.32)',
        'glow-teal-intense': '0 0 36px rgba(0, 160, 168, 0.42)',
      },
      animation: {
        pulseGlow: 'pulseGlow 2s ease-in-out infinite',
        waveform: 'waveform 1.2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.28s ease-out',
        indeterminate: 'indeterminate 1.1s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 16px rgba(0, 127, 139, 0.26)' },
          '50%': { boxShadow: '0 0 32px rgba(0, 160, 168, 0.42)' },
        },
        waveform: {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(3px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        indeterminate: {
          '0%': { left: '-40%' },
          '100%': { left: '100%' },
        },
      },
    },
  },
  plugins: [],
}
