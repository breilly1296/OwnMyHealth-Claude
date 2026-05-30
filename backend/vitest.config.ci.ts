import { mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * CI variant used by the GitHub Actions "Backend CI" job.
 *
 * The old `test:unit` script pointed at `src/__tests__/unit`, a directory that
 * does not exist, so `--passWithNoTests` made the step a silent no-op — the
 * ~417 colocated unit tests (controllers, services, middleware, routes, utils,
 * including the security regression suites) never ran in CI.
 *
 * This config runs that full colocated suite. It excludes only
 * `src/services/rls.test.ts`, which needs a live Postgres and is covered by the
 * dedicated `rls` job (`npm run test:rls`). The integration suite under
 * `src/__tests__/integration` self-skips without a live DB (see its header),
 * so it stays included and cleanly no-ops here.
 */
export default mergeConfig(baseConfig, {
  test: {
    exclude: [
      'node_modules',
      'dist',
      // Live-Postgres suite — runs in the dedicated `rls` CI job instead.
      'src/services/rls.test.ts',
    ],
  },
});
