/**
 * Secure PDF Parsing Utility
 *
 * Provides protection against PDF bomb denial-of-service attacks by:
 * - Validating PDF header bytes before parsing
 * - Wrapping parsing operations in timeouts
 * - Monitoring memory usage during parsing
 * - Proper cleanup on parsing failures
 * - Comprehensive logging for security monitoring
 *
 * Security finding: ZeroPath scan - "Denial-of-Service via PDF Bombs"
 */

import { pdfLogger } from './logger.js';
import { BadRequestError, InternalServerError } from '../middleware/errorHandler.js';

// PDF parsing timeout in milliseconds (30 seconds)
const PDF_PARSE_TIMEOUT_MS = 30_000;

// Maximum allowed memory increase during parsing (100MB)
const MAX_MEMORY_INCREASE_BYTES = 100 * 1024 * 1024;

// PDF magic bytes - all valid PDFs start with "%PDF-"
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF-

/**
 * PDF Parse Result interface (from pdf-parse library)
 */
export interface PDFParseResult {
  numpages: number;
  numrender: number;
  info: {
    PDFFormatVersion?: string;
    IsAcroFormPresent?: boolean;
    IsXFAPresent?: boolean;
    Title?: string;
    Author?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  };
  metadata: unknown;
  text: string;
  version: string;
}

type PDFParser = (buffer: Buffer) => Promise<PDFParseResult>;

/**
 * Validate PDF header bytes
 * All valid PDFs must start with "%PDF-" (hex: 25 50 44 46 2D)
 *
 * @throws BadRequestError if header is invalid
 */
export function validatePdfHeader(buffer: Buffer, filename: string): void {
  if (!buffer || buffer.length < 8) {
    pdfLogger.warn('PDF validation failed: buffer too small', {
      filename,
      bufferSize: buffer?.length ?? 0,
    });
    throw new BadRequestError('Invalid PDF file: file is too small to be a valid PDF');
  }

  // Check magic bytes
  const headerBytes = buffer.subarray(0, 5);
  if (!headerBytes.equals(PDF_MAGIC_BYTES)) {
    const headerHex = headerBytes.toString('hex');
    pdfLogger.warn('PDF validation failed: invalid header bytes', {
      filename,
      headerHex,
      expected: PDF_MAGIC_BYTES.toString('hex'),
    });
    throw new BadRequestError('Invalid PDF file: file does not have valid PDF header');
  }

  // Check PDF version format (should be like %PDF-1.4, %PDF-1.7, %PDF-2.0)
  const versionHeader = buffer.subarray(0, 8).toString('ascii');
  const versionMatch = versionHeader.match(/^%PDF-(\d+)\.(\d+)/);
  if (!versionMatch) {
    pdfLogger.warn('PDF validation failed: invalid version format', {
      filename,
      versionHeader: versionHeader.replace(/[^\x20-\x7E]/g, '?'),
    });
    throw new BadRequestError('Invalid PDF file: unrecognized PDF version format');
  }

  const majorVersion = parseInt(versionMatch[1], 10);
  const minorVersion = parseInt(versionMatch[2], 10);

  // Validate reasonable version numbers (PDF 1.0 through 2.x)
  if (majorVersion < 1 || majorVersion > 2 || minorVersion < 0 || minorVersion > 9) {
    pdfLogger.warn('PDF validation failed: unsupported version', {
      filename,
      version: `${majorVersion}.${minorVersion}`,
    });
    throw new BadRequestError(`Invalid PDF file: unsupported PDF version ${majorVersion}.${minorVersion}`);
  }

  pdfLogger.debug('PDF header validation passed', {
    filename,
    version: `${majorVersion}.${minorVersion}`,
    fileSize: buffer.length,
  });
}

/**
 * Create a timeout wrapper for async operations
 * Rejects with TimeoutError if operation exceeds timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Get current memory usage in bytes
 */
function getMemoryUsage(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed;
}

/**
 * Securely parse a PDF buffer with timeout and resource monitoring
 *
 * @param buffer - PDF file buffer
 * @param filename - Original filename (for logging)
 * @param pdfParser - The pdf-parse function
 * @returns Parsed PDF result
 * @throws BadRequestError for invalid/malicious PDFs
 * @throws InternalServerError for parsing infrastructure failures
 */
