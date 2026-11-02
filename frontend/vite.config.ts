import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately (npm run dev in backend/); proxying keeps the
// session cookie same-origin. In production the backend serves the built dist/ folder.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.BACKEND_PORT ?? 4300}`
    }
  }
});
