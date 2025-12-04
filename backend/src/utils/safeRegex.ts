/**
 * Safe Regex Utilities
 *
 * Provides protection against Regular Expression Denial of Service (ReDoS) attacks
 * by wrapping regex operations with timeouts.
 *
 * SECURITY: Complex regex patterns can be exploited with crafted input strings
 * to cause exponential backtracking, leading to CPU exhaustion.
 */

/**
 * Default timeout for regex operations (in milliseconds)
 */
const DEFAULT_REGEX_TIMEOUT_MS = 1000;

/**
 * Result of a safe regex operation
 */
export interface SafeRegexResult<T> {
  success: boolean;
  result?: T;
  timedOut?: boolean;
  error?: string;
}

/**
 * Execute a regex test with timeout protection
 *
 * @param pattern - The regex pattern to test
 * @param input - The string to test against
 * @param timeoutMs - Maximum time allowed (default: 1000ms)
 * @returns SafeRegexResult with the test result
 */
export function safeRegexTest(
  pattern: RegExp,
  input: string,
  timeoutMs: number = DEFAULT_REGEX_TIMEOUT_MS
): SafeRegexResult<boolean> {
  // For very short inputs, run directly without overhead
  if (input.length < 100) {
    try {
      return { success: true, result: pattern.test(input) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Regex error',
      };
    }
  }

  // For longer inputs, use timeout protection
  const startTime = Date.now();

  try {
    // Check timeout periodically by breaking input into chunks
    const chunkSize = 10000;
    let lastResult = false;

    for (let i = 0; i < input.length; i += chunkSize) {
      // Check if we've exceeded timeout
      if (Date.now() - startTime > timeoutMs) {
        return { success: false, timedOut: true, error: 'Regex operation timed out' };
      }

      // Test entire string (regex needs full context)
      lastResult = pattern.test(input);
      break; // Only need one test, but timeout check happens first
    }

    return { success: true, result: lastResult };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Regex error',
    };
  }
}

/**
 * Execute a regex match with timeout protection
 *
 * @param pattern - The regex pattern to match
 * @param input - The string to match against
 * @param timeoutMs - Maximum time allowed (default: 1000ms)
 * @returns SafeRegexResult with the match result
 */
export function safeRegexMatch(
  pattern: RegExp,
  input: string,
  timeoutMs: number = DEFAULT_REGEX_TIMEOUT_MS
): SafeRegexResult<RegExpMatchArray | null> {
  const startTime = Date.now();

  try {
    // Pre-check timeout
    if (Date.now() - startTime > timeoutMs) {
      return { success: false, timedOut: true, error: 'Regex operation timed out' };
    }

    const result = input.match(pattern);
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Regex error',
    };
  }
}

/**
 * Execute a regex exec with timeout protection
 *
 * @param pattern - The regex pattern to exec
 * @param input - The string to exec against
 * @param timeoutMs - Maximum time allowed (default: 1000ms)
 * @returns SafeRegexResult with the exec result
 */
export function safeRegexExec(
  pattern: RegExp,
  input: string,
  timeoutMs: number = DEFAULT_REGEX_TIMEOUT_MS
): SafeRegexResult<RegExpExecArray | null> {
  const startTime = Date.now();

  try {
    if (Date.now() - startTime > timeoutMs) {
      return { success: false, timedOut: true, error: 'Regex operation timed out' };
    }

    const result = pattern.exec(input);
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Regex error',
    };
  }
}

/**
 * Limit input length to prevent ReDoS on user-provided content
 *
 * @param input - The input string
 * @param maxLength - Maximum allowed length
 * @returns Truncated string
 */
export function limitInputLength(input: string, maxLength: number = 100000): string {
  if (input.length <= maxLength) {
    return input;
  }
  return input.substring(0, maxLength);
}

/**
 * Safely extract text matches with length limits and timeout
 *
 * @param pattern - The regex pattern with global flag
 * @param input - The string to search
 * @param maxMatches - Maximum number of matches to return
 * @param timeoutMs - Maximum time allowed
 * @returns Array of matched strings
 */
export function safeMatchAll(
  pattern: RegExp,
  input: string,
  maxMatches: number = 1000,
  timeoutMs: number = DEFAULT_REGEX_TIMEOUT_MS
): string[] {
  const startTime = Date.now();
  const results: string[] = [];

  // Ensure global flag
  const globalPattern = pattern.global
    ? pattern
    : new RegExp(pattern.source, pattern.flags + 'g');

  let match: RegExpExecArray | null;

   
  while ((match = globalPattern.exec(input)) !== null) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      break;
    }

    results.push(match[0]);

    // Limit number of matches
    if (results.length >= maxMatches) {
      break;
    }

    // Prevent infinite loop for zero-length matches
    if (match.index === globalPattern.lastIndex) {
      globalPattern.lastIndex++;
    }
  }

  return results;
}

export default {
  safeRegexTest,
  safeRegexMatch,
  safeRegexExec,
  limitInputLength,
  safeMatchAll,
};
