import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    hmr: {
      clientPort: 443,
      protocol: 'wss',
      timeout: 120000
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 3000
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