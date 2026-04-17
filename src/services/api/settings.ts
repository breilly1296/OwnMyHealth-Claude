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
