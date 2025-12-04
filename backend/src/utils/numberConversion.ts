/**
 * Number Conversion Utilities
 *
 * Provides safe conversion of Prisma Decimal types and other
 * numeric values to JavaScript numbers.
 */

/**
 * Safely convert various numeric types to JavaScript number
 *
 * Handles:
 * - Native JavaScript numbers
 * - Prisma Decimal objects (with toNumber method)
 * - String representations of numbers
 * - null/undefined (returns 0)
 *
 * @param value - Value to convert to number
 * @returns JavaScript number
 *
 * @example
 * ```typescript
 * const num = toNumber(prismaDecimal); // Prisma Decimal -> number
 * const num2 = toNumber("123.45");     // String -> number
 * const num3 = toNumber(42);           // number -> number (passthrough)
 * ```
 */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (value === null || value === undefined) {
    return 0;
  }

  // Handle Prisma Decimal and similar objects with toNumber method
  if (value && typeof value === 'object' && 'toNumber' in value) {
    const decimalLike = value as { toNumber: () => number };
    return decimalLike.toNumber();
  }

  // Handle string conversion
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  return Number(value) || 0;
}

/**
 * Safely convert to number with a default value for invalid inputs
 *
 * @param value - Value to convert
 * @param defaultValue - Value to return if conversion fails
 * @returns Converted number or default value
 */
export function toNumberOrDefault(value: unknown, defaultValue: number): number {
  const result = toNumber(value);
  return result === 0 && value !== 0 && value !== '0' ? defaultValue : result;
}
