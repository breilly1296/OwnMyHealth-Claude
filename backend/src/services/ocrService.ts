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
  // DEBUG: Confirm function is being called
  console.log('[OCR DEBUG] processDocument called', {
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

    // DEBUG: Log processor info
    console.log('[OCR DEBUG] Processor used:', {
      processorName: processorName,
      projectId: process.env.GCP_PROJECT_ID,
      processorId: process.env.GCP_PROCESSOR_ID,
      location: process.env.GCP_LOCATION || 'us',
    });

    // DEBUG: Log FULL extracted text (values might be missing!)
    console.log('[OCR DEBUG] ========== FULL OCR TEXT START ==========');
    console.log(extractedText);
    console.log('[OCR DEBUG] ========== FULL OCR TEXT END ==========');

    // DEBUG: Log text stats
    console.log('[OCR DEBUG] Text stats:', {
      textLength: extractedText.length,
      pageCount,
      lineCount: extractedText.split('\n').length,
      hasNumbers: /\d{2,}/.test(extractedText),
      sample193: extractedText.includes('193'),
      sample242: extractedText.includes('242'),
    });

    // DEBUG: Log first 50 lines to see exact OCR output format
    const lines = extractedText.split('\n');
    console.log('[OCR DEBUG] First 50 lines of OCR text:');
    lines.slice(0, 50).forEach((line, i) => {
      console.log(`[OCR LINE ${i + 1}] "${line}"`);
    });

    // DEBUG: Check for table data from Document AI
    console.log('[OCR DEBUG] Checking for structured data...');
    if (document.pages) {
      for (let pageIdx = 0; pageIdx < document.pages.length; pageIdx++) {
        const page = document.pages[pageIdx];

        // Log page structure
        console.log(`[OCR DEBUG] Page ${pageIdx + 1}:`, {
          hasTables: !!(page.tables && page.tables.length > 0),
          tableCount: page.tables?.length || 0,
          hasFormFields: !!(page.formFields && page.formFields.length > 0),
          formFieldCount: page.formFields?.length || 0,
          hasBlocks: !!(page.blocks && page.blocks.length > 0),
          blockCount: page.blocks?.length || 0,
          hasTokens: !!(page.tokens && page.tokens.length > 0),
          tokenCount: page.tokens?.length || 0,
        });

        // Log form fields if present (key-value pairs)
        if (page.formFields && page.formFields.length > 0) {
          console.log(`[OCR DEBUG] Page ${pageIdx + 1} has ${page.formFields.length} form fields`);
          page.formFields.slice(0, 10).forEach((field, fieldIdx) => {
            const fieldName = field.fieldName?.textAnchor?.textSegments
              ?.map(seg => extractedText.substring(
                parseInt(seg.startIndex?.toString() || '0'),
                parseInt(seg.endIndex?.toString() || '0')
              ))
              .join('')
              .trim() || '';
            const fieldValue = field.fieldValue?.textAnchor?.textSegments
              ?.map(seg => extractedText.substring(
                parseInt(seg.startIndex?.toString() || '0'),
                parseInt(seg.endIndex?.toString() || '0')
              ))
              .join('')
              .trim() || '';
            console.log(`[OCR FORM FIELD ${fieldIdx}] "${fieldName}" = "${fieldValue}"`);
          });
        }

        // Log tables if present
        if (page.tables && page.tables.length > 0) {
          console.log(`[OCR DEBUG] Page ${pageIdx + 1} has ${page.tables.length} tables`);
          page.tables.forEach((table, tableIdx) => {
            console.log(`[OCR TABLE ${tableIdx + 1}] Rows: ${table.headerRows?.length || 0} header, ${table.bodyRows?.length || 0} body`);
            // Log table structure for debugging
            table.bodyRows?.slice(0, 10).forEach((row, rowIdx) => {
              const cells = row.cells?.map(cell => {
                const text = cell.layout?.textAnchor?.textSegments
                  ?.map(seg => extractedText.substring(
                    parseInt(seg.startIndex?.toString() || '0'),
                    parseInt(seg.endIndex?.toString() || '0')
                  ))
                  .join('')
                  .trim() || '';
                return text;
              }) || [];
              console.log(`[OCR TABLE ROW ${rowIdx}] ${JSON.stringify(cells)}`);
            });
          });
        }
      }
    }

    // DEBUG: Check for entities (extracted key-value data)
    if (document.entities && document.entities.length > 0) {
      console.log(`[OCR DEBUG] Document has ${document.entities.length} entities`);
      document.entities.slice(0, 20).forEach((entity, idx) => {
        console.log(`[OCR ENTITY ${idx}] Type: ${entity.type}, Value: "${entity.mentionText}", Confidence: ${entity.confidence}`);
      });
    } else {
      console.log('[OCR DEBUG] No entities detected - may need Form Parser processor');
    }

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

    // DEBUG: Log biomarker extraction results
    console.log('[OCR DEBUG] Biomarker extraction summary', {
      biomarkersFoundBeforeValidation: biomarkers.length,
    });

    // DEBUG: Log each found biomarker individually
    biomarkers.forEach((b, i) => {
      console.log(`[OCR BIOMARKER ${i + 1}] ${b.name}: ${b.value} ${b.unit} (confidence: ${b.confidence.toFixed(2)}, raw: "${b.rawMatch.substring(0, 60)}")`);
    });

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
