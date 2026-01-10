/**
 * Claude Sonnet SBC Extraction Service
 *
 * Uses Claude Sonnet's document understanding to extract insurance plan details
 * from Summary of Benefits and Coverage (SBC) PDF documents.
 *
 * @module services/sbcExtraction
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { InternalServerError } from '../middleware/errorHandler.js';

// Create extraction-specific logger
const sbcLogger = logger.createServiceLogger('SBCExtraction');

/**
 * Extracted benefit from Claude
 */
export interface ExtractedBenefit {
  serviceName: string;
  serviceCategory: string;
  inNetworkCovered: boolean;
  inNetworkCopay?: number;
  inNetworkCoinsurance?: number;
  inNetworkDeductibleApplies: boolean;
  outNetworkCovered: boolean;
  outNetworkCopay?: number;
  outNetworkCoinsurance?: number;
  outNetworkDeductibleApplies: boolean;
  preAuthRequired: boolean;
  limitations?: string;
}

/**
 * Full extraction result from Claude for SBC documents
 */
export interface ExtractedInsuranceData {
  // Plan identification
  planName?: string;
  insurerName?: string;
  planType?: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';
  planIdNumber?: string;

  // Financial details
  deductibleIndividual?: number;
  deductibleFamily?: number;
  oopMaxIndividual?: number;
  oopMaxFamily?: number;
  premiumMonthly?: number;

  // Common copays
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  coinsuranceRate?: number;

  // Effective dates
  effectiveDate?: string;
  terminationDate?: string;

  // Benefits by category
  benefits: ExtractedBenefit[];

  // Extraction metadata
  extractionConfidence: number;
  warnings?: string[];
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
    sbcLogger.info('Initialized Anthropic client for SBC extraction');
  }
  return anthropicClient;
}

/**
 * The extraction prompt for Claude Sonnet
 */
const SBC_EXTRACTION_PROMPT = `You are an expert at extracting insurance plan information from Summary of Benefits and Coverage (SBC) documents.

Analyze this insurance document and extract all relevant plan details.

Return ONLY valid JSON in this exact format (no markdown, no code blocks, just raw JSON):
{
  "planName": "Plan name as shown in document",
  "insurerName": "Insurance company name",
  "planType": "HMO|PPO|EPO|POS|HDHP",
  "planIdNumber": "Plan ID or contract number if shown",

  "deductibleIndividual": 1500,
  "deductibleFamily": 3000,
  "oopMaxIndividual": 6000,
  "oopMaxFamily": 12000,
  "premiumMonthly": null,

  "copayPrimaryCare": 25,
  "copaySpecialist": 50,
  "copayUrgentCare": 75,
  "copayEmergency": 250,
  "coinsuranceRate": 20,

  "effectiveDate": "2024-01-01",
  "terminationDate": "2024-12-31",

  "benefits": [
    {
      "serviceName": "Primary Care Visit",
      "serviceCategory": "Office Visits",
      "inNetworkCovered": true,
      "inNetworkCopay": 25,
      "inNetworkCoinsurance": null,
      "inNetworkDeductibleApplies": false,
      "outNetworkCovered": true,
      "outNetworkCopay": null,
      "outNetworkCoinsurance": 40,
      "outNetworkDeductibleApplies": true,
      "preAuthRequired": false,
      "limitations": null
    }
  ],

  "extractionConfidence": 0.85,
  "warnings": ["Some benefit details may be incomplete"]
}

IMPORTANT INSTRUCTIONS:
1. Extract the plan type (HMO, PPO, EPO, POS, or HDHP) based on document content
2. All dollar amounts should be numbers without $ symbol or commas
3. Coinsurance rates should be the percentage the member pays (e.g., 20 for 20%)
4. For dates, use ISO format (YYYY-MM-DD)
5. Set null for values not found in the document

BENEFITS TO EXTRACT (use these exact service categories):
- Office Visits: Primary Care Visit, Specialist Visit, Telehealth Visit
- Preventive: Preventive Care, Immunizations, Screening Tests
- Emergency: Emergency Room, Urgent Care, Ambulance
- Hospital: Hospital Stay (Inpatient), Outpatient Surgery, Skilled Nursing
- Mental Health: Mental Health (Outpatient), Mental Health (Inpatient), Substance Abuse
- Pharmacy: Generic Drugs, Preferred Brand Drugs, Non-Preferred Drugs, Specialty Drugs
- Diagnostic: Lab Tests, X-Ray, Advanced Imaging (CT/MRI/PET)
- Therapy: Physical Therapy, Occupational Therapy, Speech Therapy
- Maternity: Prenatal Care, Delivery, Postnatal Care
- Equipment: Durable Medical Equipment, Prosthetics

For each benefit, determine:
- If it's covered in-network and out-of-network
- The copay amount (if flat fee) or coinsurance percentage
- Whether deductible applies before coverage
- If prior authorization is required
- Any limitations (visit limits, waiting periods, etc.)

Calculate extractionConfidence (0.0-1.0) based on:
- 0.9+ : Clear SBC document with all major fields found
- 0.7-0.9: Most fields found but some unclear or missing
- 0.5-0.7: Limited information extracted
- <0.5: Document may not be an SBC or is poorly formatted

Add warnings for any fields that were ambiguous or required assumptions.

Return ONLY the JSON object, no other text.`;

