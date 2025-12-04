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

