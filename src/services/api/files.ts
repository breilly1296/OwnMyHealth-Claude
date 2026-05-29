/**
 * User Files API
 */

import { apiFetch, API_BASE_URL } from './client';

export interface UserFileData {
  id: string;
  filename: string;
  originalFilename: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  labName: string | null;
  labDate: string | null;
  biomarkersExtracted: number;
  extractionConfidence: number | null;
  categories: string[];
  createdAt: string;
}

export const filesApi = {
  async getAll(): Promise<UserFileData[]> {
    const response = await apiFetch<UserFileData[]>('/files');
    return response.data;
  },

  /**
   * Download a file's bytes through the authenticated API.
   *
   * Previously this returned a GCS signed URL; the backend now streams the
   * file itself under session auth + audit logging, so the client downloads
   * it via fetch and materializes a blob URL for rendering / saving. Blob
   * URL is revoked by the caller after use to release memory.
   */
  async downloadFile(id: string): Promise<{ blobUrl: string; contentType: string }> {
    const response = await fetch(`${API_BASE_URL}/files/${id}/download`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const msg = response.status === 404 ? 'File not found' : 'Failed to download file';
      throw new Error(msg);
    }
    const blob = await response.blob();
    return {
      blobUrl: URL.createObjectURL(blob),
      contentType: response.headers.get('Content-Type') || blob.type || 'application/octet-stream',
    };
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/files/${id}`, { method: 'DELETE' });
  },
};
