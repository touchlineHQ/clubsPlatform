import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:8788",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
