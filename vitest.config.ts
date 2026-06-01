import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: [
      'src/__tests__/**/*.test.{ts,tsx}',
      'src/__tests__/**/*.spec.{ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/backend/**',
      // OneDrive sync-conflict duplicates (" (1)") are stale copies that test
      // against older component APIs and aren't tracked/pushed — exclude them so
      // local `npm test` matches CI (mirrors the tsconfig dup exclude). Parens
      // must be escaped: picomatch treats "(1)" as an extglob group otherwise.
      '**/*\\(1\\)*',
      '**/*\\(2\\)*',
      '**/* copy*',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
      ],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
