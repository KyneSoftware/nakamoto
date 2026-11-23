import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { seo } from './seo';

// Multi-page static site, served at the root of nakamoto.kyne.eu (GitHub Pages custom domain).
export default defineConfig({
  base: '/',
  plugins: [seo(resolve(import.meta.dirname, 'public/data'))],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
});
