/**
 * healthNeedsApi request-contract tests.
 *
 * Pins the frontend↔backend URL contract for health needs. The critical case
 * is updateStatus: the backend mounts PATCH /health-needs/:id with NO /status
 * suffix (healthNeedsRoutes.ts has no /:id/status route), and the teardown
 * found that reverting the client to '/health-needs/:id/status' compiled and
 * failed zero tests while 404ing every status update in the real app. These
 * tests make that regression fail loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../services/api/client';
import { healthNeedsApi, type HealthNeedData } from '../../services/api/healthNeeds';

const mockedApiFetch = vi.mocked(apiFetch);

function makeNeed(overrides: Partial<HealthNeedData> = {}): HealthNeedData {
  return {
    id: 'need-1',
    needType: 'ACTION',
    name: 'Schedule cardiologist follow-up',
    description: 'Follow up on LDL',
    urgency: 'URGENT',
    status: 'PENDING',
    relatedBiomarkerIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('healthNeedsApi.updateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PATCHes /health-needs/:id (NO /status suffix) with a { status } body', async () => {
    const updated = makeNeed({ status: 'COMPLETED' });
    mockedApiFetch.mockResolvedValue({ success: true, data: updated });

    const result = await healthNeedsApi.updateStatus('need-1', 'COMPLETED');

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch).toHaveBeenCalledWith('/health-needs/need-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETED' }),
    });

    // Regression pin: the backend has no /:id/status route — a '/status'
    // suffix compiles fine but 404s at runtime.
    const [path] = mockedApiFetch.mock.calls[0];
    expect(path).not.toContain('/status');

    expect(result).toEqual(updated);
  });
});

describe('healthNeedsApi.getAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GETs /health-needs with no query string when params are omitted', async () => {
    mockedApiFetch.mockResolvedValue({ success: true, data: [] });

    const result = await healthNeedsApi.getAll();

    expect(mockedApiFetch).toHaveBeenCalledWith('/health-needs');
    expect(result).toEqual([]);
  });

  it('appends status/urgency filters as query params', async () => {
    mockedApiFetch.mockResolvedValue({ success: true, data: [] });

    await healthNeedsApi.getAll({ status: 'PENDING', urgency: 'URGENT' });

    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/health-needs?status=PENDING&urgency=URGENT'
    );
  });
});

describe('healthNeedsApi.create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs /health-needs with the JSON-stringified payload', async () => {
    const created = makeNeed();
    mockedApiFetch.mockResolvedValue({ success: true, data: created });

    const payload = {
      needType: 'ACTION',
      name: 'Schedule cardiologist follow-up',
      description: 'Follow up on LDL',
      urgency: 'URGENT',
    };
    const result = await healthNeedsApi.create(payload);

    expect(mockedApiFetch).toHaveBeenCalledWith('/health-needs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(result).toEqual(created);
  });
});
