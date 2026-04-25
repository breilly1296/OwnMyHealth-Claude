/**
 * Claude API Biomarker Extraction Service
 *
 * Uses Claude's document understanding to extract biomarkers from lab reports.
 * This is more accurate than regex-based extraction as Claude understands
 * the document context and can correctly identify values.
 *
 * @module services/claudeExtraction
 */

import { logger } from '../utils/logger.js';
import { InternalServerError, ValidationError } from '../middleware/errorHandler.js';
import { redactPHI, stripPHIFromText } from '../utils/phiRedaction.js';
import { trackAIUsage } from './aiCostTracker.js';
import { extractTextFromPDF } from './pdfTextExtraction.js';
import { getAnthropicClient } from './anthropicClient.js';
import { config } from '../config/index.js';

// Create extraction-specific logger
const extractionLogger = logger.createServiceLogger('ClaudeExtraction');

/**
 * Extracted biomarker from Claude
 */
export interface ClaudeExtractedBiomarker {
  name: string;
  value: number;
  unit: string;
  referenceRange?: string;
  isAbnormal?: boolean;
}

/**
 * Full extraction result from Claude
 */
export interface ClaudeExtractionResult {
  biomarkers: ClaudeExtractedBiomarker[];
  labDate?: string;
  labName?: string;
}

/**
 * The extraction prompt for Claude
 */
const EXTRACTION_PROMPT = `Extract all biomarker/lab values from this lab report.

Return ONLY valid JSON in this exact format (no markdown, no code blocks, just raw JSON):
{
  "biomarkers": [
    {
      "name": "Cholesterol, Total",
      "value": 193,
      "unit": "mg/dL",
      "referenceRange": "<200",
      "isAbnormal": false
    }
  ],
  "labDate": "2022-01-21",
  "labName": "Quest Diagnostics"
}

IMPORTANT INSTRUCTIONS:
1. Extract ALL biomarkers from the report - lipids, CBC, metabolic panel, thyroid, vitamins, etc.
2. Use the EXACT biomarker names as shown in the report
3. The "value" field must be a NUMBER only (not a string). Convert any numeric values.
4. For values like ">60" or "<0.1", use the number itself (60 or 0.1)
5. Include the unit exactly as shown in the report
6. Set isAbnormal to true if the value is flagged as High (H) or Low (L)
7. Include referenceRange if available
8. Extract the lab/collection date in ISO format (YYYY-MM-DD)
9. Extract the lab name (e.g., "Quest Diagnostics", "LabCorp")
10. All patient identifiers have been redacted from the input. Do NOT attempt
    to infer, reconstruct, or include any patient name, DOB, MRN, address,
    phone, or email in your response. If you see [*_REDACTED] tokens, preserve
    them verbatim if quoted back — never guess at the original value.

Return ONLY the JSON object, no other text.`;

/**
 * Extract biomarkers from a PDF using Claude API.
 *
 * Flow (C-7 minimum-necessary): extract text locally via pdf-parse → run
 * PHI redaction on the text → send text-only prompt to Claude. The raw PDF
 * bytes never leave the process. Scanned/image-only PDFs (where local text
 * extraction does not meet usability thresholds) are rejected with a
 * ValidationError — callers should route those uploads through the OCR
 * path instead. There is deliberately no PDF vision fallback.
 *
 * @param pdfBuffer - The PDF file as a buffer
 * @param userId    - The uploading user's ID, attributed to AI-cost tracking
 * @returns Extraction result with biomarkers and metadata
 */
