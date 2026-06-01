/**
 * Health Goals API
 */

import { apiFetch } from './client';

export interface HealthGoalData {
  id: string;
  name: string;
  description: string | null;
  category: string;
  targetValue: number;
  currentValue: number | null;
  startValue: number | null;
  unit: string;
  direction: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  relatedBiomarkerId: string | null;
  startDate: string;
  targetDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'FAILED' | 'CANCELLED';
  progress: number;
  milestones: { value: number; label: string; achieved: boolean; achievedAt?: string }[] | null;
  reminderFrequency: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateHealthGoalData {
  name: string;
  description?: string;
  category: string;
  targetValue: number;
  startValue?: number;
  unit: string;
  direction: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  relatedBiomarkerId?: string;
  startDate: string;
  targetDate: string;
  milestones?: { value: number; label: string }[];
  reminderFrequency?: string;
}

export interface UpdateHealthGoalData {
  name?: string;
  description?: string;
  category?: string;
  targetValue?: number;
  unit?: string;
  direction?: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  targetDate?: string;
  milestones?: { value: number; label: string }[];
  reminderFrequency?: string;
  status?: 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'FAILED' | 'CANCELLED';
}

export interface GoalProgressUpdate {
  value: number;
  note?: string;
}

export interface GoalsSummary {
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  total: number;
  active: number;
  achieved: number;
  needAttention: number;
  recentlyAchieved: number;
}

export const healthGoalsApi = {
  async getAll(params?: { status?: string; category?: string }): Promise<HealthGoalData[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.category) queryParams.set('category', params.category);
    const query = queryParams.toString() ? `?${queryParams}` : '';
    const response = await apiFetch<HealthGoalData[]>(`/health-goals${query}`);
    return response.data;
  },

  async getById(id: string): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>(`/health-goals/${id}`);
    return response.data;
  },

  async create(data: CreateHealthGoalData): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>('/health-goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async update(id: string, data: UpdateHealthGoalData): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>(`/health-goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updateProgress(id: string, data: GoalProgressUpdate): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>(`/health-goals/${id}/progress`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/health-goals/${id}`, { method: 'DELETE' });
  },

  async getSummary(): Promise<GoalsSummary> {
    const response = await apiFetch<GoalsSummary>('/health-goals/summary');
    return response.data;
  },

  async getSuggestions(): Promise<HealthGoalSuggestion[]> {
    const response = await apiFetch<HealthGoalSuggestion[]>('/health-goals/suggestions');
    return response.data;
  },
};

/**
 * Server-generated goal suggestion. The backend computes `targetValue` as
 * the midpoint of the linked biomarker's normal range and includes
 * `relatedBiomarkerId` so the UI can pre-fill the create-goal form
 * without round-tripping to compute it.
 *
 * `relatedBiomarkerId` is an empty string for generic suggestions
 * (e.g., "Maintain Healthy Blood Pressure") that aren't tied to a
 * specific user biomarker.
 */
export interface HealthGoalSuggestion {
  name: string;
  description: string;
  category: string;
  unit: string;
  direction: string;
  targetValue: number;
  relatedBiomarkerId: string;
}
