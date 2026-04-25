import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitError,
  InternalServerError,
  DatabaseError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
} from './errorHandler.js';
import { config } from '../config/index.js';

// Mock dependencies
vi.mock('../config/index.js');
vi.mock('../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/v1/test',
    user: { id: 'user-123' },
    ...overrides,
  } as unknown as Request;
}

// Helper to create mock response
function createMockResponse(): Response & { _statusCode?: number; _json?: unknown } {
  const res = {
    _statusCode: 200,
    _json: null,
    status: vi.fn(function (this: Response & { _statusCode?: number }, code: number) {
      this._statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: Response & { _json?: unknown }, data: unknown) {
      this._json = data;
      return this;
    }),
  };
  return res as unknown as Response & { _statusCode?: number; _json?: unknown };
}

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create error with default values', () => {
      const error = new AppError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(true);
    });

    it('should create error with custom values', () => {
      const error = new AppError('Custom error', 418, 'TEAPOT', false);
      expect(error.statusCode).toBe(418);
      expect(error.code).toBe('TEAPOT');
      expect(error.isOperational).toBe(false);
    });
  });

  describe('BadRequestError', () => {
    it('should create 400 error', () => {
      const error = new BadRequestError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Invalid input');
    });

    it('should use default message', () => {
      const error = new BadRequestError();
      expect(error.message).toBe('Bad Request');
    });
  });

  describe('UnauthorizedError', () => {
    it('should create 401 error', () => {
      const error = new UnauthorizedError('Not logged in');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('ForbiddenError', () => {
    it('should create 403 error', () => {
      const error = new ForbiddenError('Access denied');
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
    });
  });

  describe('NotFoundError', () => {
    it('should create 404 error', () => {
      const error = new NotFoundError('Resource not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });
  });

  describe('ValidationError', () => {
    it('should create 422 error with details', () => {
      const details = [{ field: 'email', message: 'Invalid email' }];
      const error = new ValidationError('Validation failed', details);
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(details);
    });
  });

  describe('ConflictError', () => {
    it('should create 409 error', () => {
      const error = new ConflictError('Already exists');
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT');
    });
  });

  describe('RateLimitError', () => {
    it('should create 429 error', () => {
      const error = new RateLimitError('Too many requests');
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('InternalServerError', () => {
    it('should create 500 error with isOperational false', () => {
      const error = new InternalServerError('Something broke');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(false);
    });
  });

  describe('DatabaseError', () => {
    it('should create 500 database error', () => {
      const error = new DatabaseError('Query failed');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.isOperational).toBe(false);
    });
  });
});

describe('errorHandler middleware', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
    vi.mocked(config).isDevelopment = false;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('AppError handling', () => {
    it('should handle BadRequestError correctly', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new BadRequestError('Invalid data');

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid data',
        },
      });
    });

    it('should handle NotFoundError correctly', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new NotFoundError('User not found');

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(404);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
    });

    it('should include validation details for ValidationError', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const details = [{ field: 'email', message: 'Invalid format' }];
      const error = new ValidationError('Validation failed', details);

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(422);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details,
        },
      });
    });
  });

  describe('Production mode security', () => {
    beforeEach(() => {
      vi.mocked(config).isDevelopment = false;
    });

    it('should NOT include stack trace in production', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Internal error');
      error.stack = 'Error: Internal error\n    at secret/path/file.js:123';

      errorHandler(error, req, res, mockNext);

      expect(res._json).not.toHaveProperty('error.stack');
    });

    it('should show generic message for unknown errors in production', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Database connection string: secret://...');

      errorHandler(error, req, res, mockNext);

      expect(res._json).toMatchObject({
        success: false,
        error: {
          message: 'An unexpected error occurred. Please try again later.',
        },
      });
      // Should NOT contain the actual error message with secrets
      expect((res._json as { error: { message: string } }).error.message).not.toContain('secret');
    });

    it('should show AppError messages in production (they are safe)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new BadRequestError('Email is required');

      errorHandler(error, req, res, mockNext);

      expect((res._json as { error: { message: string } }).error.message).toBe('Email is required');
    });
  });

  describe('Development mode', () => {
    beforeEach(() => {
      vi.mocked(config).isDevelopment = true;
    });

    it('should include stack trace in development', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Test error');

      errorHandler(error, req, res, mockNext);

      expect(res._json).toHaveProperty('error.stack');
    });

    it('should show actual error message in development', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Detailed error message');

      errorHandler(error, req, res, mockNext);

      expect((res._json as { error: { message: string } }).error.message).toBe('Detailed error message');
    });
  });

  describe('Prisma error handling', () => {
    it('should handle unique constraint violation (P2002)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Unique constraint failed') as Error & { code: string; name: string };
      error.name = 'PrismaClientKnownRequestError';
      error.code = 'P2002';

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(409);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'A record with this data already exists',
        },
      });
    });

    it('does not leak the offending field name or value (F-14)', () => {
      // Pre-fix risk: forwarding `err.meta` to the client would echo
      // `target: ['email']` and the duplicate value back. The mapper
      // returns a fixed generic shape with no field-name surface so an
      // attacker can't probe which column collided (e.g., "is this email
      // already registered?").
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error(
        'Unique constraint failed on the fields: (`email`)'
      ) as Error & {
        code: string;
        name: string;
        meta?: { target?: string[] };
      };
      error.name = 'PrismaClientKnownRequestError';
      error.code = 'P2002';
      error.meta = { target: ['email'] }; // Prisma populates this

      errorHandler(error, req, res, mockNext);

      const body = JSON.stringify(res._json);
      // The metadata fields Prisma exposes must not appear in the response.
      expect(body).not.toContain('email');
      expect(body).not.toContain('target');
      expect(body).not.toContain('meta');
      // No `details` key for P2002 — would imply field-level info.
      expect(res._json.error).not.toHaveProperty('details');
    });

    it('should handle record not found (P2025)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Record not found') as Error & { code: string; name: string };
      error.name = 'PrismaClientKnownRequestError';
      error.code = 'P2025';

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(404);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'NOT_FOUND',
        },
      });
    });

    it('should handle foreign key constraint (P2003)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Foreign key failed') as Error & { code: string; name: string };
      error.name = 'PrismaClientKnownRequestError';
      error.code = 'P2003';

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'BAD_REQUEST',
        },
      });
    });
  });

  describe('JWT error handling', () => {
    it('should handle JsonWebTokenError', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('jwt malformed');
      error.name = 'JsonWebTokenError';

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(401);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid authentication token',
        },
      });
    });

    it('should handle TokenExpiredError', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('jwt expired');
      error.name = 'TokenExpiredError';

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(401);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Authentication token has expired',
        },
      });
    });
  });

  describe('Syntax error handling', () => {
    it('should handle malformed JSON', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new SyntaxError('Unexpected token');
      (error as SyntaxError & { body: string }).body = '{ invalid json }';

      errorHandler(error, req, res, mockNext);

      expect(res._statusCode).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body contains invalid JSON',
        },
      });
    });
  });
});

describe('notFoundHandler middleware', () => {
  it('should call next with NotFoundError', () => {
    const req = createMockRequest({ method: 'GET', path: '/api/v1/unknown' });
    const res = createMockResponse();
    const next = vi.fn();

    notFoundHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    const error = next.mock.calls[0][0] as NotFoundError;
    expect(error.message).toBe('Route GET /api/v1/unknown not found');
  });
});

describe('asyncHandler', () => {
  it('should pass successful async function result', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    const wrapped = asyncHandler(mockFn);
    await wrapped(req, res, next);

    expect(mockFn).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('should catch and pass errors to next', async () => {
    const error = new Error('Async error');
    const mockFn = vi.fn().mockRejectedValue(error);
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    const wrapped = asyncHandler(mockFn);
    await wrapped(req, res, next);

    // Wait for promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(next).toHaveBeenCalledWith(error);
  });
});
