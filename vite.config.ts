import { defineConfig } from 'vite';

// Keep the user's original AppDeploy UI and source layout unchanged.
export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
