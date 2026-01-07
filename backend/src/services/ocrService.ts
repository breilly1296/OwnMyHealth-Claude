/**
 * OCR Service using Google Document AI
 *
 * Processes lab result images/PDFs using Google Cloud Document AI
 * to extract text and biomarker values.
 *
 * Features:
 * - Supports PDF and image files (PNG, JPG, TIFF)
 * - Uses Document AI Form Parser or OCR processor
 * - Extracts biomarkers using pattern matching
 * - Includes confidence scoring
 */

import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { logger } from '../utils/logger.js';
import { InternalServerError, BadRequestError } from '../middleware/errorHandler.js';
import {
  extractBiomarkersFromText,
  validateBiomarkerValue,
  type ExtractedBiomarker,
} from './biomarkerPatterns.js';

// Create OCR-specific logger
const ocrLogger = logger.createServiceLogger('OCR');

// Supported file types
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/gif',
  'image/webp',
];

// Maximum file size (10 MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * OCR processing result
 */
export interface OCRResult {
  /** Extracted text from document */
  text: string;
  /** Extracted biomarkers */
  biomarkers: ExtractedBiomarker[];
  /** Overall confidence score (0-1) */
  confidence: number;
  /** Number of pages processed */
  pageCount: number;
  /** Processing metadata */
  metadata: {
    processorType: string;
    processingTimeMs: number;
    documentType?: string;
  };
}

/**
 * Document AI client singleton
 */
let documentAIClient: DocumentProcessorServiceClient | null = null;

/**
 * Get or create Document AI client
 */
function getDocumentAIClient(): DocumentProcessorServiceClient {
  if (!documentAIClient) {
    // Check for required configuration
    if (!process.env.GCP_PROJECT_ID) {
      throw new InternalServerError('GCP_PROJECT_ID environment variable is not set');
    }
    if (!process.env.GCP_PROCESSOR_ID) {
      throw new InternalServerError('GCP_PROCESSOR_ID environment variable is not set');
    }

    documentAIClient = new DocumentProcessorServiceClient();
  }
  return documentAIClient;
}

/**
 * Get Document AI processor name
 */
function getProcessorName(): string {
  const projectId = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us';
  const processorId = process.env.GCP_PROCESSOR_ID;

  return `projects/${projectId}/locations/${location}/processors/${processorId}`;
}

/**
 * Validate file before processing
 */
function validateFile(
  buffer: Buffer,
  mimeType: string,
  _filename: string
): { valid: boolean; error?: string } {
  // Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check file is not empty
  if (buffer.length === 0) {
    return { valid: false, error: 'File is empty' };
  }

  // Check mime type
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `File type ${mimeType} is not supported. Supported types: PDF, PNG, JPG, TIFF`,
    };
  }

  return { valid: true };
}

/**
 * Process a document using Google Document AI
 */
