import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No /api proxy here — this build has no backend at all. Every network call
// is intercepted client-side by src/mocks/server.ts (axios-mock-adapter)
// with static fake data, so the app runs fully offline.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
      }
    }
  }
})
