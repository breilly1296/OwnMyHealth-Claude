/**
 * Document Processing Service
 *
 * Processes lab result documents using:
 * - Claude API for PDFs (intelligent extraction)
 * - Google Document AI for images (OCR fallback)
 *
 * Features:
 * - Supports PDF and image files (PNG, JPG, TIFF)
 * - Uses Claude for accurate biomarker extraction from PDFs
 * - Falls back to Document AI OCR for scanned images
 * - Includes confidence scoring
 *
 * @module services/ocrService
 */

import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { logger } from '../utils/logger.js';
import { InternalServerError, BadRequestError } from '../middleware/errorHandler.js';
import {
  type ExtractedBiomarker,
  ALL_BIOMARKERS,
} from './biomarkerPatterns.js';
import {
  extractBiomarkersFromText,
  validateBiomarkerValue,
} from './biomarkerExtractor.js';
import {
  extractBiomarkersWithClaude,
  isClaudeExtractionConfigured,
  type ClaudeExtractedBiomarker,
} from './claudeExtraction.js';

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
    labDate?: string;
    labName?: string;
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
    if (!process.env.GCP_PROJECT_ID) {
      throw new InternalServerError('GCP_PROJECT_ID environment variable is not set');
    }
    if (!process.env.GCP_PROCESSOR_ID) {
      throw new InternalServerError('GCP_PROCESSOR_ID environment variable is not set');
    }

    const credentialsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

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
 * Validate file before processing
 */
function validateFile(
  buffer: Buffer,
  mimeType: string,
  _filename: string
): { valid: boolean; error?: string } {
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  if (buffer.length === 0) {
    return { valid: false, error: 'File is empty' };
  }

  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `File type ${mimeType} is not supported. Supported types: PDF, PNG, JPG, TIFF`,
    };
  }

  return { valid: true };
}

/**
 * Convert Claude extracted biomarker to our ExtractedBiomarker format
 */
function convertClaudeBiomarker(claudeBiomarker: ClaudeExtractedBiomarker): ExtractedBiomarker {
  // Try to find matching biomarker pattern for category and normal range
  const normalizedName = claudeBiomarker.name.toLowerCase();
  let category = 'Other';
  let normalRange = { min: 0, max: 999, source: 'lab report' };

  // Find matching biomarker pattern
  for (const pattern of ALL_BIOMARKERS) {
    const patternName = pattern.name.toLowerCase();
    const aliasMatch = pattern.aliases.some((alias) =>
      normalizedName.includes(alias.toLowerCase())
    );

    if (normalizedName.includes(patternName) || patternName.includes(normalizedName) || aliasMatch) {
      category = pattern.category;
      normalRange = {
        min: pattern.normalRange.min,
        max: pattern.normalRange.max,
        source: 'standard',
      };
      break;
    }
  }

  // Parse reference range from lab report if available
  if (claudeBiomarker.referenceRange) {
    const rangeMatch = claudeBiomarker.referenceRange.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
    if (rangeMatch) {
      normalRange = {
        min: parseFloat(rangeMatch[1]),
        max: parseFloat(rangeMatch[2]),
        source: 'lab report',
      };
    }
  }

  return {
    name: claudeBiomarker.name,
    value: claudeBiomarker.value,
    unit: claudeBiomarker.unit || '',
    category,
    normalRange,
    confidence: 0.98, // High confidence for Claude extraction
    rawMatch: `${claudeBiomarker.name}: ${claudeBiomarker.value} ${claudeBiomarker.unit || ''}`,
  };
}

/**
 * Process a PDF document using Claude API
 */
async function processPDFWithClaude(
  buffer: Buffer,
  mimeType: string,
  startTime: number
): Promise<OCRResult> {
  ocrLogger.info('Processing PDF with Claude API', {
    bufferSize: buffer.length,
  });

  const claudeResult = await extractBiomarkersWithClaude(buffer);

  // Convert Claude biomarkers to our format
  const biomarkers: ExtractedBiomarker[] = claudeResult.biomarkers.map(convertClaudeBiomarker);

  // Validate extracted biomarkers
  const validatedBiomarkers = biomarkers.filter((b) => {
    const validationResult = validateBiomarkerValue(b.name, b.value, b.unit);
    if (!validationResult.valid) {
      ocrLogger.warn('Invalid biomarker value discarded', {
        biomarkerName: b.name,
        value: b.value,
        validationReason: validationResult.reason,
      });
    }
    return validationResult.valid;
  });

  const processingTimeMs = Date.now() - startTime;

  ocrLogger.info('Claude PDF extraction complete', {
    biomarkersFound: validatedBiomarkers.length,
    labDate: claudeResult.labDate,
    labName: claudeResult.labName,
    processingTimeMs,
  });

  // Generate a summary text for storage
  const summaryText = validatedBiomarkers
    .map((b) => `${b.name}: ${b.value} ${b.unit}`)
    .join('\n');

  return {
    text: summaryText,
    biomarkers: validatedBiomarkers,
    confidence: 0.98,
    pageCount: 1, // Claude doesn't report page count
    metadata: {
      processorType: 'claude-api',
      processingTimeMs,
      documentType: mimeType,
      labDate: claudeResult.labDate,
      labName: claudeResult.labName,
    },
  };
}

