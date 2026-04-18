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
  userId: string;
  planId: string;
  claudeResponse: string;
  totalProjectedOop: number;
  projectedExpensesSnapshot: string;
  createdAt: string;
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
  projections?: ExpenseProjectionData[];
}

export interface UpdateCurrentSpendingData {
  deductibleMetIndividual: number;
  oopMetIndividual: number;
  deductibleMetFamily?: number;
  oopMetFamily?: number;
}

export const expensesApi = {
  /**
   * Get all expense projections for a plan
   */
  async getProjections(planId: string): Promise<ExpenseProjectionData[]> {
    const response = await apiFetch<ExpenseProjectionData[]>(
      `/expenses/projections?planId=${planId}`
    );
    return response.data;
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
    const response = await apiFetch<ExpenseActualData[]>(
      `/expenses/actuals?planId=${encodeURIComponent(planId)}`
    );
    return response.data;
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

  /**
   * Update current deductible and OOP spending for a plan
   */
  async updateCurrentSpending(
    planId: string,
    data: UpdateCurrentSpendingData
  ): Promise<void> {
    await apiFetch(`/insurance/plans/${planId}/spending`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};
