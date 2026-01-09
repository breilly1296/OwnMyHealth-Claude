/**
 * Health Needs API
 */

import { apiFetch } from './client';

export interface HealthNeedData {
  id: string;
  needType: 'CONDITION' | 'ACTION' | 'SERVICE' | 'FOLLOW_UP';
  name: string;
  description: string;
  urgency: 'IMMEDIATE' | 'URGENT' | 'FOLLOW_UP' | 'ROUTINE';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';
  relatedBiomarkerIds: string[];
  createdAt: string;
  resolvedAt?: string;
}

export interface CreateHealthNeedData {
  needType: string;
  name: string;
  description: string;
  urgency: string;
  relatedBiomarkerIds?: string[];
}

export const healthNeedsApi = {
  async getAll(params?: {
    status?: string;
    urgency?: string;
  }): Promise<HealthNeedData[]> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.urgency) searchParams.set('urgency', params.urgency);

    const query = searchParams.toString();
    const response = await apiFetch<HealthNeedData[]>(`/health-needs${query ? `?${query}` : ''}`);
    return response.data;
  },

  async getById(id: string): Promise<HealthNeedData> {
    const response = await apiFetch<HealthNeedData>(`/health-needs/${id}`);
    return response.data;
  },

  async create(data: CreateHealthNeedData): Promise<HealthNeedData> {
    const response = await apiFetch<HealthNeedData>('/health-needs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updateStatus(id: string, status: string): Promise<HealthNeedData> {
    const response = await apiFetch<HealthNeedData>(`/health-needs/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/health-needs/${id}`, { method: 'DELETE' });
  },

  async analyze(): Promise<{
    detectedConditions: HealthNeedData[];
    recommendations: string[];
  }> {
    const response = await apiFetch<{
      detectedConditions: HealthNeedData[];
      recommendations: string[];
    }>('/health-needs/analyze');
    return response.data;
  },
};
