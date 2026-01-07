import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate, requireJsonContentType, schemas } from './validation.js';

// Mock error handler
vi.mock('./errorHandler.js', () => ({
  ValidationError: class ValidationError extends Error {
    details: unknown;
    constructor(message: string, details?: unknown) {
      super(message);
      this.name = 'ValidationError';
      this.details = details;
    }
  },
  BadRequestError: class BadRequestError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'BadRequestError';
    }
  },
}));

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    method: 'GET',
    get: vi.fn().mockReturnValue('application/json'),
    ...overrides,
  } as unknown as Request;
}

// Helper to create mock response
function createMockResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('validation middleware', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
  });

  describe('validate()', () => {
    const testSchema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
      age: z.number().optional(),
    });

    it('should pass validation for valid body data', () => {
      const req = createMockRequest({
        body: { name: 'John', email: 'john@example.com' },
      });
      const res = createMockResponse();

      validate(testSchema)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(req.body).toEqual({ name: 'John', email: 'john@example.com' });
    });

    it('should pass validation for valid query data', () => {
      const querySchema = z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
      });
      const req = createMockRequest({
        query: { page: '1', limit: '10' },
      });
      const res = createMockResponse();

      validate(querySchema, 'query')(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass validation for valid params data', () => {
      const req = createMockRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });
      const res = createMockResponse();

      validate(schemas.uuidParam, 'params')(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should call next with ValidationError for invalid data', () => {
      const req = createMockRequest({
        body: { name: '', email: 'invalid-email' },
      });
      const res = createMockResponse();

      validate(testSchema)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      const error = (mockNext as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(error.name).toBe('ValidationError');
    });

    it('should call next with ValidationError for missing required fields', () => {
      const req = createMockRequest({
        body: { email: 'john@example.com' }, // missing name
      });
      const res = createMockResponse();

      validate(testSchema)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should reject invalid UUID in params', () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' },
      });
      const res = createMockResponse();

      validate(schemas.uuidParam, 'params')(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('String Sanitization', () => {
    it('should trim whitespace from strings', () => {
      const req = createMockRequest({
        body: {
          name: '  John Doe  ',
          value: 42,
          unit: 'mg/dL',
          category: 'Blood',
          date: '2024-01-01',
          normalRange: { min: 0, max: 100 },
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      // After sanitization, strings should be trimmed
      expect(mockNext).toHaveBeenCalledWith();
      expect(req.body.name).toBe('John Doe');
    });

    it('should escape HTML special characters to prevent XSS', () => {
      const req = createMockRequest({
        body: {
          name: '<script>alert("xss")</script>',
          value: 42,
          unit: 'mg/dL',
          category: 'Blood',
          date: '2024-01-01',
          normalRange: { min: 0, max: 100 },
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      // The sanitizedString transform should escape HTML
      expect(mockNext).toHaveBeenCalledWith();
      // Check that < and > are escaped
      expect(req.body.name).not.toContain('<script>');
      expect(req.body.name).toContain('&lt;');
      expect(req.body.name).toContain('&gt;');
    });

    it('should escape quotes in strings', () => {
      const req = createMockRequest({
        body: {
          name: 'Test "quoted" value',
          value: 42,
          unit: 'mg/dL',
          category: 'Blood',
          date: '2024-01-01',
          normalRange: { min: 0, max: 100 },
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(req.body.name).toContain('&quot;');
    });
  });

  describe('Email Validation', () => {
    it('should accept valid email addresses', () => {
      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123!' },
      });
      const res = createMockResponse();

      validate(schemas.auth.login)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should normalize email to lowercase', () => {
      const req = createMockRequest({
        body: { email: 'TEST@EXAMPLE.COM', password: 'Password123!' },
      });
      const res = createMockResponse();

      validate(schemas.auth.login)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(req.body.email).toBe('test@example.com');
    });

    it('should reject invalid email formats', () => {
      const req = createMockRequest({
        body: { email: 'not-an-email', password: 'Password123!' },
      });
      const res = createMockResponse();

      validate(schemas.auth.login)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Password Validation', () => {
    it('should accept strong passwords', () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'StrongP@ss123!',
        },
      });
      const res = createMockResponse();

      validate(schemas.auth.register)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject passwords without uppercase', () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'weakpassword1!',
        },
      });
      const res = createMockResponse();

      validate(schemas.auth.register)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should reject passwords without numbers', () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'WeakPassword!',
        },
      });
      const res = createMockResponse();

      validate(schemas.auth.register)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should reject passwords without special characters', () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'WeakPassword123',
        },
      });
      const res = createMockResponse();

      validate(schemas.auth.register)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should reject passwords shorter than 8 characters', () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'Sh0rt!',
        },
      });
      const res = createMockResponse();

      validate(schemas.auth.register)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('requireJsonContentType()', () => {
    it('should pass for GET requests without checking content type', () => {
      const req = createMockRequest({ method: 'GET' });
      const res = createMockResponse();

      requireJsonContentType(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass for POST with application/json content type', () => {
      const req = createMockRequest({
        method: 'POST',
        body: { data: 'test' },
        get: vi.fn().mockReturnValue('application/json'),
      });
      const res = createMockResponse();

      requireJsonContentType(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass for multipart/form-data (file uploads)', () => {
      const req = createMockRequest({
        method: 'POST',
        body: { file: 'data' },
        get: vi.fn().mockReturnValue('multipart/form-data; boundary=----'),
      });
      const res = createMockResponse();

      requireJsonContentType(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass for empty body even without json content type', () => {
      const req = createMockRequest({
        method: 'POST',
        body: {},
        get: vi.fn().mockReturnValue('text/plain'),
      });
      const res = createMockResponse();

      requireJsonContentType(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should throw BadRequestError for non-json content type with body', () => {
      const req = createMockRequest({
        method: 'POST',
        body: { data: 'test' },
        get: vi.fn().mockReturnValue('text/plain'),
      });
      const res = createMockResponse();

      expect(() => requireJsonContentType(req, res, mockNext)).toThrow('Content-Type must be application/json');
    });
  });

  describe('Biomarker Schema Validation', () => {
    it('should validate complete biomarker create payload', () => {
      const req = createMockRequest({
        body: {
          name: 'Glucose',
          value: 95,
          unit: 'mg/dL',
          category: 'Blood',
          date: '2024-01-15',
          normalRange: { min: 70, max: 100 },
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject negative biomarker values', () => {
      const req = createMockRequest({
        body: {
          name: 'Glucose',
          value: -10,
          unit: 'mg/dL',
          category: 'Blood',
          date: '2024-01-15',
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should enforce maximum batch size of 100', () => {
      const biomarkers = Array(101).fill({
        name: 'Test',
        value: 1,
        unit: 'mg/dL',
        category: 'Blood',
        date: '2024-01-15',
        normalRange: { min: 0, max: 10 },
      });

      const req = createMockRequest({
        body: { biomarkers },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.batchCreate)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Date Validation', () => {
    it('should accept ISO date format', () => {
      const req = createMockRequest({
        body: {
          name: 'Test',
          value: 1,
          unit: 'mg/dL',
          category: 'Blood',
          date: '2024-01-15',
          normalRange: { min: 0, max: 10 },
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should accept full ISO datetime format', () => {
      const req = createMockRequest({
        body: {
          name: 'Test',
          value: 1,
          unit: 'mg/dL',
          category: 'Blood',
          date: '2024-01-15T10:30:00Z',
          normalRange: { min: 0, max: 10 },
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject invalid date formats', () => {
      const req = createMockRequest({
        body: {
          name: 'Test',
          value: 1,
          unit: 'mg/dL',
          category: 'Blood',
          date: 'not-a-date',
          normalRange: { min: 0, max: 10 },
        },
      });
      const res = createMockResponse();

      validate(schemas.biomarker.create)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
