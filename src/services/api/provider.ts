/**
 * Provider API (for healthcare providers)
 */

import { apiFetch } from './client';
import { BiomarkerData } from './biomarkers';
import { HealthNeedData } from './healthNeeds';
import type { InsurancePlanData } from './insurance';

export type UserRole = 'PATIENT' | 'PROVIDER' | 'ADMIN';

export interface ProviderPatientRelationship {
  relationshipId: string;
  patientId: string;
  patient: {
    id: string;
    email: string;
    createdAt: string;
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

export const providerApi = {
  async getPatients(): Promise<ProviderPatientRelationship[]> {
    const response = await apiFetch<ProviderPatientRelationship[]>('/provider/patients');
    return response.data;
  },

  async requestPatientAccess(patientEmail: string, relationshipType?: string, message?: string): Promise<{ relationshipId: string; status: string }> {
    const response = await apiFetch<{ relationshipId: string; status: string }>('/provider/patients/request', {
      method: 'POST',
      body: JSON.stringify({ patientEmail, relationshipType, message }),
    });
    return response.data;
  },

  async getPatient(patientId: string): Promise<{
    patient: { id: string; email: string; createdAt: string; lastLoginAt: string | null };
    relationship: {
      id: string;
      relationshipType: string;
      permissions: ProviderPatientRelationship['permissions'];
      consentGrantedAt: string | null;
      consentExpiresAt: string | null;
    };
  }> {
    const response = await apiFetch<{
      patient: { id: string; email: string; createdAt: string; lastLoginAt: string | null };
      relationship: {
        id: string;
        relationshipType: string;
        permissions: ProviderPatientRelationship['permissions'];
        consentGrantedAt: string | null;
        consentExpiresAt: string | null;
      };
    }>(`/provider/patients/${patientId}`);
    return response.data;
  },

  async getPatientBiomarkers(patientId: string): Promise<BiomarkerData[]> {
    const response = await apiFetch<BiomarkerData[]>(`/provider/patients/${patientId}/biomarkers`);
    return response.data;
  },

  async getPatientHealthNeeds(patientId: string): Promise<HealthNeedData[]> {
    const response = await apiFetch<HealthNeedData[]>(`/provider/patients/${patientId}/health-needs`);
    return response.data;
  },

  // M3: gated on the patient's canViewInsurance consent flag, server-side.
  async getPatientInsurance(patientId: string): Promise<InsurancePlanData[]> {
    const response = await apiFetch<InsurancePlanData[]>(`/provider/patients/${patientId}/insurance`);
    return response.data;
  },

  async removePatient(patientId: string): Promise<void> {
    await apiFetch(`/provider/patients/${patientId}`, { method: 'DELETE' });
  },
};
