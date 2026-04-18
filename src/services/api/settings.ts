/**
 * Settings API
 */

import { apiFetch } from './client';

export interface ExportBiomarker {
  name: string;
  standardName: string;
  category: string;
  value: number;
  unit: string;
  date: string;
  isAbnormal: boolean;
  referenceRange: {
    min: number;
    max: number;
    source?: string;
  };
  source: string;
}

export interface ExportInsurancePlan {
  planName: string;
  insurerName: string;
  planType: string;
  effectiveDate: string;
  terminationDate?: string;
  isActive: boolean;
  isPrimary: boolean;
  deductibleIndividual: number;
  deductibleFamily: number;
  oopMaxIndividual: number;
  oopMaxFamily: number;
}

export interface UserExportData {
  exportDate: string;
  user: {
    email: string;
    createdAt: string;
  };
  biomarkers: ExportBiomarker[];
  insurancePlans: ExportInsurancePlan[];
  summary: {
    totalBiomarkers: number;
    byCategory: Record<string, number>;
    abnormalCount: number;
    normalCount: number;
  };
}

export interface NotificationPreferences {
  emailNotifications: boolean;
  weeklySummary: boolean;
  abnormalAlerts: boolean;
}

export interface UserProfile {
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  notificationPreferences: NotificationPreferences;
}

// ---------- Health profile (self-reported, encrypted at rest) ----------

export type BiologicalSex = 'male' | 'female';
export type AgeRange = '18-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70+';
export type ConditionStatus = 'active' | 'managed' | 'resolved';
export type SmokingStatus = 'never' | 'former' | 'current';
export type ExerciseLevel = 'sedentary' | 'light' | 'moderate' | 'active';

export interface HealthCondition {
  name: string;
  status: ConditionStatus;
  diagnosedYear?: number;
}

export interface Medication {
  name: string;
  purpose?: string;
}

export interface UserHealthProfile {
  biologicalSex?: BiologicalSex;
  ageRange?: AgeRange;
  conditions: HealthCondition[];
  medications: Medication[];
  familyHistory: string[];
  smokingStatus?: SmokingStatus;
  exerciseLevel?: ExerciseLevel;
  additionalContext?: string;
  updatedAt?: string;
}

export interface UpdateHealthProfileData {
  biologicalSex?: BiologicalSex;
  ageRange?: AgeRange;
  conditions?: HealthCondition[];
  medications?: Medication[];
  familyHistory?: string[];
  smokingStatus?: SmokingStatus;
  exerciseLevel?: ExerciseLevel;
  additionalContext?: string;
}

export const settingsApi = {
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  async getProfile(): Promise<UserProfile> {
    const response = await apiFetch<UserProfile>('/settings/profile');
    return response.data;
  },

  async updateProfile(data: { firstName?: string; lastName?: string }): Promise<UserProfile> {
    const response = await apiFetch<UserProfile>('/settings/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updateNotifications(prefs: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const response = await apiFetch<NotificationPreferences>('/settings/notifications', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    });
    return response.data;
  },

  async getHealthProfile(): Promise<UserHealthProfile> {
    const response = await apiFetch<UserHealthProfile>('/settings/health-profile');
    return response.data;
  },

  async updateHealthProfile(data: UpdateHealthProfileData): Promise<UserHealthProfile> {
    const response = await apiFetch<UserHealthProfile>('/settings/health-profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async exportData(): Promise<UserExportData> {
    const response = await apiFetch<UserExportData>('/settings/export-data');
    return response.data;
  },

  async deleteAllData(): Promise<void> {
    await apiFetch('/settings/delete-data', { method: 'DELETE' });
  },

  async deleteAccount(password: string): Promise<void> {
    await apiFetch('/settings/delete-account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
  },
};
