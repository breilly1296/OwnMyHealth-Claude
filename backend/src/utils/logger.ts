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
  // AI response fields that may contain PHI
  'responseText', 'jsonText', 'claudeResponse', 'guidance',
  'extractedData', 'pdfText', 'pdfContent', 'biomarker',
]);

/**
 * Recursively sanitize an arbitrary value, redacting any object field whose
 * key matches SENSITIVE_FIELDS. Arrays are walked element-by-element so
 * objects nested inside arrays don't bypass redaction — prior to F-21 this
 * path short-circuited and a `biomarkers: [{ valueEncrypted: "..." }]`
 * shape would have leaked straight through.
 */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value !== 'object') return value;
  return sanitizeData(value as Record<string, unknown>);
}

function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeValue(value);
    }
  }
  return sanitized;
}

/**
 * Cloud Logging severity values. Cloud Run auto-parses JSON log lines with a
 * `severity` field and routes them to the right log level in the GCP console.
 * https://cloud.google.com/logging/docs/structured-logging
 */
const SEVERITY_BY_LEVEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

/**
 * Log a message with environment awareness.
 *
 * - Dev/test: pretty text format, readable in a terminal.
 * - Production: single-line JSON with Cloud Logging's reserved field names
 *   (`severity`, `message`, `timestamp`) so GCP parses log lines correctly
 *   and logs are searchable by service + severity in the console.
 */
function log(level: LogLevel, message: string, options?: LogOptions): void {
  // In production, only log warnings and errors
  if (config.isProduction && (level === 'debug' || level === 'info')) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = options?.prefix;
  const sanitizedData = options?.data ? sanitizeData(options.data) : undefined;

  if (config.isProduction) {
    // Structured JSON for Cloud Logging. stderr for warn/error so Cloud Run's
    // default log splitter routes them to the error log stream.
    const entry: Record<string, unknown> = {
      severity: SEVERITY_BY_LEVEL[level],
      message,
      timestamp,
    };
    if (prefix) entry.service = prefix;
    if (sanitizedData) Object.assign(entry, sanitizedData);
    const line = JSON.stringify(entry) + '\n';
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
    return;
  }

  const prefixStr = prefix ? `[${prefix}]` : '';
  const formattedMessage = `${timestamp} ${level.toUpperCase()} ${prefixStr} ${message}`;

  // SECURITY: Use explicit format string to prevent format-string injection.
  // If formattedMessage contains % specifiers (%s, %d, %o), they would be
  // interpreted as format strings if passed as the first argument directly.
  switch (level) {
    case 'error':
      console.error('%s', formattedMessage, sanitizedData ?? '');
      break;
    case 'warn':
      console.warn('%s', formattedMessage, sanitizedData ?? '');
      break;
    default:
      console.log('%s', formattedMessage, sanitizedData ? JSON.stringify(sanitizedData) : '');
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
    // SECURITY: Use format string to prevent format-string injection
    console.log('%s', message);
  },

  /**
   * Log a dev-only message with visual formatting
   */
  devBox: (title: string, lines: string[]) => {
    if (config.isProduction) return;

    // SECURITY: Use format string to prevent format-string injection
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('%s', title);
    console.log('═══════════════════════════════════════════════════════════════');
    lines.forEach(line => console.log('%s', line));
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
