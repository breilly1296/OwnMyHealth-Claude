/**
 * Biomarkers API
 */

import { apiFetch, ApiResponse } from './client';

export interface BiomarkerData {
  id: string;
  name: string;
  value: number;
  unit: string;
  date: string;
  category: string;
  normalRange: {
    min: number;
    max: number;
    source?: string;
  };
  description?: string;
  notes?: string;
  sourceFile?: string;
  extractionConfidence?: number;
  isOutOfRange: boolean;
}

export interface BiomarkerHistory {
  date: string;
  value: number;
  notes?: string;
}

export interface CreateBiomarkerData {
  name: string;
  value: number;
  unit: string;
  date: string;
  category: string;
  normalRangeMin: number;
  normalRangeMax: number;
  normalRangeSource?: string;
  notes?: string;
  sourceFile?: string;
  extractionConfidence?: number;
}

export const biomarkersApi = {
  async getAll(params?: {
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<{ biomarkers: BiomarkerData[]; pagination?: ApiResponse<unknown>['pagination'] }> {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set('category', params.category);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    const response = await apiFetch<BiomarkerData[]>(`/biomarkers${query ? `?${query}` : ''}`);
    return { biomarkers: response.data, pagination: response.pagination };
  },

  async getById(id: string): Promise<BiomarkerData> {
    const response = await apiFetch<BiomarkerData>(`/biomarkers/${id}`);
    return response.data;
  },

  async getHistory(id: string): Promise<BiomarkerHistory[]> {
    const response = await apiFetch<BiomarkerHistory[]>(`/biomarkers/${id}/history`);
    return response.data;
  },

  async create(data: CreateBiomarkerData): Promise<BiomarkerData> {
    const response = await apiFetch<BiomarkerData>('/biomarkers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async createBatch(data: CreateBiomarkerData[]): Promise<BiomarkerData[]> {
    const response = await apiFetch<BiomarkerData[]>('/biomarkers/batch', {
      method: 'POST',
      body: JSON.stringify({ biomarkers: data }),
    });
    return response.data;
  },

  async update(id: string, data: Partial<CreateBiomarkerData>): Promise<BiomarkerData> {
    const response = await apiFetch<BiomarkerData>(`/biomarkers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/biomarkers/${id}`, { method: 'DELETE' });
  },

  async getCategories(): Promise<string[]> {
    const response = await apiFetch<string[]>('/biomarkers/categories');
    return response.data;
  },

  async getSummary(): Promise<{
    total: number;
    outOfRange: number;
    byCategory: Record<string, number>;
  }> {
    const response = await apiFetch<{
      total: number;
      outOfRange: number;
      byCategory: Record<string, number>;
    }>('/biomarkers/summary');
    return response.data;
  },

  async getGuidance(id: string): Promise<{ guidance: string }> {
    const response = await apiFetch<{ guidance: string }>(
      `/biomarkers/${id}/guidance`,
      { method: 'POST' },
      60000 // 60s — this triggers a server-side Claude generation; match the
            // other AI endpoints (analyzeCosts, SBC upload) instead of the 30s default
    );
    return response.data;
  },
};
