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

export interface ExpenseActualData {
  id: string;
  userId: string;
  planId: string;
  serviceType: string;
  serviceDate: string;
  providerName: string;
  billedAmount: number;
  insurancePaid: number;
  patientPaid: number;
  appliedToDeductible: number;
  appliedToOop: number;
  isInNetwork: boolean;
  claimStatus: 'pending' | 'processed' | 'denied' | 'appealed';
  notes?: string;
  createdAt: string;
  updatedAt: string;
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
