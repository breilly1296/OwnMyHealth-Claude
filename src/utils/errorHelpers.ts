/**
 * Error message extraction helper.
 *
 * Why: the API client (`services/api/client.ts`) throws plain `ApiError`
 * objects, not Error instances. Every `err instanceof Error` check across
 * the app silently fell through to a hardcoded fallback, hiding the real
 * server reason from users. This helper unifies the unwrap.
 */
export function extractErrorMessage(
  err: unknown,
  fallback: string = 'An unexpected error occurred'
): string {
  if (err instanceof Error) return err.message || fallback;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message) || fallback;
  }
  if (typeof err === 'string') return err || fallback;
  return fallback;
}
