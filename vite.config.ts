import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig(() => {
  const isElectron = process.env.ELECTRON === 'true';

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(isElectron
        ? [
            electron([
              {
                // Main process entry file
                entry: 'electron/main.ts',
                vite: {
                  build: {
                    outDir: 'dist-electron',
                    rollupOptions: {
                      external: ['better-sqlite3'],
                    },
                  },
                },
              },
              {
                entry: 'electron/preload.ts',
                onstart(options) {
                  options.reload();
                },
                vite: {
                  build: {
                    outDir: 'dist-electron',
                  },
                },
              },
            ]),
            renderer(),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Allow all local network IPs, ngrok, Cloudflare tunnels, and local domains
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          timeout: 60000,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              console.warn('⚠️ Vite API proxy error:', (err as any)?.code || err.message);
              if (res && !('headersSent' in res && (res as any).headersSent)) {
                try {
                  (res as any).writeHead(502, { 'Content-Type': 'application/json' });
                  (res as any).end(JSON.stringify({ error: 'Backend server is reconnecting or waking up. Please retry.' }));
                } catch {
                  // ignore
                }
              }
            });
          },
        },
        '/socket.io': {
          target: 'http://localhost:4000',
          ws: true,
          changeOrigin: true,
          timeout: 60000,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.warn('⚠️ Vite WebSocket proxy notice:', (err as any)?.code || err.message);
            });
          },
        },
      },
    },
  };
});
