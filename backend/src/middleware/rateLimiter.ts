import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import type { Options } from 'express-rate-limit';
import crypto from 'crypto';
import { config } from '../config/index.js';
import type { ApiResponse } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { createRateLimitStore } from './rateLimitStore.js';

// Best-effort client IP, mirroring the keyGenerator fallbacks below.
const clientIp = (req: Request): string =>
  req.ip || req.socket.remoteAddress || 'unknown';

// L-2: normalize an IP into a rate-limit key. Wraps express-rate-limit's
// `ipKeyGenerator` so an IPv6 client collapses to its /64 subnet instead of
// being counted per-address — otherwise a single IPv6 host could rotate through
// its (effectively unlimited) addresses to evade an IP-keyed limit. Using this
// in our custom keyGenerators also resolves the ERR_ERL_KEY_GEN_IPV6 validation
// error the library raises for raw-IP keys. IPv4 and non-IP fallbacks
// ("unknown") pass through unchanged.
const ipKey = (req: Request): string => ipKeyGenerator(clientIp(req));

// Hash a rate-limit key before it is logged so the audit trail never carries a
// raw email or IP. SHA-256 truncated to 16 hex chars is enough to correlate
// repeat offenders within a window without storing the identifier itself.
const hashKey = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

// Normalize an attacker-controlled email before it is used in a rate-limit key
// so case/whitespace variants ("User@x.com", " user@x.com ") collapse to one
// bucket and cannot multiply the per-account login budget (L-1).
const normalizeEmail = (email: unknown): string =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

/**
 * Shared 429 handler factory (M-5). express-rate-limit never logs by default,
 * so a sustained limit breach is invisible. Each limiter passes its own
 * `prefix` and a `getKey` that returns the SAME identifier it rate-limits on;
 * the value is hashed before logging so no raw email/IP reaches the logs. The
 * existing 429 body (`options.message`) and status are preserved exactly.
 */
const makeRateLimitHandler =
  (prefix: string, getKey: (req: Request) => string) =>
  (req: Request, res: Response, _next: NextFunction, options: Options): void => {
    logger.warn('Rate limit exceeded', {
      prefix,
      data: {
        prefix,
        key: hashKey(getKey(req)),
        path: req.path,
      },
    });
    res.status(options.statusCode).json(options.message as ApiResponse);
  };

// STORE: in-process MemoryStore by default → per-instance counters, so on
// Cloud Run with N instances the effective ceiling is N×limit (audit #37).
// Setting REDIS_URL switches every limiter below to a SHARED Redis store
// (Cloud Memorystore) keyed by a distinct prefix, so counters are consistent
// across instances and the rate-limit posture no longer depends on the
// `--max-instances` pin. `createRateLimitStore` returns undefined when
// REDIS_URL is unset, leaving the MemoryStore default in place (current
// behavior). See middleware/rateLimitStore.ts.

// Standard rate limiter for general API endpoints
export const standardLimiter = rateLimit({
  store: createRateLimitStore('standard'),
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use forwarded IP if behind proxy, otherwise connection IP — normalized so
    // IPv6 clients are keyed by /64 subnet (L-2).
    return ipKey(req);
  },
  handler: makeRateLimitHandler('standard', clientIp),
});

// Rate limiter for authentication endpoints (registration, etc.)
export const authLimiter = rateLimit({
  store: createRateLimitStore('auth'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit.authMaxAttempts, // default 20 per window (env-tunable for e2e only)
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again in 15 minutes.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeRateLimitHandler('auth', clientIp),
});

// Strict rate limiter for login specifically (brute force protection)
export const strictAuthLimiter = rateLimit({
  store: createRateLimitStore('strict-auth'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit.strictAuthMaxAttempts, // default 5 per window (env-tunable for e2e only)
  message: {
    success: false,
    error: {
      code: 'LOGIN_RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts. Please try again in 15 minutes.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts
  keyGenerator: (req) => {
    // Use email + IP for login rate limiting to prevent attacks on specific
    // accounts. Normalize the (attacker-controlled) email so case/whitespace
    // variants collapse to one bucket and cannot multiply the budget (L-1).
    const email = normalizeEmail(req.body?.email);
    const ip = ipKey(req); // /64-normalized for IPv6 (L-2)
    return `${email}:${ip}`;
  },
  // Log a HASHED email only — never the raw `email:IP` key (M-5).
  handler: makeRateLimitHandler('strict-auth', (req) =>
    normalizeEmail(req.body?.email),
  ),
});

// Upload rate limiter for file uploads
export const uploadLimiter = rateLimit({
  store: createRateLimitStore('upload'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: {
    success: false,
    error: {
      code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
      message: 'Too many file uploads, please try again later.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeRateLimitHandler('upload', clientIp),
});

// Sensitive operations rate limiter
export const sensitiveLimiter = rateLimit({
  store: createRateLimitStore('sensitive'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.rateLimit.sensitiveMaxAttempts, // default 10 per hour (env-tunable for e2e only)
  message: {
    success: false,
    error: {
      code: 'SENSITIVE_RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded for sensitive operations.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by authenticated user ID so per-account export/delete caps survive a
    // shared NAT (M-12). Falls back to /64-normalized IP for any unauthenticated
    // path (L-2), mirroring aiLimiter.
    return (req as Request & { user?: { id: string } }).user?.id || ipKey(req);
  },
  handler: makeRateLimitHandler(
    'sensitive',
    (req) => (req as Request & { user?: { id: string } }).user?.id || clientIp(req),
  ),
});

// AI endpoint rate limiter (Claude API calls are expensive)
export const aiLimiter = rateLimit({
  store: createRateLimitStore('ai'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 AI requests per hour per user
  message: {
    success: false,
    error: {
      code: 'AI_RATE_LIMIT_EXCEEDED',
      message: 'Too many AI requests. Please try again later.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by authenticated user ID for per-user cost protection, fallback to
    // /64-normalized IP (L-2).
    return (req as Request & { user?: { id: string } }).user?.id || ipKey(req);
  },
  handler: makeRateLimitHandler(
    'ai',
    (req) =>
      (req as Request & { user?: { id: string } }).user?.id ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown',
  ),
});

// Provider access-request limiter — caps how often one provider can fan
// out requests to patient emails. User-keyed (not IP-keyed) so a provider
// behind a corporate NAT can't be DoS'd by another provider's rate, and so
// a single account can't sidestep the cap by hopping IPs. 10/hour matches
// the plan-tier ceiling on legitimate practice growth (a provider adding
// 10 patients/hour to their roster is plausible; 100/hour is enumeration).
export const providerAccessRequestLimiter = rateLimit({
  store: createRateLimitStore('provider-access-request'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: {
    success: false,
    error: {
      code: 'PROVIDER_REQUEST_RATE_LIMIT_EXCEEDED',
      message: 'Too many access requests. Please try again later.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // User-keyed, falling back to /64-normalized IP for any unauthenticated
    // path (L-2).
    return (req as Request & { user?: { id: string } }).user?.id || ipKey(req);
  },
  handler: makeRateLimitHandler(
    'provider-access-request',
    (req) =>
      (req as Request & { user?: { id: string } }).user?.id ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown',
  ),
});

// Bulk operations rate limiter (for batch creates, imports)
export const bulkOperationLimiter = rateLimit({
  store: createRateLimitStore('bulk'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 bulk operations per hour
  message: {
    success: false,
    error: {
      code: 'BULK_RATE_LIMIT_EXCEEDED',
      message: 'Too many bulk operations. Please try again later.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeRateLimitHandler('bulk', clientIp),
});
