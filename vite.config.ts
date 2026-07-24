import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiPlugin } from './vite-plugin-api.ts'

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
})
