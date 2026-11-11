import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@flowstudio/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/mcp': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/collaboration': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
});