export async function processDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<OCRResult> {
  const startTime = Date.now();

  // Validate file
  const validation = validateFile(buffer, mimeType, filename);
  if (!validation.valid) {
    throw new BadRequestError(validation.error || 'Invalid file');
  }

  ocrLogger.info('Processing document with Document AI', {
    mimeType,
    sizeBytes: buffer.length,
  });

  try {
    const client = getDocumentAIClient();
    const processorName = getProcessorName();

    // Prepare the request
    const request = {
      name: processorName,
      rawDocument: {
        content: buffer.toString('base64'),
        mimeType: mimeType,
      },
    };

    // Process the document
    const [result] = await client.processDocument(request);
    const document = result.document;

    if (!document) {
      throw new InternalServerError('Document AI returned no document');
    }

    // Extract text from all pages
    const extractedText = document.text || '';
    const pageCount = document.pages?.length || 1;

    // Calculate overall text confidence
    let totalConfidence = 0;
    let confidenceCount = 0;

    if (document.pages) {
      for (const page of document.pages) {
        if (page.blocks) {
          for (const block of page.blocks) {
            if (block.layout?.confidence) {
              totalConfidence += block.layout.confidence;
              confidenceCount++;
            }
          }
        }
      }
    }

    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0.5;

    // Extract biomarkers from text
    const biomarkers = extractBiomarkersFromText(extractedText);

    // Validate extracted biomarkers
    const validatedBiomarkers = biomarkers.filter((b) => {
      const validationResult = validateBiomarkerValue(b.name, b.value, b.unit);
      if (!validationResult.valid) {
        ocrLogger.warn('Invalid biomarker value discarded', {
          biomarkerName: b.name,
          validationReason: validationResult.reason,
        });
      }
      return validationResult.valid;
    });

    const processingTimeMs = Date.now() - startTime;

    ocrLogger.info('Document AI processing complete', {
      pageCount,
      textLength: extractedText.length,
      biomarkersFound: validatedBiomarkers.length,
      confidence: avgConfidence.toFixed(2),
      processingTimeMs,
    });

    return {
      text: extractedText,
      biomarkers: validatedBiomarkers,
      confidence: avgConfidence,
      pageCount,
      metadata: {
        processorType: 'document-ai',
        processingTimeMs,
        documentType: mimeType,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle specific Google Cloud errors
    if (errorMessage.includes('PERMISSION_DENIED')) {
      ocrLogger.error('Document AI permission denied', { errorMessage });
      throw new InternalServerError(
        'OCR service not properly configured. Please check GCP credentials.'
      );
    }

    if (errorMessage.includes('NOT_FOUND')) {
      ocrLogger.error('Document AI processor not found', { errorMessage });
      throw new InternalServerError(
        'OCR processor not found. Please check GCP_PROCESSOR_ID configuration.'
      );
    }

    if (errorMessage.includes('INVALID_ARGUMENT')) {
      ocrLogger.error('Document AI invalid argument', { errorMessage });
      throw new BadRequestError(
        'Document could not be processed. Please ensure the file is a valid lab report.'
      );
    }

    ocrLogger.error('Document AI processing failed', { errorMessage });

    throw new InternalServerError('Failed to process document. Please try again later.');
  }
}

/**
 * Check if OCR service is properly configured
 */
export async function checkOCRConfiguration(): Promise<{
  configured: boolean;
  error?: string;
}> {
  try {
    // Check required environment variables
    if (!process.env.GCP_PROJECT_ID) {
      return { configured: false, error: 'GCP_PROJECT_ID not set' };
    }
    if (!process.env.GCP_PROCESSOR_ID) {
      return { configured: false, error: 'GCP_PROCESSOR_ID not set' };
    }
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return { configured: false, error: 'GOOGLE_APPLICATION_CREDENTIALS not set' };
    }

    // Try to initialize client
    getDocumentAIClient();

    return { configured: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { configured: false, error: errorMessage };
  }
}

/**
 * Extract date from OCR text
 */
export function extractDateFromText(text: string): string | null {
  // Common date patterns in lab reports
  const datePatterns = [
    // Collection/Specimen date
    /(?:collection|specimen|collected|drawn|test)\s*date[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    // Report date
    /(?:report|reported|result)\s*date[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    // ISO format
    /(\d{4}[/-]\d{1,2}[/-]\d{1,2})/,
    // US format
    /(\d{1,2}[/-]\d{1,2}[/-]\d{4})/,
    // Written month format
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      try {
        const dateStr = match[1].trim();
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      } catch {
        // Continue to next pattern
      }
    }
  }

  return null;
}

/**
 * Extract lab name from OCR text
 */
export function extractLabNameFromText(text: string): string | null {
  const labPatterns = [
    /(?:laboratory|laboratories|lab)[:\s]*([A-Za-z\s]+(?:Medical|Health|Clinical|Diagnostic|Lab|Laboratory)?)/i,
    /(Quest\s*Diagnostics|LabCorp|BioReference|ARUP|Mayo\s*(?:Clinic)?)/i,
    /(?:performed\s*(?:at|by)|testing\s*facility)[:\s]*([^\n,]{3,50})/i,
  ];

  for (const pattern of labPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const labName = match[1].trim();
      if (labName.length >= 3 && labName.length <= 100) {
        return labName;
      }
    }
  }

  return null;
}

export default {
  processDocument,
  checkOCRConfiguration,
  extractDateFromText,
  extractLabNameFromText,
};
