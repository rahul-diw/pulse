import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
// `vite build --mode demo` => ONE html file where the real API core runs inside the browser (no backend needed).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000', '/socket.io': { target: 'http://localhost:4000', ws: true } }, fs: { allow: ['..'] } },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
}));
