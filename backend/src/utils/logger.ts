/**
 * Logger Utility
 *
 * Provides environment-aware logging that:
 * - Suppresses debug/info logs in production AND staging
 * - Always logs errors and warnings
 * - Provides structured logging for different services
 * - Never logs PHI, tokens, or passwords
 */

import { config } from '../config/index.js';

// L-4: staging is a deployed, production-like tier (structured logging, same
// rate limits/CORS — see config/index.ts). Gating log format/level and the
// auth-flow suppression on `isProduction` alone meant a deployed STAGING box
// emitted verbose pretty-text plus auth logs. Treat staging like production
// for log format + level suppression; local dev (`npm run dev`) stays verbose.
const useProductionLogging = config.isProduction || config.isStaging;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogOptions {
  prefix?: string;
  data?: Record<string, unknown>;
}

// Fields that should never be logged (PHI and sensitive data).
// NOTE: lookups are case-insensitive (key.toLowerCase()), so every entry here
// MUST be lowercase or it will never match.
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'accesstoken', 'refreshtoken', 'secret',
  // snake_case FHIR/OAuth tokens and HTTP auth headers
  'access_token', 'refresh_token', 'authorization', 'cookie',
  'ssn', 'socialsecuritynumber', 'memberid', 'groupnumber',
  'memberidencrypted', 'groupidencrypted', 'valueencrypted',
  'descriptionencrypted', 'noteencrypted', 'genotype',
  'email', 'phonenumber', 'address', 'dateofbirth',
  // AI response fields that may contain PHI
  'responsetext', 'jsontext', 'clauderesponseencrypted', 'guidance',
  'extracteddata', 'pdftext', 'pdfcontent', 'biomarker',
]);

// Cap recursion so a pathologically deep logged object can't overflow the
// stack; anything past this depth is collapsed to a marker.
const MAX_SANITIZE_DEPTH = 8;

/**
 * Recursively sanitize an arbitrary value, redacting any object field whose
 * key matches SENSITIVE_FIELDS. Arrays are walked element-by-element so
 * objects nested inside arrays don't bypass redaction — prior to F-21 this
 * path short-circuited and a `biomarkers: [{ valueEncrypted: "..." }]`
 * shape would have leaked straight through.
 *
 * A max-depth guard plus a per-walk `seen` set protect against deep or
 * self-referential objects that would otherwise overflow the stack.
 */
function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_SANITIZE_DEPTH) return '[MAX_DEPTH]';
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen));
  }
  return sanitizeData(value as Record<string, unknown>, depth + 1, seen);
}

function sanitizeData(
  data: Record<string, unknown>,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeValue(value, depth, seen);
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
 * - Production AND staging: single-line JSON with Cloud Logging's reserved
 *   field names (`severity`, `message`, `timestamp`) so GCP parses log lines
 *   correctly and logs are searchable by service + severity in the console.
 */
function log(level: LogLevel, message: string, options?: LogOptions): void {
  // In production/staging, only log warnings and errors
  if (useProductionLogging && (level === 'debug' || level === 'info')) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = options?.prefix;
  const sanitizedData = options?.data ? sanitizeData(options.data) : undefined;

  if (useProductionLogging) {
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
   * Log auth-related events (only in local dev for security — suppressed in
   * both production and the production-like staging tier; L-4)
   */
  auth: (message: string, data?: Record<string, unknown>) => {
    if (!useProductionLogging) {
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
export const pdfLogger = createServiceLogger('pdfParser');
export const authLogger = createServiceLogger('Auth');
export const encryptionLogger = createServiceLogger('Encryption');

export default logger;
