/**
 * Type-Safe Multer File Handling
 *
 * Provides proper TypeScript types for Express.Multer.File
 * and type guards for safe file access in controllers.
 */

import type { Request } from 'express';

/**
 * Multer file interface - matches Express.Multer.File
 */
export interface MulterFile {
  /** Field name specified in the form */
  fieldname: string;
  /** Name of the file on the user's computer */
  originalname: string;
  /** Encoding type of the file */
  encoding: string;
  /** Mime type of the file */
  mimetype: string;
  /** Size of the file in bytes */
  size: number;
  /** The folder to which the file has been saved (DiskStorage) */
  destination?: string;
  /** The name of the file within the destination (DiskStorage) */
  filename?: string;
  /** Location of the uploaded file (DiskStorage) */
  path?: string;
  /** A Buffer of the entire file (MemoryStorage) */
  buffer: Buffer;
  /** Stream of the file (required for File interface compatibility) */
  stream?: NodeJS.ReadableStream;
}

/**
 * Request with optional file upload
 * Uses intersection type instead of extends to avoid type conflicts
 */
export type RequestWithFile = Request & {
  file?: MulterFile;
};

/**
 * Request with required file upload
 */
export type RequestWithRequiredFile = Request & {
  file: MulterFile;
};

/**
 * Request with multiple file uploads
 */
export type RequestWithFiles = Request & {
  files?: MulterFile[] | { [fieldname: string]: MulterFile[] };
};

/**
 * Type guard to check if request has a file attached
 */
export function hasFile(req: Request): req is Request & { file: MulterFile } {
  const fileReq = req as Request & { file?: unknown };
  return (
    fileReq !== null &&
    typeof fileReq === 'object' &&
    'file' in fileReq &&
    fileReq.file !== null &&
    typeof fileReq.file === 'object' &&
    'buffer' in (fileReq.file as object) &&
    Buffer.isBuffer((fileReq.file as MulterFile).buffer)
  );
}

/**
 * Type guard to check if request has multiple files attached
 */
export function hasFiles(req: Request): req is Request & { files: MulterFile[] | { [fieldname: string]: MulterFile[] } } {
  const filesReq = req as Request & { files?: unknown };
  return (
    filesReq !== null &&
    typeof filesReq === 'object' &&
    'files' in filesReq &&
    filesReq.files !== null &&
    typeof filesReq.files === 'object'
  );
}

/**
 * Get file from request with type safety
 * Returns undefined if no file is present
 */
export function getFile(req: Request): MulterFile | undefined {
  if (hasFile(req)) {
    return req.file;
  }
  return undefined;
}

/**
 * Get file from request or throw error
 * Use when file is required
 */
export function requireFile(req: Request, errorMessage = 'No file uploaded'): MulterFile {
  const file = getFile(req);
  if (!file) {
    throw new Error(errorMessage);
  }
  return file;
}

/**
 * Validate file type against allowed MIME types
 */
export function validateFileType(
  file: MulterFile,
  allowedMimeTypes: string[]
): boolean {
  return allowedMimeTypes.includes(file.mimetype);
}

/**
 * Validate file size against maximum size in bytes
 */
export function validateFileSize(
  file: MulterFile,
  maxSizeBytes: number
): boolean {
  return file.size <= maxSizeBytes;
}

/**
 * Common MIME types for file validation
 */
export const MIME_TYPES = {
  PDF: 'application/pdf',
  CSV: 'text/csv',
  TEXT_PLAIN: 'text/plain',
  JSON: 'application/json',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  GIF: 'image/gif',
} as const;

/**
 * File size constants
 */
export const FILE_SIZE = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
} as const;
