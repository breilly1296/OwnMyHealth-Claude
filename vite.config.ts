import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Let Vite handle chunk splitting automatically
    // The React.lazy() imports in App.tsx will create natural code split points
    // Manual chunking was causing "forwardRef" errors due to React/recharts separation
    chunkSizeWarningLimit: 700,
  },
});
