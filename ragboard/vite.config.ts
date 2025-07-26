import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    hmr: {
      host: 'localhost',
      port: 5173,
      protocol: 'ws',
      timeout: 120000
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173
  },
  resolve: {
    alias: {
      '@': '/src',
      '@types': '/src/types'
    }
  },
  optimizeDeps: {
    include: ['@xyflow/react', 'zustand', 'axios']
  }
})