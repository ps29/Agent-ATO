import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The server only accepts localhost Host headers, so the dev proxy rewrites Host to the target.
const target = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target, changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'node' },
});
