import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-page static site, served at the root of nakamoto.kyne.eu (GitHub Pages custom domain).
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
});
