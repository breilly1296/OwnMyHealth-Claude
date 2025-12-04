/**
 * Query Helper Utilities
 *
 * Consolidates duplicate query parameter parsing and pagination logic.
 * Reduces code duplication across controllers.
 */

/**
 * Pagination parameters after parsing
 */
export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

/**
 * Options for parsing pagination parameters
 */
export interface PaginationOptions {
  /** Default page number (default: 1) */
  defaultPage?: number;
  /** Default page size (default: 20) */
  defaultLimit?: number;
  /** Maximum allowed page size (default: 100) */
  maxLimit?: number;
  /** Minimum allowed page size (default: 1) */
  minLimit?: number;
}

/**
 * Parse pagination parameters from query string values
 *
 * @param pageValue - Raw page value from query string
 * @param limitValue - Raw limit value from query string
 * @param options - Pagination configuration options
 * @returns Parsed pagination parameters with skip/take for Prisma
 *
 * @example
 * ```typescript
 * const { page, limit } = req.query;
 * const pagination = parsePagination(page, limit);
 * const records = await prisma.entity.findMany({
 *   skip: pagination.skip,
 *   take: pagination.take,
 * });
 * ```
 */
export function parsePagination(
  pageValue: unknown,
  limitValue: unknown,
  options: PaginationOptions = {}
): PaginationParams {
  const {
    defaultPage = 1,
    defaultLimit = 20,
    maxLimit = 100,
    minLimit = 1,
  } = options;

  // Parse page - ensure it's at least 1
  const page = Math.max(
    1,
    typeof pageValue === 'string'
      ? parseInt(pageValue, 10) || defaultPage
      : typeof pageValue === 'number'
        ? pageValue
        : defaultPage
  );

  // Parse limit - clamp between min and max
  const parsedLimit = typeof limitValue === 'string'
    ? parseInt(limitValue, 10) || defaultLimit
    : typeof limitValue === 'number'
      ? limitValue
      : defaultLimit;

  const limit = Math.min(maxLimit, Math.max(minLimit, parsedLimit));

  // Calculate skip for Prisma
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
    take: limit,
  };
}

/**
 * Parse a numeric query parameter with validation
 *
 * @param value - Raw value from query string
 * @param defaultValue - Default value if parsing fails
 * @param min - Minimum allowed value (optional)
 * @param max - Maximum allowed value (optional)
 * @returns Parsed numeric value
 *
 * @example
 * ```typescript
 * const limit = parseNumericParam(req.query.limit, 20, 1, 100);
 * const days = parseNumericParam(req.query.days, 90);
 * ```
 */
export function parseNumericParam(
  value: unknown,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  let result = defaultValue;

  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      result = parsed;
    }
  } else if (typeof value === 'number' && !isNaN(value)) {
    result = value;
  }

  // Apply constraints
  if (min !== undefined) {
    result = Math.max(min, result);
  }
  if (max !== undefined) {
    result = Math.min(max, result);
  }

  return result;
}

/**
 * Parse a string query parameter with validation
 *
 * @param value - Raw value from query string
 * @param defaultValue - Default value if not a valid string
 * @returns Parsed string value or default
 *
 * @example
 * ```typescript
 * const category = parseStringParam(req.query.category, 'all');
 * const status = parseStringParam(req.query.status);
 * ```
 */
export function parseStringParam(
  value: unknown,
  defaultValue?: string
): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return defaultValue;
}

/**
 * Parse a boolean query parameter
 *
 * @param value - Raw value from query string
 * @param defaultValue - Default value if not a valid boolean
 * @returns Parsed boolean value
 *
 * @example
 * ```typescript
 * const isActive = parseBooleanParam(req.query.active, true);
 * ```
 */
export function parseBooleanParam(
  value: unknown,
  defaultValue: boolean = false
): boolean {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === 'no') {
      return false;
    }
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return defaultValue;
}

/**
 * Calculate pagination metadata for API response
 *
 * @param total - Total number of records
 * @param pagination - Pagination parameters used in query
 * @returns Pagination metadata for response
 *
 * @example
 * ```typescript
 * const total = await prisma.entity.count({ where });
 * const records = await prisma.entity.findMany({ ...pagination, where });
 * res.json({
 *   data: records,
 *   pagination: createPaginationMeta(total, pagination),
 * });
 * ```
 */
export function createPaginationMeta(
  total: number,
  pagination: PaginationParams
): {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
} {
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

/**
 * Parse a date query parameter
 *
 * @param value - Raw value from query string (ISO date string)
 * @param defaultValue - Default value if parsing fails
 * @returns Parsed Date object or default
 *
 * @example
 * ```typescript
 * const startDate = parseDateParam(req.query.startDate, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
 * ```
 */
export function parseDateParam(
  value: unknown,
  defaultValue?: Date
): Date | undefined {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }
  return defaultValue;
}

/**
 * Parse enum query parameter with validation
 *
 * @param value - Raw value from query string
 * @param allowedValues - Array of allowed enum values
 * @param defaultValue - Default value if not valid
 * @returns Validated enum value
 *
 * @example
 * ```typescript
 * const status = parseEnumParam(req.query.status, ['PENDING', 'ACTIVE', 'COMPLETED'], 'ACTIVE');
 * ```
 */
export function parseEnumParam<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  defaultValue?: T
): T | undefined {
  if (typeof value === 'string' && allowedValues.includes(value as T)) {
    return value as T;
  }
  return defaultValue;
}
