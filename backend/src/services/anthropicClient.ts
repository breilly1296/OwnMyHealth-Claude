/**
 * Shared Anthropic SDK client.
 *
 * Pre-2026-04-24 four files each maintained their own `let anthropicClient =
 * null` singleton with copy-pasted lazy-init: `claudeExtraction.ts`,
 * `sbcExtraction.ts`, `controllers/expenseController.ts`,
 * `controllers/aiChatController.ts`. Drift was already visible — three of the
 * four used `timeout: 30_000`/`maxRetries: 2`, but `aiChatController` used
 * `timeout: 60_000`/`maxRetries: 1`.
 *
 * One shared module gives us:
 *   - one place to change timeout / retry / API-key handling
 *   - one place to gate on `ANTHROPIC_BAA_ACTIVE` (callers still re-check
 *     the runtime gate; this module just centralizes the construction)
 *   - one place to tear down on key rotation (`reset()`)
 *   - a `isEnabled()` helper for routes that want to render a "feature
 *     unavailable" UI instead of throwing
 *
 * @module services/anthropicClient
 */
import Anthropic from '@anthropic-ai/sdk';
import { InternalServerError } from '../middleware/errorHandler.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

let client: Anthropic | null = null;

export interface AnthropicClientOptions {
  /** Per-call timeout override. Defaults to 30s, matching extraction services. */
  timeout?: number;
  /** Per-call retry override. Defaults to 2, matching extraction services. */
  maxRetries?: number;
}

/**
 * Get the shared Anthropic client. Lazy: construction is deferred until the
 * first caller actually needs to make a network request, so importing this
 * module from a route handler doesn't crash boot when ANTHROPIC_API_KEY is
 * unset (a deliberate dev-mode posture — see `config/index.ts` warning).
 *
 * Caller is still responsible for the BAA gate check
 * (`config.anthropic.baaActive`) before invoking the client. This module
 * only owns construction.
 */
export function getAnthropicClient(options: AnthropicClientOptions = {}): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new InternalServerError('ANTHROPIC_API_KEY environment variable is not set');
  }

  client = new Anthropic({
    apiKey,
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
  });
  return client;
}

/**
 * Cheap pre-flight check — true if construction would succeed today.
 * Lets callers render a "feature unavailable" UI instead of catching the
 * `InternalServerError` that `getAnthropicClient` throws on missing key.
 */
export function isEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Drop the cached singleton. Call after key rotation or in tests that need
 * a fresh client. The next `getAnthropicClient()` call rebuilds.
 */
export function reset(): void {
  client = null;
}
