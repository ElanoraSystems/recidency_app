import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Vite checks the Host header against allowedHosts and 403s anything
    // unrecognized — needed so an ngrok tunnel's *.ngrok-free.app / .ngrok.io
    // domain isn't rejected before it ever reaches the app.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io', '.ngrok.app'],
    proxy: {
      // 8010, not 8000 — this machine also runs a Frappe bench that claims
      // 8000, and it kept reclaiming the port out from under this backend.
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
})
