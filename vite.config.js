import { defineConfig } from 'vite';
import { attachRelay } from './server/relay.js';

// Multiplayer: the dev server (npm run dev) and the preview server (npm run serve) both host
// the relay on /mp, so everyone who opens the site can play together.
const multiplayer = () => ({
  name: 'dcb-multiplayer',
  configureServer(server) {
    if (server.httpServer) attachRelay(server.httpServer);
  },
  configurePreviewServer(server) {
    if (server.httpServer) attachRelay(server.httpServer);
  },
});

export default defineConfig({
  // relative asset paths: the build works at any address, e.g. GitHub Pages' /<repo>/
  base: './',
  plugins: [multiplayer()],
  server: {
    port: 5173,
    strictPort: false,
    // native file events on this drive sometimes drop rapid successive writes
    watch: { usePolling: true, interval: 150 },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
