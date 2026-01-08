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
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core - keep together to avoid forwardRef issues
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')) {
            return 'react-vendor';
          }

          // Charts - recharts and related
          if (id.includes('node_modules/recharts/') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-') ||
              id.includes('node_modules/chart.js/')) {
            return 'charts';
          }

          // PDF processing
          if (id.includes('node_modules/pdfjs-dist/') ||
              id.includes('node_modules/jspdf/') ||
              id.includes('node_modules/pdf-lib/')) {
            return 'pdf';
          }

          // OCR
          if (id.includes('node_modules/tesseract.js/') ||
              id.includes('node_modules/tesseract.js-core/')) {
            return 'ocr';
          }

          // UI libraries
          if (id.includes('node_modules/lucide-react/') ||
              id.includes('node_modules/@headlessui/') ||
              id.includes('node_modules/@radix-ui/')) {
            return 'ui';
          }
        },
      },
    },
  },
});