/**
 * Process an image document using Document AI OCR
 */
async function processImageWithDocumentAI(
  buffer: Buffer,
  mimeType: string,
  startTime: number
): Promise<OCRResult> {
  ocrLogger.info('Processing image with Document AI OCR', {
    mimeType,
    sizeBytes: buffer.length,
  });

  const client = getDocumentAIClient();
  const processorName = getProcessorName();

  const request = {
    name: processorName,
    rawDocument: {
      content: buffer.toString('base64'),
      mimeType: mimeType,
    },
  };

  const [result] = await client.processDocument(request);
  const document = result.document;

  if (!document) {
    throw new InternalServerError('Document AI returned no document');
  }

  const extractedText = document.text || '';
  const pageCount = document.pages?.length || 1;

  ocrLogger.info('Document AI OCR complete', {
    textLength: extractedText.length,
    pageCount,
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

  // Extract biomarkers from OCR text using pattern matching
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

  ocrLogger.info('Document AI OCR extraction complete', {
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
      processorType: 'document-ai-ocr',
      processingTimeMs,
      documentType: mimeType,
    },
  };
}

/**
 * Process a document - uses Claude for PDFs, Document AI for images
 */
export async function processDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<OCRResult> {
  ocrLogger.info('processDocument called', {
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

  // For PDFs, use Claude API for intelligent extraction
  if (mimeType === 'application/pdf') {
    if (isClaudeExtractionConfigured()) {
      try {
        return await processPDFWithClaude(buffer, mimeType, startTime);
      } catch (error) {
        ocrLogger.error('Claude extraction failed, no fallback for PDFs', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    } else {
      ocrLogger.error('ANTHROPIC_API_KEY not configured');
      throw new InternalServerError(
        'PDF extraction service not configured. Please set ANTHROPIC_API_KEY.'
      );
    }
  }

  // For images, use Document AI OCR
  try {
    return await processImageWithDocumentAI(buffer, mimeType, startTime);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

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
  claudeConfigured: boolean;
  documentAIConfigured: boolean;
  error?: string;
}> {
  const claudeConfigured = isClaudeExtractionConfigured();

  let documentAIConfigured = false;
  let documentAIError: string | undefined;

  try {
    if (!process.env.GCP_PROJECT_ID) {
      documentAIError = 'GCP_PROJECT_ID not set';
    } else if (!process.env.GCP_PROCESSOR_ID) {
      documentAIError = 'GCP_PROCESSOR_ID not set';
    } else {
      const credentialsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (!credentialsEnv) {
        documentAIError = 'GOOGLE_APPLICATION_CREDENTIALS not set';
      } else if (credentialsEnv.trim().startsWith('{')) {
        try {
          JSON.parse(credentialsEnv);
          documentAIConfigured = true;
        } catch {
          documentAIError = 'GOOGLE_APPLICATION_CREDENTIALS contains invalid JSON';
        }
      } else {
        documentAIConfigured = true;
      }
    }
  } catch (error) {
    documentAIError = error instanceof Error ? error.message : 'Unknown error';
  }

  return {
    configured: claudeConfigured || documentAIConfigured,
    claudeConfigured,
    documentAIConfigured,
    error: !claudeConfigured && !documentAIConfigured ? documentAIError : undefined,
  };
}

/**
 * Extract date from OCR text
 */
export function extractDateFromText(text: string): string | null {
  const datePatterns = [
    /(?:collection|specimen|collected|drawn|test)\s*date[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /(?:report|reported|result)\s*date[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /(\d{4}[/-]\d{1,2}[/-]\d{1,2})/,
    /(\d{1,2}[/-]\d{1,2}[/-]\d{4})/,
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
