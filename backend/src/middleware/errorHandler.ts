import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { ApiResponse } from '../types/index.js';

// Custom error class
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Common error types
export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_FAILED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class ValidationError extends AppError {
  public readonly details: unknown;

  constructor(message: string = 'Validation failed', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR', false);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = 'Database operation failed') {
    super(message, 500, 'DATABASE_ERROR', false);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string = 'External service error') {
    super(`${service}: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
  }
}

// Generic error message for production (never expose internal details)
const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred. Please try again later.';

// Handle Prisma-specific errors
function handlePrismaError(err: Error & { code?: string; meta?: unknown }): { statusCode: number; code: string; message: string } {
  const prismaCode = err.code;

  switch (prismaCode) {
    case 'P2002': // Unique constraint violation
      return { statusCode: 409, code: 'CONFLICT', message: 'A record with this data already exists' };
    case 'P2025': // Record not found
      return { statusCode: 404, code: 'NOT_FOUND', message: 'The requested resource was not found' };
    case 'P2003': // Foreign key constraint failed
      return { statusCode: 400, code: 'BAD_REQUEST', message: 'Invalid reference to related resource' };
    case 'P2014': // Required relation violation
      return { statusCode: 400, code: 'BAD_REQUEST', message: 'Required relation is missing' };
    default:
      return { statusCode: 500, code: 'DATABASE_ERROR', message: GENERIC_ERROR_MESSAGE };
  }
}

// Handle JWT-specific errors
function handleJWTError(err: Error): { statusCode: number; code: string; message: string } {
  if (err.name === 'JsonWebTokenError') {
    return { statusCode: 401, code: 'INVALID_TOKEN', message: 'Invalid authentication token' };
  }
  if (err.name === 'TokenExpiredError') {
    return { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Authentication token has expired' };
  }
  return { statusCode: 401, code: 'UNAUTHORIZED', message: 'Authentication failed' };
}

// Global error handler middleware
// Express requires 4 parameters for error handlers, even if not all are used
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Default error values
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = config.isDevelopment ? err.message : GENERIC_ERROR_MESSAGE;
  let details: unknown = undefined;

  // Handle known error types
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message; // AppError messages are safe to expose

    if (err instanceof ValidationError) {
      details = err.details;
    }
  }
  // Handle Prisma errors
  else if (err.name === 'PrismaClientKnownRequestError' || err.name === 'PrismaClientValidationError') {
    const prismaResult = handlePrismaError(err as Error & { code?: string });
    statusCode = prismaResult.statusCode;
    code = prismaResult.code;
    message = prismaResult.message;
  }
  // Handle JWT errors
  else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    const jwtResult = handleJWTError(err);
    statusCode = jwtResult.statusCode;
    code = jwtResult.code;
    message = jwtResult.message;
  }
  // Handle syntax errors (malformed JSON)
  else if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body contains invalid JSON';
  }

  // Always log errors (with different levels based on severity)
  const logData = {
    prefix: 'ErrorHandler',
    data: {
      statusCode,
      code,
      method: req.method,
      path: req.path,
      userId: (req as unknown as { user?: { id: string } }).user?.id,
      ...(config.isDevelopment && { stack: err.stack }),
    },
  };

  if (statusCode >= 500) {
    // Server errors - always log full details
    logger.error(`${err.name}: ${err.message}`, logData);
  } else if (config.isDevelopment) {
    // Client errors - only log in development
    logger.warn(`${err.name}: ${err.message}`, logData);
  }

  // Build response - NEVER include stack traces in production
  const response: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      // Only include stack trace in development mode
      ...(config.isDevelopment ? { stack: err.stack } : {}),
    },
  };

  res.status(statusCode).json(response);
}

// 404 handler for unknown routes
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}

// Async wrapper to catch errors in async route handlers
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
