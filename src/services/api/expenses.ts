/**
 * Expenses API - Cost Tracking & Optimization
 */

import { apiFetch } from './client';

export interface ExpenseProjectionData {
  id: string;
  userId: string;
  planId: string;
  serviceType: string;
  estimatedCost: number;
  frequencyPerYear: number;
  isInNetwork: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ClaimStatus = 'pending' | 'processed' | 'denied' | 'appealed';

export interface ExpenseActualData {
  id: string;
  userId: string;
  planId: string;
  projectionId: string | null;
  serviceType: string;
  serviceDate: string | null;
  providerName: string | null;
  billedAmount: number | null;
  insurancePaid: number | null;
  patientPaid: number | null;
  appliedToDeductible: number | null;
  appliedToOop: number | null;
  isInNetwork: boolean;
  claimStatus: ClaimStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpenseActualData {
  planId: string;
  projectionId?: string;
  serviceType: string;
  serviceDate?: string;
  providerName?: string;
  billedAmount?: number;
  insurancePaid?: number;
  patientPaid?: number;
  appliedToDeductible?: number;
  appliedToOop?: number;
  isInNetwork?: boolean;
  claimStatus?: ClaimStatus;
  notes?: string;
}

export interface UpdateExpenseActualData {
  projectionId?: string | null;
  serviceType?: string;
  serviceDate?: string;
  providerName?: string;
  billedAmount?: number;
  insurancePaid?: number;
  patientPaid?: number;
  appliedToDeductible?: number;
  appliedToOop?: number;
  isInNetwork?: boolean;
  claimStatus?: ClaimStatus;
  notes?: string;
}

export interface CostAnalysisData {
  id: string;
  planId: string;
  claudeResponse: string;
  totalProjectedOop: number | null;
  createdAt: string;
  deductibleMetMonth?: number | null;
  // Not returned by the API (minimal-necessary): the server holds the
  // encrypted snapshot and the client already knows its own userId.
  userId?: string;
  projectedExpensesSnapshot?: string;
}

export interface CreateExpenseProjectionData {
  planId: string;
  serviceType: string;
  estimatedCost: number;
  frequencyPerYear?: number;
  isInNetwork?: boolean;
  notes?: string;
}

export interface UpdateExpenseProjectionData {
  serviceType?: string;
  estimatedCost?: number;
  frequencyPerYear?: number;
  isInNetwork?: boolean;
  notes?: string;
}

export interface AnalyzeCostsRequest {
  planId: string;
}

/**
 * Page through a paginated list endpoint and return the COMPLETE set.
 *
 * `CostOptimization` computes plan-wide totals (projected annual cost,
 * patient-paid) and a per-projection breakdown entirely client-side, so a single
 * truncated page (these endpoints default to 20 rows) would understate the
 * headline figures AND hide line items. We request the server's max page size
 * and follow `pagination.totalPages` to fetch everything — this is NOT "just
 * raise the limit", which would only move the truncation threshold. A hard page
 * cap guards against a runaway loop if the server ever reports a bad totalPages.
 */
async function fetchAllPages<T>(baseUrl: string): Promise<T[]> {
  const PAGE_SIZE = 100; // the server's max `limit`
  const MAX_PAGES = 50; // 50 × 100 = 5,000 rows — far beyond any realistic plan
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

export const expensesApi = {
  /**
   * Get all expense projections for a plan
   */
  async getProjections(planId: string): Promise<ExpenseProjectionData[]> {
    // Fetch the COMPLETE set (all pages) — CostOptimization sums these into the
    // plan's projected annual cost, so a truncated first page understates it.
    return fetchAllPages<ExpenseProjectionData>(
      `/expenses/projections?planId=${encodeURIComponent(planId)}`
    );
  },

  /**
   * Create a new expense projection
   */
  async createProjection(data: CreateExpenseProjectionData): Promise<ExpenseProjectionData> {
    const response = await apiFetch<ExpenseProjectionData>('/expenses/projections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Update an existing expense projection
   */
  async updateProjection(
    id: string,
    data: UpdateExpenseProjectionData
  ): Promise<ExpenseProjectionData> {
    const response = await apiFetch<ExpenseProjectionData>(`/expenses/projections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Delete an expense projection
   */
  async deleteProjection(id: string): Promise<void> {
    await apiFetch(`/expenses/projections/${id}`, {
      method: 'DELETE',
    });
  },

  // ============================================
  // EXPENSE ACTUALS (real claims / EOBs)
  // ============================================

  /**
   * List all expense actuals for a plan (sorted by service date desc).
   */
  async getActuals(planId: string): Promise<ExpenseActualData[]> {
    // Fetch the COMPLETE set (all pages) — CostOptimization sums patientPaid and
    // matches claims to projections across the full set, and ExpenseActualsList
    // renders every claim; a truncated first page would drop both.
    return fetchAllPages<ExpenseActualData>(
      `/expenses/actuals?planId=${encodeURIComponent(planId)}`
    );
  },

  /**
   * Record a new expense actual (claim/EOB entry).
   */
  async createActual(data: CreateExpenseActualData): Promise<ExpenseActualData> {
    const response = await apiFetch<ExpenseActualData>('/expenses/actuals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Update an existing expense actual.
   */
  async updateActual(id: string, data: UpdateExpenseActualData): Promise<ExpenseActualData> {
    const response = await apiFetch<ExpenseActualData>(`/expenses/actuals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Delete an expense actual.
   */
  async deleteActual(id: string): Promise<void> {
    await apiFetch(`/expenses/actuals/${id}`, { method: 'DELETE' });
  },

  /**
   * Analyze costs using Claude AI
   * Generates personalized cost optimization recommendations
   */
  async analyzeCosts(request: AnalyzeCostsRequest): Promise<CostAnalysisData> {
    const response = await apiFetch<CostAnalysisData>(
      '/expenses/analyze',
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
      60000 // 60 second timeout for AI analysis
    );
    return response.data;
  },

  /**
   * Get all cost analyses for a plan
   */
  async getAnalyses(planId: string): Promise<CostAnalysisData[]> {
    const response = await apiFetch<CostAnalysisData[]>(
      `/expenses/analyses?planId=${planId}`
    );
    return response.data;
  },

};
