/**
 * User Files API
 */

import { apiFetch } from './client';

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
  downloadUrl?: string;
}

export const filesApi = {
  async getAll(): Promise<UserFileData[]> {
    const response = await apiFetch<UserFileData[]>('/files');
    return response.data;
  },

  async getById(id: string): Promise<UserFileData> {
    const response = await apiFetch<UserFileData>(`/files/${id}`);
    return response.data;
  },

  async getDownloadUrl(id: string): Promise<{ url: string; expiresIn: number }> {
    const response = await apiFetch<{ url: string; expiresIn: number }>(`/files/${id}/download`);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/files/${id}`, { method: 'DELETE' });
  },
};
