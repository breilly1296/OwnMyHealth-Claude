/**
 * Claude API Biomarker Extraction Service
 *
 * Uses Claude's document understanding to extract biomarkers from lab reports.
 * This is more accurate than regex-based extraction as Claude understands
 * the document context and can correctly identify values.
 *
 * @module services/claudeExtraction
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { InternalServerError } from '../middleware/errorHandler.js';

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
  patientName?: string;
}

/**
 * Anthropic client singleton
 */
let anthropicClient: Anthropic | null = null;

/**
 * Get or create Anthropic client
 */
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new InternalServerError('ANTHROPIC_API_KEY environment variable is not set');
    }
    anthropicClient = new Anthropic({ apiKey });
    extractionLogger.info('Initialized Anthropic client');
  }
  return anthropicClient;
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
10. Do NOT include the patient's name in the response

Return ONLY the JSON object, no other text.`;

/**
 * Extract biomarkers from a PDF using Claude API
 *
 * @param pdfBuffer - The PDF file as a buffer
 * @returns Extraction result with biomarkers and metadata
 */
export async function extractBiomarkersWithClaude(
  pdfBuffer: Buffer
): Promise<ClaudeExtractionResult> {
  const startTime = Date.now();

  extractionLogger.info('Starting Claude extraction', {
    bufferSize: pdfBuffer.length,
  });

  try {
    const client = getAnthropicClient();
    const pdfBase64 = pdfBuffer.toString('base64');

    extractionLogger.info('Sending PDF to Claude API', {
      base64Length: pdfBase64.length,
    });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const processingTimeMs = Date.now() - startTime;

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InternalServerError('Claude returned no text content');
    }

    const responseText = textContent.text;
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
        responseText: responseText.substring(0, 500),
      });
      throw new InternalServerError('Claude response did not contain valid JSON');
    }

    let result: ClaudeExtractionResult;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      extractionLogger.error('Failed to parse Claude JSON response', {
        parseError: parseError instanceof Error ? parseError.message : 'Unknown',
        jsonText: jsonMatch[0].substring(0, 500),
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
