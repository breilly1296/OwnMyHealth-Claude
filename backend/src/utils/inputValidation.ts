/**
 * Input validation utilities for sanitizing user input
 *
 * HIPAA compliance requires strict input validation to prevent
 * injection attacks and data corruption.
 */

/**
 * Sanitizes a string by removing potentially dangerous characters
 * @param input - Raw user input
 * @returns Sanitized string
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove null bytes and control characters
  return input
    .replace(/\0/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Validates email format
 * @param email - Email address to validate
 * @returns True if valid email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates that a string contains only alphanumeric characters
 * @param input - String to validate
 * @returns True if alphanumeric only
 */
export function isAlphanumeric(input: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(input);
}

/**
 * Validates a date string is in ISO 8601 format
 * @param dateStr - Date string to validate
 * @returns True if valid ISO date
 */
export function isValidISODate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !isNaN(date.getTime()) && dateStr === date.toISOString().split('T')[0];
}

/**
 * Validates numeric ID (positive integer)
 * @param id - ID to validate
 * @returns True if valid positive integer
 */
export function isValidId(id: unknown): boolean {
  if (typeof id === 'number') {
    return Number.isInteger(id) && id > 0;
  }
  if (typeof id === 'string') {
    const num = parseInt(id, 10);
    return !isNaN(num) && num > 0 && num.toString() === id;
  }
  return false;
}
