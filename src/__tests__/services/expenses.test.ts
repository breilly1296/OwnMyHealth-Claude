/**
 * expensesApi pagination-contract tests.
 *
 * getProjections / getActuals must return the COMPLETE set by paging through
 * every page. CostOptimization sums these client-side into the plan's projected
 * annual cost and patient-paid totals, so a truncated first page (the endpoints
 * default to 20 rows) understates the headline figures and hides line items.
 * These tests pin the page-through behavior so a regression back to a single-page
 * fetch fails loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../services/api/client';
import { expensesApi } from '../../services/api/expenses';

const mockedApiFetch = vi.mocked(apiFetch);

// Minimal paginated-envelope helper; only the fields fetchAllPages reads matter.
function page(rows: unknown[], totalPages: number, pageNum: number) {
  return {
    success: true,
    data: rows,
    pagination: { page: pageNum, limit: 100, total: 100 * (totalPages - 1) + rows.length, totalPages },
  } as never;
}

describe('expensesApi.getProjections pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests the max page size and returns the single page when totalPages is 1', async () => {
    mockedApiFetch.mockResolvedValue(page([{ id: 'p1' }, { id: 'p2' }], 1, 1));

    const result = await expensesApi.getProjections('plan-1');

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/expenses/projections?planId=plan-1&page=1&limit=100'
    );
    expect(result).toHaveLength(2);
  });

  it('pages through and concatenates ALL rows when total exceeds one page', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => ({ id: `p${i}` })), 2, 1))
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => ({ id: `p${100 + i}` })), 2, 2));

    const result = await expensesApi.getProjections('plan-1');

    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      1,
      '/expenses/projections?planId=plan-1&page=1&limit=100'
    );
    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      2,
      '/expenses/projections?planId=plan-1&page=2&limit=100'
    );
    // The full 150 rows come back — not the truncated first page (or default 20).
    expect(result).toHaveLength(150);
  });
});

describe('expensesApi.getActuals pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pages through actuals across all pages', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })), 2, 1))
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => ({ id: `a${100 + i}` })), 2, 2));

    const result = await expensesApi.getActuals('plan-1');

    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      1,
      '/expenses/actuals?planId=plan-1&page=1&limit=100'
    );
    expect(result).toHaveLength(120);
  });
});
