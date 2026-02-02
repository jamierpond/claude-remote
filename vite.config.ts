import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.SERVER_URL || 'http://localhost:6767',
      },
      '/ws': {
        target: (process.env.SERVER_URL || 'http://localhost:6767').replace('https://', 'wss://').replace('http://', 'ws://'),
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
  },
});