export async function secureParsePdf(
  buffer: Buffer,
  filename: string,
  pdfParser: PDFParser
): Promise<PDFParseResult> {
  const startTime = Date.now();
  const initialMemory = getMemoryUsage();

  // Step 1: Validate PDF header before parsing
  validatePdfHeader(buffer, filename);

  // Step 2: Parse with timeout protection
  let result: PDFParseResult;
  try {
    pdfLogger.info('Starting secure PDF parse', {
      filename,
      fileSize: buffer.length,
      initialMemoryMB: Math.round(initialMemory / 1024 / 1024),
    });

    result = await withTimeout(
      pdfParser(buffer),
      PDF_PARSE_TIMEOUT_MS,
      'PDF parsing'
    );

    const parseTime = Date.now() - startTime;
    const finalMemory = getMemoryUsage();
    const memoryIncrease = finalMemory - initialMemory;

    // Step 3: Check for excessive memory usage (potential decompression bomb)
    if (memoryIncrease > MAX_MEMORY_INCREASE_BYTES) {
      pdfLogger.error('PDF parsing exceeded memory limits', {
        filename,
        memoryIncreaseMB: Math.round(memoryIncrease / 1024 / 1024),
        maxAllowedMB: Math.round(MAX_MEMORY_INCREASE_BYTES / 1024 / 1024),
        parseTimeMs: parseTime,
      });
      throw new BadRequestError(
        'PDF file caused excessive memory usage during parsing. The file may be malformed or malicious.'
      );
    }

    // Step 4: Validate parsed output
    if (!result || typeof result.text !== 'string') {
      pdfLogger.error('PDF parsing returned invalid result', {
        filename,
        hasResult: !!result,
        hasText: result ? typeof result.text : 'N/A',
      });
      throw new BadRequestError('PDF parsing failed: unable to extract text content');
    }

    // Step 5: Check for suspiciously large text output (possible text bomb)
    // Text should not be more than 100x the file size (reasonable compression ratio)
    const textSize = Buffer.byteLength(result.text, 'utf8');
    const compressionRatio = textSize / buffer.length;
    if (compressionRatio > 100) {
      pdfLogger.warn('PDF has suspicious compression ratio', {
        filename,
        fileSize: buffer.length,
        textSize,
        compressionRatio: compressionRatio.toFixed(2),
      });
      // Don't reject but log for monitoring - some legitimate PDFs may have high ratios
    }

    pdfLogger.info('PDF parse completed successfully', {
      filename,
      parseTimeMs: parseTime,
      pages: result.numpages,
      textLength: result.text.length,
      memoryIncreaseMB: Math.round(memoryIncrease / 1024 / 1024),
    });

    return result;
  } catch (error) {
    const parseTime = Date.now() - startTime;
    const finalMemory = getMemoryUsage();
    const memoryIncrease = finalMemory - initialMemory;

    // Categorize and log the error
    if (error instanceof BadRequestError) {
      // Already a BadRequestError, re-throw
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for timeout
    if (errorMessage.includes('timed out')) {
      pdfLogger.error('PDF parsing timed out - potential DoS attack', {
        filename,
        fileSize: buffer.length,
        timeoutMs: PDF_PARSE_TIMEOUT_MS,
        memoryIncreaseMB: Math.round(memoryIncrease / 1024 / 1024),
      });
      throw new BadRequestError(
        'PDF parsing timed out. The file may be too complex, corrupted, or malicious.'
      );
    }

    // Check for common pdf-parse errors
    if (errorMessage.includes('Invalid PDF') ||
        errorMessage.includes('encrypted') ||
        errorMessage.includes('password')) {
      pdfLogger.warn('PDF parsing failed - invalid or protected file', {
        filename,
        error: errorMessage,
        parseTimeMs: parseTime,
      });
      throw new BadRequestError(
        'Unable to parse PDF file. The file may be corrupted, password-protected, or in an unsupported format.'
      );
    }

    // Log unexpected errors for investigation
    pdfLogger.error('PDF parsing failed with unexpected error', {
      filename,
      error: errorMessage,
      parseTimeMs: parseTime,
      memoryIncreaseMB: Math.round(memoryIncrease / 1024 / 1024),
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined,
    });

    throw new InternalServerError('PDF parsing failed due to an internal error. Please try again.');
  }
}

export default {
  validatePdfHeader,
  secureParsePdf,
  PDF_PARSE_TIMEOUT_MS,
  MAX_MEMORY_INCREASE_BYTES,
};
