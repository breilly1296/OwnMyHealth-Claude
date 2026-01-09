/**
 * File Upload API
 */

import { BiomarkerData } from './biomarkers';

export const uploadApi = {
  async uploadLabReport(file: File): Promise<BiomarkerData[]> {
    const { uploadFile } = await import('../uploadUtils');
    return uploadFile<BiomarkerData[]>('/upload/lab-report', file, {
      timeoutMs: 60000,
      timeoutMessage: 'Lab report upload timed out. Please try again with a smaller file.',
    });
  },
};