export async function extractBiomarkersWithClaude(
  pdfBuffer: Buffer,
  userId: string
): Promise<ClaudeExtractionResult> {
  const startTime = Date.now();

  extractionLogger.info('Starting Claude extraction', {
    bufferSize: pdfBuffer.length,
  });

  // C-7 runtime gate — refuse to send anything to Claude unless the BAA flag
  // is explicitly set. Defense in depth for the minimum-necessary rewrite
  // below, and a hard stop against a misconfigured deploy with a stale key.
  if (!config.anthropic.baaActive) {
    throw new InternalServerError(
      'Claude API calls with PHI require an active BAA. ' +
      'Set ANTHROPIC_BAA_ACTIVE=true after confirming BAA coverage. See SECURITY_STATUS.md C-7.'
    );
  }

  try {
    const client = getAnthropicClient();

    // Stage A — extract text locally. No network call, no PHI transmitted.
    const extracted = await extractTextFromPDF(pdfBuffer);

    // Scanned / image-only PDFs carry demographics in the page pixels that
    // our text redactor cannot reach. Rather than ship those bytes to
    // Claude vision, fail closed and let the caller route to the OCR
    // upload endpoint (Google Document AI, covered by its own BAA).
    if (!extracted.usable) {
      extractionLogger.warn('Local PDF text extraction insufficient — refusing to call Claude', {
        textLength: extracted.text.length,
        isLikelyScanned: extracted.isLikelyScanned,
      });
      throw new ValidationError(
        'PDF text extraction did not yield enough readable text (likely a scanned document). ' +
        'Please re-upload via the OCR lab-results endpoint.'
      );
    }

    // Stage B — redact PHI from the extracted text before it goes anywhere.
    const { text: redactedText, firedPatterns } = redactPHI(extracted.text);

    extractionLogger.info('PHI redaction applied to PDF text', {
      originalLength: extracted.text.length,
      redactedLength: redactedText.length,
      firedPatterns,
    });

    // Stage C — call Claude with the PHI-redacted text. No document block,
    // no base64 PDF — the text-only path is the only path.
    extractionLogger.info('Sending PHI-redacted text to Claude', {
      model: 'claude-haiku-4-5-20251001',
      redactedLength: redactedText.length,
    });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${EXTRACTION_PROMPT}\n\n--- LAB REPORT TEXT (PHI-redacted) ---\n${redactedText}`,
            },
          ],
        },
      ],
    });

    const processingTimeMs = Date.now() - startTime;

    trackAIUsage({
      endpoint: 'lab-extraction',
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      userId,
    });

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InternalServerError('Claude returned no text content');
    }

    // Strip any PHI that Claude may have included in its response
    const responseText = stripPHIFromText(textContent.text);
    extractionLogger.info('Received Claude response', {
      responseLength: responseText.length,
      processingTimeMs,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    // Parse JSON from response
    // Try to find JSON object in the response (handles potential markdown code blocks)
    let jsonText = responseText;

    // Remove markdown code blocks if present
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Find the JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      extractionLogger.error('No JSON found in Claude response', {
        responseLength: responseText.length,
      });
      throw new InternalServerError('Claude response did not contain valid JSON');
    }

    let result: ClaudeExtractionResult;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      extractionLogger.error('Failed to parse Claude JSON response', {
        parseError: parseError instanceof Error ? parseError.message : 'Unknown',
        jsonLength: jsonMatch[0].length,
      });
      throw new InternalServerError('Failed to parse biomarker data from Claude response');
    }

    // Validate and clean up the result
    if (!result.biomarkers || !Array.isArray(result.biomarkers)) {
      result.biomarkers = [];
    }

    // Filter out any invalid biomarkers
    result.biomarkers = result.biomarkers.filter((b) => {
      if (!b.name || typeof b.value !== 'number' || isNaN(b.value)) {
        extractionLogger.warn('Filtering invalid biomarker', { biomarker: b });
        return false;
      }
      return true;
    });

    extractionLogger.info('Claude extraction complete', {
      biomarkersFound: result.biomarkers.length,
      labDate: result.labDate,
      labName: result.labName,
      processingTimeMs,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle timeout errors
    if (error instanceof Error && (error.name === 'APIConnectionTimeoutError' || errorMessage.includes('timed out'))) {
      extractionLogger.error('Anthropic API request timed out', { errorMessage });
      throw new InternalServerError('AI extraction service timed out. Please try again.');
    }

    // Handle specific Anthropic API errors
    if (errorMessage.includes('401') || errorMessage.includes('authentication')) {
      extractionLogger.error('Anthropic API authentication failed', { errorMessage });
      throw new InternalServerError('AI extraction service not properly configured');
    }

    if (errorMessage.includes('rate_limit') || errorMessage.includes('429')) {
      extractionLogger.error('Anthropic API rate limited', { errorMessage });
      throw new InternalServerError('AI extraction service temporarily unavailable. Please try again.');
    }

    if (errorMessage.includes('overloaded') || errorMessage.includes('503')) {
      extractionLogger.error('Anthropic API overloaded', { errorMessage });
      throw new InternalServerError('AI extraction service busy. Please try again in a moment.');
    }

    extractionLogger.error('Claude extraction failed', { errorMessage });
    throw error;
  }
}

/**
 * Check if Claude extraction is properly configured
 */
export function isClaudeExtractionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export default {
  extractBiomarkersWithClaude,
  isClaudeExtractionConfigured,
};
