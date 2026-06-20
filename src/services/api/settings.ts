/**
 * Settings API
 */

import { apiFetch } from './client';

export interface ExportBiomarkerHistoryEntry {
  value: number;
  date: string;
}

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
  notes?: string;
  history: ExportBiomarkerHistoryEntry[];
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
  memberId?: string;
  groupId?: string;
}

export interface ExportHealthGoal {
  name: string;
  description?: string;
  category: string;
  targetValue: number;
  currentValue?: number;
  startValue?: number;
  unit: string;
  direction: string;
  startDate: string;
  targetDate: string;
  status: string;
  progress: number;
  milestones?: string;
  reminderFrequency?: string;
  progressHistory: Array<{
    value: number;
    progress: number;
    note?: string;
    recordedAt: string;
  }>;
}

export interface ExportHealthNeed {
  name: string;
  needType: string;
  description: string;
  urgency: string;
  status: string;
  relatedBiomarkerIds: string[];
  createdAt: string;
  resolvedAt?: string;
}

export interface ExportExpenseProjection {
  serviceType: string;
  estimatedCost: number | null;
  frequencyPerYear: number;
  isInNetwork: boolean;
  notes?: string;
  planId: string;
}

export interface ExportExpenseActual {
  serviceType: string;
  providerName?: string;
  billedAmount: number | null;
  insurancePaid: number | null;
  patientPaid: number | null;
  appliedToDeductible: number | null;
  appliedToOop: number | null;
  dateOfService?: string;
  isInNetwork: boolean | null;
  claimStatus: string;
  notes?: string;
}

export interface ExportCostAnalysis {
  claudeResponse: string;
  totalProjectedOop: number | null;
  analysisDate: string;
}

export interface ExportUserFile {
  originalFilename: string;
  fileType: string;
  fileSize: number;
  labName?: string;
  labDate?: string;
  biomarkersExtracted: number;
  createdAt: string;
}

export interface ExportProviderRelationship {
  relationshipType: string;
  status: string;
  role: 'patient' | 'provider';
  canViewBiomarkers: boolean;
  canViewInsurance: boolean;
  canViewHealthNeeds: boolean;
  canEditData: boolean;
  consentGrantedAt?: string;
  consentExpiresAt?: string;
  notes?: string;
}

/** Self-reported health profile included in the data export (mirrors the
 *  backend UserHealthProfile). */
export interface ExportHealthProfile {
  biologicalSex?: string;
  ageRange?: string;
  conditions: { name: string; status: string; diagnosedYear?: number }[];
  medications: { name: string; purpose?: string }[];
  familyHistory: string[];
  smokingStatus?: string;
  exerciseLevel?: string;
  additionalContext?: string;
  updatedAt?: string;
}

export interface UserExportData {
  exportDate: string;
  user: {
    email: string;
    role: string;
    createdAt: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    phone?: string;
    address?: string;
  };
  healthProfile: ExportHealthProfile;
  biomarkers: ExportBiomarker[];
  insurancePlans: ExportInsurancePlan[];
  healthGoals: ExportHealthGoal[];
  healthNeeds: ExportHealthNeed[];
  expenseProjections: ExportExpenseProjection[];
  expenseActuals: ExportExpenseActual[];
  costAnalyses: ExportCostAnalysis[];
  files: ExportUserFile[];
  providerRelationships: ExportProviderRelationship[];
  filesNote: string;
  summary: {
    totalBiomarkers: number;
    byCategory: Record<string, number>;
    abnormalCount: number;
    normalCount: number;
    totalInsurancePlans: number;
    totalHealthGoals: number;
    totalHealthNeeds: number;
    totalExpenseProjections: number;
    totalExpenseActuals: number;
    totalCostAnalyses: number;
    totalFiles: number;
    totalProviderRelationships: number;
  };
}

/** New canonical shape — fields the notification dispatcher actually reads. */
export interface EmailNotificationPreferences {
  enabled: boolean;
  newResults: boolean;
  outOfRangeAlerts: boolean;
  goalReminders: boolean;
  weeklySummary: boolean;
  planExpiring: boolean;
}

/**
 * The preferences payload returned by GET /settings/notifications.
 * Includes back-compat flat aliases (emailNotifications / weeklySummary /
 * abnormalAlerts) so the existing toggles in AccountSettingsPage keep
 * rendering without conditional code.
 */
export interface NotificationPreferences {
  emailNotifications: boolean;
  weeklySummary: boolean;
  abnormalAlerts: boolean;
  email: EmailNotificationPreferences;
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

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    const response = await apiFetch<NotificationPreferences>('/settings/notifications');
    return response.data;
  },

  /** Patch the new nested `email.*` shape. */
  async updateNotificationPreferences(
    prefs: Partial<EmailNotificationPreferences>
  ): Promise<NotificationPreferences> {
    const response = await apiFetch<NotificationPreferences>('/settings/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ email: prefs }),
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

  async deleteAllData(password: string): Promise<void> {
    await apiFetch('/settings/delete-data', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
  },

  async deleteAccount(password: string): Promise<void> {
    await apiFetch('/settings/delete-account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
  },
};
