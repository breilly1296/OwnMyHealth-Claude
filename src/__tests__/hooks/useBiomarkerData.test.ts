/**
 * useBiomarkerData Tests
 *
 * Covers fetchAllBiomarkers, the paginated fetch helper (teardown finding #4):
 * the backend clamps list `limit` to 100, so the helper must walk
 * pagination.totalPages instead of relying on a single large-limit request.
 *
 * Also pins the EXACT create/createBatch payload contracts (nested
 * normalRange, ISO dates, LAB_UPLOAD sourceType, provenance fields) and the
 * ≤100-item batch chunking the backend cap requires.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  biomarkersApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    createBatch: vi.fn(),
  },
  insuranceApi: {
    getPlans: vi.fn(),
  },
}));

import { fetchAllBiomarkers, useBiomarkerData } from '../../hooks/useBiomarkerData';
import { biomarkersApi, insuranceApi } from '../../services/api';
import type { Biomarker } from '../../types';

// Build a fake API page response. Each biomarker gets an id encoding its
// page so concatenation order can be asserted.
function makePage(page: number, count: number, totalPages: number) {
  return {
    biomarkers: Array.from({ length: count }, (_, i) => ({
      id: `bm-${page}-${i}`,
      name: 'Glucose',
    })),
    pagination: { total: totalPages * 100, page, limit: 100, totalPages },
  };
}

describe('fetchAllBiomarkers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches a single page when totalPages is 1', async () => {
    vi.mocked(biomarkersApi.getAll).mockResolvedValue(makePage(1, 3, 1) as never);

    const result = await fetchAllBiomarkers();

    expect(biomarkersApi.getAll).toHaveBeenCalledTimes(1);
    expect(biomarkersApi.getAll).toHaveBeenCalledWith({ page: 1, limit: 100 });
    expect(result.biomarkers).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('requests limit 100 (the backend clamp), never more', async () => {
    vi.mocked(biomarkersApi.getAll).mockResolvedValue(makePage(1, 1, 1) as never);

    await fetchAllBiomarkers();

    const params = vi.mocked(biomarkersApi.getAll).mock.calls[0][0];
    expect(params?.limit).toBe(100);
  });

  it('treats a missing pagination block as a single page', async () => {
    vi.mocked(biomarkersApi.getAll).mockResolvedValue({
      biomarkers: [{ id: 'bm-1' }],
    } as never);

    const result = await fetchAllBiomarkers();

    expect(biomarkersApi.getAll).toHaveBeenCalledTimes(1);
    expect(result.biomarkers).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('concatenates all pages in order when totalPages > 1', async () => {
    vi.mocked(biomarkersApi.getAll).mockImplementation(
      async (params) => makePage(params?.page ?? 1, 2, 3) as never
    );

    const result = await fetchAllBiomarkers();

    expect(biomarkersApi.getAll).toHaveBeenCalledTimes(3);
    expect(biomarkersApi.getAll).toHaveBeenNthCalledWith(1, { page: 1, limit: 100 });
    expect(biomarkersApi.getAll).toHaveBeenNthCalledWith(2, { page: 2, limit: 100 });
    expect(biomarkersApi.getAll).toHaveBeenNthCalledWith(3, { page: 3, limit: 100 });
    expect(result.biomarkers.map(b => b.id)).toEqual([
      'bm-1-0', 'bm-1-1', 'bm-2-0', 'bm-2-1', 'bm-3-0', 'bm-3-1',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('stops at the 50-page safety cap and reports truncation', async () => {
    vi.mocked(biomarkersApi.getAll).mockImplementation(
      async (params) => makePage(params?.page ?? 1, 1, 60) as never
    );

    const result = await fetchAllBiomarkers();

    expect(biomarkersApi.getAll).toHaveBeenCalledTimes(50);
    expect(biomarkersApi.getAll).toHaveBeenLastCalledWith({ page: 50, limit: 100 });
    expect(result.biomarkers).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it('propagates fetch errors to the caller', async () => {
    vi.mocked(biomarkersApi.getAll).mockRejectedValue(new Error('API error'));

    await expect(fetchAllBiomarkers()).rejects.toThrow('API error');
  });
});

// ============================================
// Create payload contracts (teardown follow-up)
// ============================================
// These assert the EXACT request bodies the hook sends. The backend rejects
// flat normalRange* keys and non-ISO dates with 422 — and one bad item fails
// an entire batch — so the shapes below are load-bearing.
describe('useBiomarkerData create payload contracts', () => {
  const user = { id: 'user-1', email: 'test@example.com', role: 'PATIENT' };

  function renderBiomarkerHook(onError = vi.fn()) {
    return renderHook(() =>
      useBiomarkerData({ user, initialBiomarkers: [], onError })
    );
  }

  // Parser-realistic extraction item (convertToBiomarkers output shape),
  // except the date is RAW US lab-header format to prove normalization.
  function makeExtractedItem(overrides: Partial<Biomarker> = {}): Partial<Biomarker> {
    return {
      name: 'Hemoglobin A1c',
      value: 5.4,
      unit: '%',
      date: '01/15/2026',
      category: 'Blood',
      normalRange: { min: 4, max: 5.6, source: 'Lab Report' },
      sourceFile: 'lab-report.pdf',
      extractionConfidence: 0.92,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Quiet initial mount fetches
    vi.mocked(biomarkersApi.getAll).mockResolvedValue({
      biomarkers: [],
      pagination: { total: 0, page: 1, limit: 100, totalPages: 1 },
    } as never);
    vi.mocked(insuranceApi.getPlans).mockResolvedValue([] as never);
    // Echo payloads back as created records
    vi.mocked(biomarkersApi.create).mockImplementation(
      async (data) => ({ ...data, id: 'bm-created', isOutOfRange: false }) as never
    );
    vi.mocked(biomarkersApi.createBatch).mockImplementation(
      async (items) =>
        items.map((d, i) => ({ ...d, id: `bm-${i}`, isOutOfRange: false })) as never
    );
  });

  it('handleAddMeasurement sends a nested normalRange and the ISO date as-is', async () => {
    const { result } = renderBiomarkerHook();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.handleAddMeasurement({
        name: 'Glucose',
        value: 95,
        unit: 'mg/dL',
        date: '2026-01-15',
        category: 'Blood',
        normalRange: { min: 70, max: 100, source: 'Standard Reference' },
        notes: 'Fasting sample',
      });
    });

    expect(biomarkersApi.create).toHaveBeenCalledTimes(1);
    expect(biomarkersApi.create).toHaveBeenCalledWith({
      name: 'Glucose',
      value: 95,
      unit: 'mg/dL',
      date: '2026-01-15',
      category: 'Blood',
      normalRange: { min: 70, max: 100, source: 'Standard Reference' },
      notes: 'Fasting sample',
    });
  });

  it('handlePDFExtract sends ISO date, LAB_UPLOAD sourceType, and provenance fields', async () => {
    const { result } = renderBiomarkerHook();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.handlePDFExtract([makeExtractedItem()]);
    });

    expect(biomarkersApi.createBatch).toHaveBeenCalledTimes(1);
    expect(biomarkersApi.createBatch).toHaveBeenCalledWith([
      {
        name: 'Hemoglobin A1c',
        value: 5.4,
        unit: '%',
        date: '2026-01-15', // '01/15/2026' normalized — raw US dates 422
        category: 'Blood',
        normalRange: { min: 4, max: 5.6, source: 'Lab Report' },
        sourceType: 'LAB_UPLOAD',
        sourceFile: 'lab-report.pdf',
        extractionConfidence: 0.92,
      },
    ]);
  });

  it('handlePDFExtract chunks >100-item extractions into sequential ≤100 batches', async () => {
    const { result } = renderBiomarkerHook();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const items = Array.from({ length: 205 }, (_, i) =>
      makeExtractedItem({ name: `Marker ${i}`, value: i })
    );

    await act(async () => {
      await result.current.handlePDFExtract(items);
    });

    const calls = vi.mocked(biomarkersApi.createBatch).mock.calls;
    expect(calls.map((c) => c[0].length)).toEqual([100, 100, 5]);
    // All 205 created records end up in state
    expect(result.current.biomarkers).toHaveLength(205);
  });

  it('handlePDFExtract keeps saved chunks and falls back locally for the remainder on mid-chunk failure', async () => {
    const onError = vi.fn();
    vi.mocked(biomarkersApi.createBatch)
      .mockImplementationOnce(
        async (items) =>
          items.map((d, i) => ({ ...d, id: `srv-${i}`, isOutOfRange: false })) as never
      )
      .mockRejectedValueOnce(new Error('Server unavailable'));

    const { result } = renderBiomarkerHook(onError);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const items = Array.from({ length: 150 }, (_, i) =>
      makeExtractedItem({ name: `Marker ${i}`, value: i })
    );

    await act(async () => {
      await result.current.handlePDFExtract(items);
    });

    expect(biomarkersApi.createBatch).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('not synced to server')
    );
    // 100 server copies (first chunk) + 50 local fallbacks (failed remainder)
    expect(result.current.biomarkers).toHaveLength(150);
    expect(
      result.current.biomarkers.filter((b) => b.id.startsWith('srv-'))
    ).toHaveLength(100);
  });
});
