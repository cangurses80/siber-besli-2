import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        welcome: resolve(process.cwd(), 'index.html'),
        game: resolve(process.cwd(), 'oyna/index.html'),
      },
    },
  },
});
