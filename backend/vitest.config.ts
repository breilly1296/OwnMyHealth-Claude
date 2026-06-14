import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: '.',
    // Seed NODE_ENV + required secrets before any test's imports run.
    // Prevents config/index.ts from throwing on missing AUDIT_LOG_SALT et
    // al. in environments that don't ship a .env (CI).
    setupFiles: ['./src/testSetup.ts'],
    include: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        'src/generated/',
        '**/*.d.ts',
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      // Handle .js extensions in imports
    },
  },
  esbuild: {
    // Transpile target for tests (JS feature level esbuild keeps), aligned with
    // the Node 22 runtime. Not the runtime itself — see Dockerfile / engines.
    target: 'node22',
  },
});
