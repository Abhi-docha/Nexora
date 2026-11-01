import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    build: {
      rollupOptions: {
        external: [/^https?:\/\//],
      },
    },
    server: {
      // HMR is disabled in AI Studio
      hmr: false,
      watch: null,
    },
  };
});
