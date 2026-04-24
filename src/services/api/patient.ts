/**
 * Patient API (consent management)
 */

import { apiFetch } from './client';

export interface PatientProviderRelationship {
  relationshipId: string;
  providerId: string;
  provider: {
    id: string;
    email: string;
  } | null;
  permissions: {
    canViewBiomarkers: boolean;
    canViewInsurance: boolean;
    canViewHealthNeeds: boolean;
    canEditData: boolean;
  };
  relationshipType: string;
  status: string;
  consentGrantedAt: string | null;
  consentExpiresAt: string | null;
  createdAt: string;
}

export interface PendingProviderRequest {
  requestId: string;
  providerId: string;
  provider: {
    id: string;
    email: string;
  } | null;
  relationshipType: string;
  requestedAt: string;
}

export const patientApi = {
  async getProviders(): Promise<PatientProviderRelationship[]> {
    const response = await apiFetch<PatientProviderRelationship[]>('/patient/providers');
    return response.data;
  },

  async getPendingRequests(): Promise<PendingProviderRequest[]> {
    const response = await apiFetch<PendingProviderRequest[]>('/patient/providers/pending');
    return response.data;
  },

  async approveProvider(
    requestId: string,
    permissions?: {
      canViewBiomarkers?: boolean;
      canViewInsurance?: boolean;
      canViewHealthNeeds?: boolean;
      canEditData?: boolean;
      consentDurationDays?: number;
    }
  ): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify(permissions || {}),
    });
    return response.data;
  },

  async denyProvider(requestId: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${requestId}/deny`, {
      method: 'POST',
    });
    return response.data;
  },

  async updateProviderPermissions(
    relationshipId: string,
    permissions: {
      canViewBiomarkers?: boolean;
      canViewInsurance?: boolean;
      canViewHealthNeeds?: boolean;
      canEditData?: boolean;
    }
  ): Promise<PatientProviderRelationship> {
    const response = await apiFetch<PatientProviderRelationship>(`/patient/providers/${relationshipId}`, {
      method: 'PATCH',
      body: JSON.stringify(permissions),
    });
    return response.data;
  },

  async revokeProvider(relationshipId: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${relationshipId}/revoke`, {
      method: 'POST',
    });
    return response.data;
  },

  async removeProvider(relationshipId: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${relationshipId}`, {
      method: 'DELETE',
    });
    return response.data;
  },
};
