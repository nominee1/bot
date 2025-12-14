import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    basicSsl() // Auto-generates SSL certs
  ],
  server: {
    port: 8443,
    strictPort: true,
    https: true, // Required for Deriv cookies
    proxy: {
      '/api': {
        target: 'https://dtraderhub.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
        headers: {
          'X-Forwarded-Proto': 'https'
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});