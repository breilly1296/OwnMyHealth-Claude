/**
 * Logger Utility
 *
 * Provides environment-aware logging that:
 * - Suppresses debug/info logs in production
 * - Always logs errors and warnings
 * - Provides structured logging for different services
 * - Never logs PHI, tokens, or passwords
 */

import { config } from '../config/index.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogOptions {
  prefix?: string;
  data?: Record<string, unknown>;
}

// Fields that should never be logged (PHI and sensitive data)
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'accessToken', 'refreshToken', 'secret',
  'ssn', 'socialSecurityNumber', 'memberId', 'groupNumber',
  'memberIdEncrypted', 'groupIdEncrypted', 'valueEncrypted',
  'descriptionEncrypted', 'noteEncrypted', 'genotype',
  'email', 'phoneNumber', 'address', 'dateOfBirth',
]);

/**
 * Sanitize data object to remove sensitive fields before logging
 */
function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Log a message with environment awareness
 */
function log(level: LogLevel, message: string, options?: LogOptions): void {
  // In production, only log warnings and errors
  if (config.isProduction && (level === 'debug' || level === 'info')) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = options?.prefix ? `[${options.prefix}]` : '';
  const sanitizedData = options?.data ? sanitizeData(options.data) : undefined;

  const formattedMessage = `${timestamp} ${level.toUpperCase()} ${prefix} ${message}`;

  switch (level) {
    case 'error':
      console.error(formattedMessage, sanitizedData ?? '');
      break;
    case 'warn':
      console.warn(formattedMessage, sanitizedData ?? '');
      break;
    default:
      console.log(formattedMessage, sanitizedData ? JSON.stringify(sanitizedData) : '');
  }
}

/**
 * Create a prefixed logger for a specific service/module
 */
function createServiceLogger(serviceName: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      log('debug', message, { prefix: serviceName, data }),
    info: (message: string, data?: Record<string, unknown>) =>
      log('info', message, { prefix: serviceName, data }),
    warn: (message: string, data?: Record<string, unknown>) =>
      log('warn', message, { prefix: serviceName, data }),
    error: (message: string, data?: Record<string, unknown>) =>
      log('error', message, { prefix: serviceName, data }),
  };
}

export const logger = {
  debug: (message: string, options?: LogOptions) => log('debug', message, options),
  info: (message: string, options?: LogOptions) => log('info', message, options),
  warn: (message: string, options?: LogOptions) => log('warn', message, options),
  error: (message: string, options?: LogOptions) => log('error', message, options),

  /**
   * Log auth-related events (only in non-production for security)
   */
  auth: (message: string, data?: Record<string, unknown>) => {
    if (!config.isProduction) {
      log('info', message, { prefix: 'Auth', data });
    }
  },

  /**
   * Log startup messages (always shown)
   */
  startup: (message: string) => {
    console.log(message);
  },

  /**
   * Log a dev-only message with visual formatting
   */
  devBox: (title: string, lines: string[]) => {
    if (config.isProduction) return;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(title);
    console.log('═══════════════════════════════════════════════════════════════');
    lines.forEach(line => console.log(line));
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
  },

  /**
   * Create a service-specific logger with auto-prefixing
   */
  createServiceLogger,
};

// Pre-configured service loggers for common modules
export const dnaLogger = createServiceLogger('dnaParser');
export const dnaControllerLogger = createServiceLogger('dnaController');
export const pdfLogger = createServiceLogger('pdfParser');
export const authLogger = createServiceLogger('Auth');
export const encryptionLogger = createServiceLogger('Encryption');

export default logger;
