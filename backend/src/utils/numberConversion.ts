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
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;

  // Prisma Decimal and similar objects with a toNumber method
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  return Number(value) || 0;
}

/**
 * Safely convert to number with a default value for invalid inputs.
 *
 * The toNumber() default is 0 for both invalid input and legitimate zero,
 * so we re-check explicitly: if the input literally represented zero,
 * return 0; otherwise treat the converted-to-zero case as "conversion
 * failed" and fall back to defaultValue.
 */
export function toNumberOrDefault(value: unknown, defaultValue: number): number {
  const result = toNumber(value);
  if (result !== 0) return result;
  return value === 0 || value === '0' ? 0 : defaultValue;
}
