import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config/index.js';
import type { ApiResponse } from '../types/index.js';

// KNOWN LIMITATION: In-memory rate-limit store is per-instance.
// On Cloud Run with N instances, an attacker can hit each instance up to N
// times the stated limit before any bucket fills. Mitigated today by pinning
// Cloud Run to a low `--max-instances` (see deploy config). When we scale
// beyond ~3 instances, replace MemoryStore with `rate-limit-redis` backed by
// Cloud Memorystore so counters are shared across instances. Not fixed now
// because Redis is a new piece of infra and the current traffic fits on one
// instance — see audit HIGH finding on rate-limiter dilution.

// Standard rate limiter for general API endpoints
export const standardLimiter = rateLimit({
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
