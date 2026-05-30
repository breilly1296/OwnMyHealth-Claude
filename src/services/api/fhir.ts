/**
 * FHIR / Lab Connection API
 *
 * Wraps the SMART-on-FHIR lab-sync endpoints (backend: fhirRoutes.ts).
 * Used by the Lab Connections section in Account Settings.
 */

import { apiFetch } from './client';

/** Mirror of the backend ConnectionSummary (fhirController.ts). */
export interface LabConnectionSummary {
  id: string;
  /** Provider key, e.g. 'quest'. */
  provider: string;
  connectedAt: string;
  lastSyncAt: string | null;
  /** 'idle' | 'syncing' | 'error' */
  syncStatus: string;
  syncError: string | null;
  lastImportedCount: number;
  isActive: boolean;
}

/** Mirror of the backend SyncResult (labSyncService.ts). */
export interface LabSyncResult {
  imported: number;
  skipped: number;
  unmappedCodes: string[];
  errors: string[];
}

export const fhirApi = {
  /** List the user's lab connections (empty array if none). */
  async listConnections(): Promise<LabConnectionSummary[]> {
    const res = await apiFetch<LabConnectionSummary[]>('/fhir/connections');
    return res.data;
  },

  /**
   * Start the Quest OAuth connect flow. Returns the provider authorization
   * URL the caller should send the browser to (full-page navigation).
   * Throws an ApiError with status 503 if the integration is not configured
   * on the server.
   */
  async connectQuest(): Promise<{ redirectUrl: string }> {
    const res = await apiFetch<{ redirectUrl: string }>('/fhir/connect/quest');
    return res.data;
  },

  /** Trigger an on-demand sync for a connection. */
  async syncConnection(connectionId: string): Promise<LabSyncResult> {
    const res = await apiFetch<LabSyncResult>(`/fhir/sync/${connectionId}`, {
      method: 'POST',
    });
    return res.data;
  },

  /** Revoke tokens and remove a connection. */
  async disconnect(id: string): Promise<void> {
    await apiFetch(`/fhir/connections/${id}`, { method: 'DELETE' });
  },
};
