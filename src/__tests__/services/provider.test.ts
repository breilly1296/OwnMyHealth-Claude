/**
 * providerApi PHI-list pagination contract tests.
 *
 * The provider patient views render the full record, but the backend endpoints
 * now paginate (to bound per-request decrypt of a long-tenured patient's data).
 * These pin that the client pages through the COMPLETE set so a regression to a
 * single-page fetch (silently dropping a patient's older data from a clinician's
 * view) fails loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../services/api/client';
import { providerApi } from '../../services/api/provider';

const mockedApiFetch = vi.mocked(apiFetch);

function page(rows: unknown[], totalPages: number, pageNum: number) {
  return {
    success: true,
    data: rows,
    pagination: { page: pageNum, limit: 100, total: 100 * (totalPages - 1) + rows.length, totalPages },
  } as never;
}

describe('providerApi PHI list pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getPatientBiomarkers pages through and concatenates ALL pages', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => ({ id: `b${i}` })), 2, 1))
      .mockResolvedValueOnce(page(Array.from({ length: 30 }, (_, i) => ({ id: `b${100 + i}` })), 2, 2));

    const result = await providerApi.getPatientBiomarkers('patient-1');

    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      1,
      '/provider/patients/patient-1/biomarkers?page=1&limit=100'
    );
    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      2,
      '/provider/patients/patient-1/biomarkers?page=2&limit=100'
    );
    expect(result).toHaveLength(130);
  });

  it('getPatientHealthNeeds and getPatientInsurance request the max page size', async () => {
    mockedApiFetch.mockResolvedValue(page([{ id: 'x' }], 1, 1));

    await providerApi.getPatientHealthNeeds('patient-1');
    expect(mockedApiFetch).toHaveBeenLastCalledWith(
      '/provider/patients/patient-1/health-needs?page=1&limit=100'
    );

    await providerApi.getPatientInsurance('patient-1');
    expect(mockedApiFetch).toHaveBeenLastCalledWith(
      '/provider/patients/patient-1/insurance?page=1&limit=100'
    );
  });
});
