/**
 * Shared client-side pagination helper.
 */

import { apiFetch } from './client';

/**
 * Page through a paginated list endpoint and return the COMPLETE set.
 *
 * Several consumers compute over the full dataset client-side (e.g.
 * CostOptimization's plan-wide totals; the provider patient views), so a single
 * truncated page would understate figures and hide rows. We request the server's
 * max page size and follow `pagination.totalPages` to fetch everything — this is
 * NOT "just raise the limit", which would only move the truncation threshold. A
 * hard page cap guards against a runaway loop if the server ever reports a bad
 * totalPages.
 */
export async function fetchAllPages<T>(baseUrl: string): Promise<T[]> {
  const PAGE_SIZE = 100; // the server's max `limit`
  const MAX_PAGES = 50; // 50 × 100 = 5,000 rows — far beyond any realistic set
  const sep = baseUrl.includes('?') ? '&' : '?';
  const fetchPage = (page: number) =>
    apiFetch<T[]>(`${baseUrl}${sep}page=${page}&limit=${PAGE_SIZE}`);

  const first = await fetchPage(1);
  const all: T[] = [...(first.data ?? [])];
  const totalPages = Math.min(first.pagination?.totalPages ?? 1, MAX_PAGES);
  for (let page = 2; page <= totalPages; page++) {
    const next = await fetchPage(page);
    all.push(...(next.data ?? []));
  }
  return all;
}