/**
 * Extract insurance plan data from an SBC PDF using Claude Sonnet API
 *
 * @param pdfBuffer - The PDF file as a buffer
 * @returns Extraction result with plan details and benefits
 */
export async function extractInsuranceFromSBC(
  pdfBuffer: Buffer
): Promise<ExtractedInsuranceData> {
  const startTime = Date.now();

  sbcLogger.info('Starting Claude SBC extraction', {
    bufferSize: pdfBuffer.length,
  });

  try {
    const client = getAnthropicClient();
    const pdfBase64 = pdfBuffer.toString('base64');

    sbcLogger.info('Sending SBC PDF to Claude Sonnet API', {
      base64Length: pdfBase64.length,
    });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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
              text: SBC_EXTRACTION_PROMPT,
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
    sbcLogger.info('Received Claude SBC response', {
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
      sbcLogger.error('No JSON found in Claude SBC response', {
        responseText: responseText.substring(0, 500),
      });
      throw new InternalServerError('Claude response did not contain valid JSON');
    }

    let result: ExtractedInsuranceData;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      sbcLogger.error('Failed to parse Claude SBC JSON response', {
        parseError: parseError instanceof Error ? parseError.message : 'Unknown',
        jsonText: jsonMatch[0].substring(0, 500),
      });
      throw new InternalServerError('Failed to parse insurance data from Claude response');
    }

    // Validate and clean up the result
    if (!result.benefits || !Array.isArray(result.benefits)) {
      result.benefits = [];
    }

    // Validate plan type
    const validPlanTypes = ['HMO', 'PPO', 'EPO', 'POS', 'HDHP'];
    if (result.planType && !validPlanTypes.includes(result.planType)) {
      result.planType = undefined;
    }

    // Filter out invalid benefits
    result.benefits = result.benefits.filter((b) => {
      if (!b.serviceName || !b.serviceCategory) {
        sbcLogger.warn('Filtering invalid benefit', { benefit: b });
        return false;
      }
      return true;
    });

    // Ensure extractionConfidence is valid
    if (
      typeof result.extractionConfidence !== 'number' ||
      isNaN(result.extractionConfidence)
    ) {
      result.extractionConfidence = 0.5;
    }
    result.extractionConfidence = Math.max(0, Math.min(1, result.extractionConfidence));

    sbcLogger.info('Claude SBC extraction complete', {
      planName: result.planName || 'Unknown',
      planType: result.planType || 'Unknown',
      benefitsExtracted: result.benefits.length,
      extractionConfidence: result.extractionConfidence,
      processingTimeMs,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle specific Anthropic API errors
    if (errorMessage.includes('401') || errorMessage.includes('authentication')) {
      sbcLogger.error('Anthropic API authentication failed', { errorMessage });
      throw new InternalServerError('AI extraction service not properly configured');
    }

    if (errorMessage.includes('rate_limit') || errorMessage.includes('429')) {
      sbcLogger.error('Anthropic API rate limited', { errorMessage });
      throw new InternalServerError(
        'AI extraction service temporarily unavailable. Please try again.'
      );
    }

    if (errorMessage.includes('overloaded') || errorMessage.includes('503')) {
      sbcLogger.error('Anthropic API overloaded', { errorMessage });
      throw new InternalServerError(
        'AI extraction service busy. Please try again in a moment.'
      );
    }

    sbcLogger.error('Claude SBC extraction failed', { errorMessage });
    throw error;
  }
}

/**
 * Check if Claude SBC extraction is properly configured
 */
export function isSBCExtractionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export default {
  extractInsuranceFromSBC,
  isSBCExtractionConfigured,
};
