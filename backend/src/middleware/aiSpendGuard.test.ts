/**
 * Tests for the aiSpendGuard middleware (teardown #12 / #29 — the 503
 * enforcement path was entirely untested; a mutation deleting the refuse branch
 * survived the whole suite). Drives the middleware directly across every branch:
 * refused (user/global), admitted (settle registered), no-user pass-through, and
 * the shared-store-error fail-closed path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mocks = vi.hoisted(() => ({ admitAISpend: vi.fn() }));
vi.mock('../services/aiCostTracker.js', () => ({ admitAISpend: mocks.admitAISpend }));
vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { aiSpendGuard } from './aiSpendGuard.js';
import { ServiceUnavailableError } from './errorHandler.js';

function makeReq(userId?: string): Request {
  return { user: userId ? { id: userId } : undefined, path: '/ai/chat' } as unknown as Request;
}
function makeRes(): Response & { handlers: Record<string, () => void> } {
  const handlers: Record<string, () => void> = {};
  return {
    handlers,
    on: vi.fn((event: string, listener: () => void) => {
      handlers[event] = listener;
    }),
  } as unknown as Response & { handlers: Record<string, () => void> };
}

describe('aiSpendGuard', () => {
  beforeEach(() => mocks.admitAISpend.mockReset());
  afterEach(() => vi.clearAllMocks());

  it('passes through (no spend check) when there is no authenticated user', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await aiSpendGuard(makeReq(undefined), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]); // next() with no error
    expect(mocks.admitAISpend).not.toHaveBeenCalled();
  });

  it('admits and registers settle on both finish and close', async () => {
    const settle = vi.fn();
    mocks.admitAISpend.mockResolvedValue({ admitted: true, scope: null, settle });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await aiSpendGuard(makeReq('u1'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]); // no error
    expect(res.handlers.finish).toBe(settle);
    expect(res.handlers.close).toBe(settle);
  });

  it('refuses with a 503 (user scope) and does NOT register settle', async () => {
    mocks.admitAISpend.mockResolvedValue({ admitted: false, scope: 'user', settle: vi.fn() });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await aiSpendGuard(makeReq('u1'), res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err.message).toMatch(/today's AI usage limit/i);
    expect(res.on).not.toHaveBeenCalled(); // no settle registered on refusal
  });

  it('refuses with a 503 (global scope) carrying the global message', async () => {
    mocks.admitAISpend.mockResolvedValue({ admitted: false, scope: 'global', settle: vi.fn() });
    const next = vi.fn() as unknown as NextFunction;

    await aiSpendGuard(makeReq('u1'), makeRes(), next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err.message).toMatch(/daily budget reached/i);
  });

  it('fails CLOSED with a 503 when the shared store errors', async () => {
    mocks.admitAISpend.mockRejectedValueOnce(new Error('redis down'));
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await aiSpendGuard(makeReq('u1'), res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(res.on).not.toHaveBeenCalled(); // no settle registered on error
  });
});
