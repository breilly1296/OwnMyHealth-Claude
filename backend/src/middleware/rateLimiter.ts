import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config/index.js';
import type { ApiResponse } from '../types/index.js';
import { createRateLimitStore } from './rateLimitStore.js';

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
    // Use forwarded IP if behind proxy, otherwise use connection IP
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

// Rate limiter for authentication endpoints (registration, etc.)
export const authLimiter = rateLimit({
  store: createRateLimitStore('auth'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again in 15 minutes.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for login specifically (brute force protection)
export const strictAuthLimiter = rateLimit({
  store: createRateLimitStore('strict-auth'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 login attempts per window
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
    // Use email + IP for login rate limiting to prevent attacks on specific accounts
    const email = req.body?.email || '';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `${email}:${ip}`;
  },
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
});

// Sensitive operations rate limiter
export const sensitiveLimiter = rateLimit({
  store: createRateLimitStore('sensitive'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 requests per hour
  message: {
    success: false,
    error: {
      code: 'SENSITIVE_RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded for sensitive operations.',
    },
  } as ApiResponse,
  standardHeaders: true,
  legacyHeaders: false,
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
    // Key by authenticated user ID for per-user cost protection, fallback to IP
    return (req as Request & { user?: { id: string } }).user?.id || req.ip || req.socket.remoteAddress || 'unknown';
  },
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
    return (
      (req as Request & { user?: { id: string } }).user?.id ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown'
    );
  },
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
});
