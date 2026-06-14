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

    it('does not echo back user-supplied input in validation error details (F-15)', () => {
      // Pre-fix risk: emitting Zod's full `issue` object surfaces fields like
      // `received` containing the raw user input (potentially PHI) in the
      // 422 response. The mapper in validation.ts must keep the response
      // shape to {field, message, code} only — never the input value.
      const req = createMockRequest({
        body: {
          name: '', // fails minLength
          email: 'patient.private.address@hospital.example', // fails .email() — must not echo
        },
      });
      const res = createMockResponse();

      validate(testSchema)(req, res, mockNext);

      const error = (mockNext as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error & {
        details?: Array<Record<string, unknown>>;
      };
      expect(error.name).toBe('ValidationError');
      expect(Array.isArray(error.details)).toBe(true);

      // Each detail entry should expose only the contract-level keys.
      for (const detail of error.details!) {
        expect(Object.keys(detail).sort()).toEqual(['code', 'field', 'message'].sort());
      }

      // Defense-in-depth: the user-supplied email must not appear anywhere
      // in the serialized error payload (covers any future struct changes).
      const serialized = JSON.stringify(error.details);
      expect(serialized).not.toContain('patient.private.address@hospital.example');
      expect(serialized).not.toMatch(/"received"/);
      expect(serialized).not.toMatch(/"input"/);
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

    it('should reject passwords shorter than 12 characters', () => {
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

    it('should reject 11-character passwords at the boundary', () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'Str0ng@Pa1!',
        },
      });
      const res = createMockResponse();

      validate(schemas.auth.register)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should accept 12-character passwords at the boundary', () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'Str0ngP@ss1!',
        },
      });
      const res = createMockResponse();

      validate(schemas.auth.register)(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
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

  // ============================================
  // Frontend contract tests (teardown finding #1)
  // ============================================
  // Payloads below are shaped EXACTLY like the client sends them
  // (src/services/api/biomarkers.ts CreateBiomarkerData via
  // src/hooks/useBiomarkerData.ts). The client historically sent FLAT
  // normalRangeMin/Max/Source keys, which these schemas reject — so every
  // manual-entry and PDF-extract write 422'd. These tests pin the nested
  // contract so client/server can never silently drift again.
  describe('Biomarker Client Payload Contract', () => {
    it('should accept the create payload shape sent by handleAddMeasurement', () => {
      const result = schemas.biomarker.create.safeParse({
        name: 'Glucose',
        value: 95,
        unit: 'mg/dL',
        date: '2026-01-15',
        category: 'Blood',
        normalRange: { min: 70, max: 100, source: 'Standard Reference' },
        notes: 'Fasting sample',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.normalRange).toEqual({
          min: 70,
          max: 100,
          source: 'Standard Reference',
        });
      }
    });

    it('should accept the batch payload shape sent by handlePDFExtract', () => {
      // sourceFile/extractionConfidence are provenance fields the client sends
      // and bulkCreateBiomarkers persists. The batch item schema historically
      // omitted them, so Zod stripped them (validate() replaces req.body with
      // the Zod output) and they always arrived undefined — assert they
      // survive parsing so the schema can't silently drop them again.
      const result = schemas.biomarker.batchCreate.safeParse({
        biomarkers: [
          {
            name: 'Hemoglobin A1c',
            value: 5.4,
            unit: '%',
            date: '2026-01-15',
            category: 'Blood',
            normalRange: { min: 4, max: 5.6, source: 'Standard Reference' },
            sourceType: 'LAB_UPLOAD',
            sourceFile: 'lab-report.pdf',
            extractionConfidence: 0.92,
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.biomarkers[0].normalRange).toEqual({
          min: 4,
          max: 5.6,
          source: 'Standard Reference',
        });
        expect(result.data.biomarkers[0].sourceType).toBe('LAB_UPLOAD');
        expect(result.data.biomarkers[0].sourceFile).toBe('lab-report.pdf');
        expect(result.data.biomarkers[0].extractionConfidence).toBe(0.92);
      }
    });

    it('should accept an update payload editing only the normal range', () => {
      const result = schemas.biomarker.update.safeParse({
        normalRange: { min: 65, max: 99, source: 'Lab Specific' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Guard against the range edit being silently stripped to a no-op
        expect(result.data.normalRange).toEqual({
          min: 65,
          max: 99,
          source: 'Lab Specific',
        });
      }
    });

    it('should reject the legacy FLAT normalRange* create shape (regression)', () => {
      const result = schemas.biomarker.create.safeParse({
        name: 'Glucose',
        value: 95,
        unit: 'mg/dL',
        date: '2026-01-15',
        category: 'Blood',
        normalRangeMin: 70,
        normalRangeMax: 100,
        normalRangeSource: 'Standard Reference',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.path[0] === 'normalRange')).toBe(true);
      }
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

// M22 regression: the healthGoal create/list category was a strict uppercase
// enum, but the modal default ("Other"), the suggestion fallbacks ("Vital
// Signs"/"Lifestyle"), and biomarker-derived categories ("METABOLIC") are all
// free text — so every realistic goal creation 422'd. Category is now free text
// (the column is VarChar(100)). These pin that contract so the enum can't return.
describe('schemas.healthGoal.create — category is free text (M22)', () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
  });

  const baseBody = {
    name: 'Lower blood pressure',
    targetValue: 120,
    unit: 'mmHg',
    direction: 'MAINTAIN',
    startDate: '2026-01-01',
    targetDate: '2026-06-01',
  };

  it.each(['Other', 'Vital Signs', 'Lifestyle', 'METABOLIC', 'Cardiovascular'])(
    'accepts the previously-rejected free-text category "%s"',
    (category) => {
      const req = createMockRequest({ body: { ...baseBody, category } });
      validate(schemas.healthGoal.create)(req, createMockResponse(), next);
      expect(next).toHaveBeenCalledWith();
    }
  );

  it('still rejects an empty category', () => {
    const req = createMockRequest({ body: { ...baseBody, category: '' } });
    validate(schemas.healthGoal.create)(req, createMockResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('rejects a category longer than the VarChar(100) column', () => {
    const req = createMockRequest({ body: { ...baseBody, category: 'x'.repeat(101) } });
    validate(schemas.healthGoal.create)(req, createMockResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('listQuery accepts a free-text category filter', () => {
    const req = createMockRequest({ query: { category: 'METABOLIC' } });
    validate(schemas.healthGoal.listQuery, 'query')(req, createMockResponse(), next);
    expect(next).toHaveBeenCalledWith();
  });
});
