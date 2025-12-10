import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import type { ApiResponse } from '../types/index.js';

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
