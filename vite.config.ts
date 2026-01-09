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
        // Only split heavy libraries that are lazy-loaded
        // React stays in the main bundle to avoid forwardRef issues
        manualChunks: (id) => {
          // PDF processing - only loaded when uploading/viewing PDFs
          if (id.includes('node_modules/pdfjs-dist/') ||
              id.includes('node_modules/jspdf/') ||
              id.includes('node_modules/pdf-lib/') ||
              id.includes('node_modules/html2canvas/')) {
            return 'pdf';
          }

          // OCR - only loaded when OCR is needed
          if (id.includes('node_modules/tesseract.js/') ||
              id.includes('node_modules/tesseract.js-core/')) {
            return 'ocr';
          }

          // Charts - recharts and d3 dependencies (loaded when viewing trends/graphs)
          if (id.includes('node_modules/recharts/') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor/')) {
            return 'charts';
          }
        },
      },
    },
  },
});
