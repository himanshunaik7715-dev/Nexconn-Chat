import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export default defineConfig(({ mode }) => {
  // Keep Vite's API proxy aligned with the backend's PORT from .env.
  const serverPort = loadEnv(mode, process.cwd(), 'PORT').PORT || '3001';
  return ({
    plugins: [react()],
    resolve: {
      alias: [
        { find: '@', replacement: resolve(__dirname, 'src') },
        // Use Lit's production entry points for the vendor Chat UI in dev too.
        // Keep Vite/React in development mode for normal HMR and diagnostics.
        { find: /^lit$/, replacement: resolve(__dirname, 'node_modules/lit/index.js') },
        { find: /^lit-html$/, replacement: resolve(__dirname, 'node_modules/lit-html/lit-html.js') },
        { find: /^lit-html\/is-server\.js$/, replacement: resolve(__dirname, 'node_modules/lit-html/is-server.js') },
        { find: /^lit-element\/lit-element\.js$/, replacement: resolve(__dirname, 'node_modules/lit-element/lit-element.js') },
        { find: /^@lit\/reactive-element$/, replacement: resolve(__dirname, 'node_modules/@lit/reactive-element/reactive-element.js') },
      ],
    },
    define: {
      __VERSION__: JSON.stringify('26.2.0'),
      __COMMIT_ID__: JSON.stringify('dev'),
      __DEV__: JSON.stringify(mode !== 'production'),
    },
    server: {
      proxy: {
        '/api': { target: `http://localhost:${serverPort}`, changeOrigin: false },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/@nexconn/chat/')) return 'chat-sdk';
            if (id.includes('/node_modules/@nexconn/engine/')) return 'engine-sdk';
            if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/')) return 'react';
          },
        },
      },
    },
  });
});
