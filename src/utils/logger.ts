/**
 * Frontend Logger Utility
 *
 * Provides environment-aware logging that:
 * - Suppresses debug/info logs in production
 * - Always logs errors and warnings
 * - Filters sensitive data before logging
 * - Never logs PHI, tokens, or passwords
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Check if we're in production mode
const isProduction = import.meta.env.PROD;

// Check if DEBUG mode is enabled
const isDebugEnabled = import.meta.env.VITE_DEBUG === 'true';

// Fields that should never be logged (PHI and sensitive data)
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'accessToken', 'refreshToken', 'secret',
  'ssn', 'socialSecurityNumber', 'memberId', 'groupNumber',
  'memberIdEncrypted', 'groupIdEncrypted', 'valueEncrypted',
  'descriptionEncrypted', 'noteEncrypted', 'genotype',
  'email', 'phoneNumber', 'address', 'dateOfBirth',
  'authorization', 'cookie', 'sessionId',
]);

/**
 * Sanitize data object to remove sensitive fields before logging
 */
function sanitizeData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Log a message with environment awareness
 */
function log(level: LogLevel, prefix: string, message: string, data?: unknown): void {
  // In production, only log warnings and errors (unless DEBUG is enabled)
  if (isProduction && !isDebugEnabled && (level === 'debug' || level === 'info')) {
    return;
  }

  // Debug level only shows when DEBUG is enabled
  if (level === 'debug' && !isDebugEnabled) {
    return;
  }

  const formattedMessage = `[${prefix}] ${message}`;
  const sanitizedData = data !== undefined ? sanitizeData(data) : undefined;

  switch (level) {
    case 'error':
      console.error(formattedMessage, sanitizedData ?? '');
      break;
    case 'warn':
      console.warn(formattedMessage, sanitizedData ?? '');
      break;
    case 'info':
      console.info(formattedMessage, sanitizedData ?? '');
      break;
    default:
      console.log(formattedMessage, sanitizedData ?? '');
  }
}

/**
 * Create a prefixed logger for a specific component/module
 */
function createLogger(prefix: string) {
  return {
    debug: (message: string, data?: unknown) => log('debug', prefix, message, data),
    info: (message: string, data?: unknown) => log('info', prefix, message, data),
    warn: (message: string, data?: unknown) => log('warn', prefix, message, data),
    error: (message: string, data?: unknown) => log('error', prefix, message, data),
  };
}

// Pre-configured loggers for common modules
export const dashboardLogger = createLogger('Dashboard');
export const authLogger = createLogger('Auth');
export const apiLogger = createLogger('API');
export const providerLogger = createLogger('Provider');
export const errorBoundaryLogger = createLogger('ErrorBoundary');

export const logger = {
  createLogger,
  debug: (message: string, data?: unknown) => log('debug', 'App', message, data),
  info: (message: string, data?: unknown) => log('info', 'App', message, data),
  warn: (message: string, data?: unknown) => log('warn', 'App', message, data),
  error: (message: string, data?: unknown) => log('error', 'App', message, data),
};

export default logger;
