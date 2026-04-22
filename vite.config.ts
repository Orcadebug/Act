import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['uiohook-napi', 'active-win', 'better-sqlite3', 'keytar', 'screenshot-desktop']
            }
          }
        }
      }
    ]),
    renderer()
  ]
});
