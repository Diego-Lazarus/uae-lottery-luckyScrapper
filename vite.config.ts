import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths, so the build works under any GitHub Pages sub-path.
  base: './',
  plugins: [react()],
  server: {
    // Dev only: makes the official API same-origin so the Live API source can
    // be used from the browser. Production builds never call the API.
    proxy: {
      '/qapi': {
        target: 'https://www.theuaelottery.ae',
        changeOrigin: true,
        headers: { Referer: 'https://www.theuaelottery.ae/lottery/luckyday/results' },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500, // exceljs is lazy-loaded into its own chunk
  },
})
