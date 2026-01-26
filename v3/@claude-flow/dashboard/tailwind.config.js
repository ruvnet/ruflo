/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Status Colors
        'status-active': '#22c55e',
        'status-idle': '#64748b',
        'status-busy': '#f59e0b',
        'status-error': '#ef4444',
        'status-spawning': '#3b82f6',
        // Operation Colors
        'op-store': '#22c55e',
        'op-retrieve': '#3b82f6',
        'op-search': '#a855f7',
        'op-delete': '#ef4444',
        // Message Types
        'msg-task': '#3b82f6',
        'msg-result': '#22c55e',
        'msg-query': '#f59e0b',
        'msg-error': '#ef4444',
        // Background
        'bg-primary': '#0f172a',
        'bg-secondary': '#1e293b',
        'bg-tertiary': '#334155',
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
