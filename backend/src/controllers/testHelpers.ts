/**
 * Shared test fixtures for controller unit tests.
 *
 * Not named `*.test.ts`, so vitest does not treat this as a test file — it's a
 * pure helper module imported by the colocated `*.test.ts` files. Lives at
 * `src/controllers/testHelpers.ts` because `__tests__/` is gitignored.
 */

import { vi } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';

/** Build a minimal mock AuthenticatedRequest. Override any field via `overrides`. */
export function createMockRequest(
  overrides: Partial<AuthenticatedRequest> & Record<string, unknown> = {}
): AuthenticatedRequest {
  const base = {
    user: { id: 'test-user-id', email: 'test@example.com', role: 'PATIENT' },
    params: {},
    query: {},
    body: {},
    headers: {},
    ip: '127.0.0.1',
    get: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as AuthenticatedRequest;
}

/** Build a minimal Express Response stub with chainable `status`/`json`/etc. */
export function createMockResponse(): Response {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.write = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res as unknown as Response;
}

/**
 * Build a mocked Prisma transaction object covering every model the tests
 * touch. Each model has the `findMany`, `findFirst`, `findUnique`, `create`,
 * `createMany`, `update`, `updateMany`, `delete`, `deleteMany`, `count`
 * methods — controllers that call other methods should extend this object
 * in the test setup.
 */
export function createMockPrismaTransaction() {
  const modelMethods = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  });

  return {
    user: { ...modelMethods() },
    biomarker: { ...modelMethods() },
    biomarkerHistory: { ...modelMethods() },
    insurancePlan: { ...modelMethods() },
    insuranceBenefit: { ...modelMethods() },
    healthGoal: { ...modelMethods() },
    goalProgressHistory: { ...modelMethods() },
    healthNeed: { ...modelMethods() },
    expenseProjection: { ...modelMethods() },
    expenseActual: { ...modelMethods() },
    costAnalysis: { ...modelMethods() },
    userFile: { ...modelMethods() },
    providerPatient: { ...modelMethods() },
    labConnection: { ...modelMethods() },
    auditLog: { ...modelMethods() },
    systemConfig: { ...modelMethods() },
    conversationHistory: { ...modelMethods() },
    $transaction: vi.fn(),
  };
}

export type MockPrismaTx = ReturnType<typeof createMockPrismaTransaction>;

/** Standard mock for the audit log service — logs all event types to spies. */
export function createMockAuditService() {
  return {
    logAccess: vi.fn(),
    logCreate: vi.fn(),
    logUpdate: vi.fn(),
    logDelete: vi.fn(),
    logAuth: vi.fn(),
    logExport: vi.fn(),
    logSystem: vi.fn(),
  };
}

export type MockAuditService = ReturnType<typeof createMockAuditService>;

/**
 * Standard mock for the encryption service. `encrypt` tags values with a
 * prefix so tests can assert encryption happened; `decrypt` reverses it.
 * Deterministic and salt-agnostic — good enough for unit tests.
 */
export function createMockEncryptionService() {
  return {
    encrypt: vi.fn((value: string) => `enc:${value}`),
    decrypt: vi.fn((value: string) => value.replace(/^enc:/, '')),
    encryptWithMasterKey: vi.fn((value: string) => `menc:${value}`),
    decryptWithMasterKey: vi.fn((value: string) => value.replace(/^menc:/, '')),
    generateUserSalt: vi.fn(() => 'mock-user-salt'),
  };
}
