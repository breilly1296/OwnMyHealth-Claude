/**
 * authController.register unit tests — account enumeration defense (#18).
 *
 * The registration endpoint must return the SAME generic response whether or
 * not the email already exists, so an attacker can't enumerate which addresses
 * have accounts. When the email exists we email the real owner a notice and
 * skip user creation; the API response is byte-identical to the new-user path.
 *
 * Hoisted-mock pattern (mirrors biomarkerController.test.ts): every vi.mock is
 * declared before the controller import.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Request } from 'express';
import { createMockRequest, createMockResponse, createMockAuditService } from './testHelpers.js';

const mocks = vi.hoisted(() => ({
  auditService: null as unknown,
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mocks.auditService),
}));

vi.mock('../services/authService.js', () => ({
  emailExists: vi.fn(),
  createUser: vi.fn(),
  validatePasswordStrength: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('../services/emailService.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ success: true }),
  sendAccountExistsEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { register } from './authController.js';
import { emailExists, createUser } from '../services/authService.js';
import { sendVerificationEmail, sendAccountExistsEmail } from '../services/emailService.js';

const emailExistsMock = vi.mocked(emailExists);
const createUserMock = vi.mocked(createUser);
const sendVerificationEmailMock = vi.mocked(sendVerificationEmail);
const sendAccountExistsEmailMock = vi.mocked(sendAccountExistsEmail);

const STRONG_PASSWORD = 'Sup3rStr0ng!pw';

function lastJson(res: ReturnType<typeof createMockResponse>) {
  return (res.json as unknown as Mock).mock.calls[0][0];
}
function lastStatus(res: ReturnType<typeof createMockResponse>) {
  return (res.status as unknown as Mock).mock.calls[0][0];
}

describe('register — account enumeration (#18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditService = createMockAuditService();
  });

  it('new email: creates the user, sends verification, returns a generic 201 with NO user object', async () => {
    emailExistsMock.mockResolvedValue(false);
    createUserMock.mockResolvedValue({
      user: { id: 'u1', email: 'new@example.com', role: 'PATIENT' },
      verificationToken: 'verify-tok',
    } as never);

    const req = createMockRequest({ body: { email: 'new@example.com', password: STRONG_PASSWORD } });
    const res = createMockResponse();

    await register(req as unknown as Request, res);

    expect(createUserMock).toHaveBeenCalledWith('new@example.com', STRONG_PASSWORD);
    expect(sendVerificationEmailMock).toHaveBeenCalledWith('new@example.com', 'verify-tok');
    expect(sendAccountExistsEmailMock).not.toHaveBeenCalled();
    expect(lastStatus(res)).toBe(201);

    const payload = lastJson(res);
    expect(payload.success).toBe(true);
    expect(payload.data.message).toMatch(/check your email/i);
    // Critical: no user object leaks (it would differ from the duplicate path).
    expect(payload.data).not.toHaveProperty('user');
  });

  it('existing email: skips user creation, emails the owner, returns the SAME generic 201', async () => {
    emailExistsMock.mockResolvedValue(true);

    const req = createMockRequest({ body: { email: 'taken@example.com', password: STRONG_PASSWORD } });
    const res = createMockResponse();

    await register(req as unknown as Request, res);

    expect(createUserMock).not.toHaveBeenCalled();
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
    expect(sendAccountExistsEmailMock).toHaveBeenCalledWith('taken@example.com');
    expect(lastStatus(res)).toBe(201);

    const payload = lastJson(res);
    expect(payload.success).toBe(true);
    expect(payload.data.message).toMatch(/check your email/i);
    expect(payload.data).not.toHaveProperty('user');
  });

  it('both branches return byte-identical status + body (no enumeration oracle)', async () => {
    // New-email response
    emailExistsMock.mockResolvedValue(false);
    createUserMock.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', role: 'PATIENT' },
      verificationToken: 't',
    } as never);
    const resNew = createMockResponse();
    await register(
      createMockRequest({ body: { email: 'a@b.com', password: STRONG_PASSWORD } }) as unknown as Request,
      resNew
    );

    // Existing-email response
    emailExistsMock.mockResolvedValue(true);
    const resDup = createMockResponse();
    await register(
      createMockRequest({ body: { email: 'c@d.com', password: STRONG_PASSWORD } }) as unknown as Request,
      resDup
    );

    expect(lastStatus(resNew)).toBe(lastStatus(resDup));
    expect(lastJson(resNew)).toEqual(lastJson(resDup));
  });

  it('still rejects malformed input before reaching either branch', async () => {
    const res = createMockResponse();
    await expect(
      register(createMockRequest({ body: { password: STRONG_PASSWORD } }) as unknown as Request, res)
    ).rejects.toThrow(/required/i);
    expect(emailExistsMock).not.toHaveBeenCalled();
  });

  it('does not let a failed owner-notice email change the response (no oracle via errors)', async () => {
    emailExistsMock.mockResolvedValue(true);
    sendAccountExistsEmailMock.mockRejectedValueOnce(new Error('SendGrid down'));

    const req = createMockRequest({ body: { email: 'taken@example.com', password: STRONG_PASSWORD } });
    const res = createMockResponse();

    await register(req as unknown as Request, res);

    expect(lastStatus(res)).toBe(201);
    expect(lastJson(res).data.message).toMatch(/check your email/i);
  });
});
