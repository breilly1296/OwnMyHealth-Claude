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
 *
 * @module services/ocrService
 */

import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import pdf from 'pdf-parse';
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

// Minimum text length to consider PDF has embedded text (not just headers/footers)
const MIN_EMBEDDED_TEXT_LENGTH = 100;

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
 *
 * Supports two modes for credentials:
 * 1. JSON content in GOOGLE_APPLICATION_CREDENTIALS (for Cloud Run secrets)
 * 2. File path in GOOGLE_APPLICATION_CREDENTIALS (for local development)
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

    const credentialsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    // Check if credentials look like JSON content (starts with {)
    if (credentialsEnv && credentialsEnv.trim().startsWith('{')) {
      try {
        const credentials = JSON.parse(credentialsEnv);
        ocrLogger.info('Initializing Document AI client with JSON credentials');
        documentAIClient = new DocumentProcessorServiceClient({ credentials });
      } catch (parseError) {
        ocrLogger.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON', {
          error: parseError instanceof Error ? parseError.message : 'Unknown error',
        });
        throw new InternalServerError('Invalid GCP credentials format');
      }
    } else {
      // Assume it's a file path (default Google behavior)
      ocrLogger.info('Initializing Document AI client with credentials file');
      documentAIClient = new DocumentProcessorServiceClient();
    }
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
 * Extract text directly from PDF using pdf-parse
 * This works for PDFs with embedded text (like Quest lab results)
 * Much faster and more accurate than OCR for these documents
 */
async function extractTextFromPDF(buffer: Buffer): Promise<{ text: string; pageCount: number } | null> {
  try {
    console.log('[PDF EXTRACT] Attempting direct text extraction from PDF...');
    const data = await pdf(buffer);

    console.log('[PDF EXTRACT] Direct extraction result:', {
      textLength: data.text.length,
      pageCount: data.numpages,
      hasSubstantialText: data.text.length > MIN_EMBEDDED_TEXT_LENGTH,
    });

    // Check if PDF has substantial embedded text
    if (data.text && data.text.length > MIN_EMBEDDED_TEXT_LENGTH) {
      console.log('[PDF EXTRACT] ========== EXTRACTED TEXT START ==========');
      console.log(data.text);
      console.log('[PDF EXTRACT] ========== EXTRACTED TEXT END ==========');

      return {
        text: data.text,
        pageCount: data.numpages,
      };
    }

    console.log('[PDF EXTRACT] PDF has minimal embedded text, will use OCR fallback');
    return null;
  } catch (error) {
    console.log('[PDF EXTRACT] Direct extraction failed, will use OCR fallback:', error);
    return null;
  }
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
 * Process a document - tries direct PDF text extraction first,
 * falls back to Document AI OCR for scanned images
 */
export async function processDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<OCRResult> {
  console.log('[DOCUMENT] processDocument called', {
    filename,
    mimeType,
    bufferSize: buffer.length,
  });

  const startTime = Date.now();

  // Validate file
  const validation = validateFile(buffer, mimeType, filename);
  if (!validation.valid) {
    throw new BadRequestError(validation.error || 'Invalid file');
  }

  // For PDFs, try direct text extraction first (much faster and more accurate)
  if (mimeType === 'application/pdf') {
    const pdfResult = await extractTextFromPDF(buffer);

    if (pdfResult && pdfResult.text.length > MIN_EMBEDDED_TEXT_LENGTH) {
      console.log('[DOCUMENT] Using direct PDF text extraction (embedded text found)');

      // Extract biomarkers from the directly extracted text
      const biomarkers = extractBiomarkersFromText(pdfResult.text);

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

      ocrLogger.info('Direct PDF extraction complete', {
        pageCount: pdfResult.pageCount,
        textLength: pdfResult.text.length,
        biomarkersFound: validatedBiomarkers.length,
        processingTimeMs,
      });

      return {
        text: pdfResult.text,
        biomarkers: validatedBiomarkers,
        confidence: 0.95, // High confidence for direct text extraction
        pageCount: pdfResult.pageCount,
        metadata: {
          processorType: 'pdf-parse-direct',
          processingTimeMs,
          documentType: mimeType,
        },
      };
    }

    console.log('[DOCUMENT] PDF has no embedded text, falling back to Document AI OCR');
  }

  // Fall back to Document AI OCR for images or PDFs without embedded text
  ocrLogger.info('Processing document with Document AI OCR (fallback)', {
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

    // Log OCR results (this is the fallback path for scanned images)
    console.log('[OCR FALLBACK] Document AI OCR used for image/scanned PDF');
    console.log('[OCR FALLBACK] Text extracted:', {
      textLength: extractedText.length,
      pageCount,
      lineCount: extractedText.split('\n').length,
    });

    // Log first 20 lines for debugging
    const lines = extractedText.split('\n');
    console.log('[OCR FALLBACK] First 20 lines:');
    lines.slice(0, 20).forEach((line, i) => {
      console.log(`  ${i + 1}: "${line}"`);
    });

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

    // Extract biomarkers from OCR text
    const biomarkers = extractBiomarkersFromText(extractedText);
    console.log(`[OCR FALLBACK] Extracted ${biomarkers.length} biomarkers from OCR text`);

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

    ocrLogger.info('Document AI OCR fallback complete', {
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
        processorType: 'document-ai-ocr-fallback',
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

    // Check for credentials (either JSON content or file path)
    const credentialsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsEnv) {
      return { configured: false, error: 'GOOGLE_APPLICATION_CREDENTIALS not set' };
    }

    // Validate JSON credentials if provided as JSON
    if (credentialsEnv.trim().startsWith('{')) {
      try {
        JSON.parse(credentialsEnv);
      } catch {
        return { configured: false, error: 'GOOGLE_APPLICATION_CREDENTIALS contains invalid JSON' };
      }
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
