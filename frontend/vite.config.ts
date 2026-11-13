import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Atomic editor temp directories can otherwise trip the Windows watcher.
      ignored: ['**/*.tmp', '**/*.tmpdir/**', '**/.types.ts.*.tmpdir/**'],
    },
    proxy: {
      // Same-origin API in development keeps cookies and CSRF semantics close to
      // the production Nginx deployment.
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:4000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
