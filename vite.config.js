import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        welcome: resolve(process.cwd(), 'index.html'),
        game: resolve(process.cwd(), 'oyna/index.html'),
      },
    },
  },
});
