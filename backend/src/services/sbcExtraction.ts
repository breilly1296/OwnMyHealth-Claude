/**
 * Claude Sonnet SBC Extraction Service
 *
 * Uses Claude Sonnet's document understanding to extract comprehensive insurance
 * plan details from Summary of Benefits and Coverage (SBC) PDF documents.
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
  visitLimit?: number;
  limitations?: string;
}

/**
 * Prescription (Rx) benefits structure
 */
export interface ExtractedRxBenefits {
  tier1Copay?: number;
  tier2Copay?: number;
  tier3Copay?: number;
  tier4Copay?: number;
  retailDaysSupply?: number;
  mailOrderDaysSupply?: number;
  deductibleIndividual?: number;
  deductibleFamily?: number;
  oopMaxIndividual?: number;
  oopMaxFamily?: number;
}

/**
 * Inpatient coverage structure
 */
export interface ExtractedInpatientCoverage {
  hospitalCopay?: number;
  hospitalCoinsurance?: number;
  mentalHealthCopay?: number;
  mentalHealthCoinsurance?: number;
  maternityCopay?: number;
  maternityCoinsurance?: number;
  skilledNursingCopay?: number;
  skilledNursingCoinsurance?: number;
  skilledNursingDaysLimit?: number;
}

/**
 * Outpatient coverage structure
 */
export interface ExtractedOutpatientCoverage {
  surgeryCopay?: number;
  surgeryCoinsurance?: number;
  mentalHealthCopay?: number;
  mentalHealthCoinsurance?: number;
  labWorkCopay?: number;
  xrayCopay?: number;
  advancedImagingCopay?: number;
}

/**
 * Therapy/Rehab coverage structure
 */
export interface ExtractedTherapyCoverage {
  physicalTherapyCopay?: number;
  physicalTherapyVisitsLimit?: number;
  occupationalTherapyCopay?: number;
  occupationalTherapyVisitsLimit?: number;
  speechTherapyCopay?: number;
  speechTherapyVisitsLimit?: number;
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

  // Core financial details (individual AND family)
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
  copayTelehealth?: number;
  copayLabWork?: number;
  copayXray?: number;
  copayAdvancedImaging?: number;
  coinsuranceRate?: number;

  // Inpatient coverage
  inpatientCoverage?: ExtractedInpatientCoverage;

  // Outpatient coverage
  outpatientCoverage?: ExtractedOutpatientCoverage;

  // Therapy/Rehab coverage with visit limits
  therapyCoverage?: ExtractedTherapyCoverage;

  // Prescription (Rx) benefits
  rxBenefits?: ExtractedRxBenefits;

  // Preventive services list
  preventiveServices?: string[];

  // Exclusions (what's NOT covered)
  exclusions?: string[];

  // Prior authorization requirements
  priorAuthRequirements?: string[];

  // Effective dates
  effectiveDate?: string;
  terminationDate?: string;

  // Benefits by category (detailed breakdown)
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
 * Comprehensive SBC extraction prompt for Claude Sonnet
 */
const SBC_EXTRACTION_PROMPT = `You are an expert at extracting comprehensive insurance plan information from Summary of Benefits and Coverage (SBC) documents.

Analyze this insurance document thoroughly and extract ALL relevant plan details.

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
  "copayTelehealth": 0,
  "copayLabWork": 20,
  "copayXray": 30,
  "copayAdvancedImaging": 100,
  "coinsuranceRate": 20,

  "inpatientCoverage": {
    "hospitalCopay": null,
    "hospitalCoinsurance": 20,
    "mentalHealthCopay": null,
    "mentalHealthCoinsurance": 20,
    "maternityCopay": null,
    "maternityCoinsurance": 20,
    "skilledNursingCopay": null,
    "skilledNursingCoinsurance": 20,
    "skilledNursingDaysLimit": 60
  },

  "outpatientCoverage": {
    "surgeryCopay": 250,
    "surgeryCoinsurance": null,
    "mentalHealthCopay": 25,
    "mentalHealthCoinsurance": null,
    "labWorkCopay": 20,
    "xrayCopay": 30,
    "advancedImagingCopay": 100
  },

  "therapyCoverage": {
    "physicalTherapyCopay": 40,
    "physicalTherapyVisitsLimit": 30,
    "occupationalTherapyCopay": 40,
    "occupationalTherapyVisitsLimit": 30,
    "speechTherapyCopay": 40,
    "speechTherapyVisitsLimit": 30
  },

  "rxBenefits": {
    "tier1Copay": 10,
    "tier2Copay": 35,
    "tier3Copay": 60,
    "tier4Copay": 150,
    "retailDaysSupply": 30,
    "mailOrderDaysSupply": 90,
    "deductibleIndividual": null,
    "deductibleFamily": null,
    "oopMaxIndividual": null,
    "oopMaxFamily": null
  },

  "preventiveServices": [
    "Annual wellness exam",
    "Immunizations per guidelines",
    "Routine screenings (mammogram, colonoscopy, etc.)",
    "Well-child visits",
    "Preventive lab tests"
  ],

  "exclusions": [
    "Cosmetic surgery",
    "Long-term care",
    "Dental care (adult)",
    "Vision care (routine)",
    "Weight loss programs",
    "Infertility treatment"
  ],

  "priorAuthRequirements": [
    "Inpatient hospital stays",
    "Outpatient surgery",
    "Advanced imaging (MRI, CT, PET)",
    "Specialty drugs",
    "Durable medical equipment over $500",
    "Home health care",
    "Skilled nursing facility"
  ],

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
      "visitLimit": null,
      "limitations": null
    }
  ],

  "extractionConfidence": 0.85,
  "warnings": ["Some benefit details may be incomplete"]
}

CRITICAL EXTRACTION INSTRUCTIONS:

1. DEDUCTIBLES & OOP MAX:
   - Extract BOTH individual AND family amounts
   - Check if there are separate medical and Rx deductibles
   - Note if deductible is embedded (combined) or separate

2. COPAYS - Extract for ALL service types:
   - Primary care, Specialist, Urgent care, Emergency room
   - Telehealth/virtual visits
   - Lab work, X-rays, Advanced imaging (CT/MRI/PET)

3. COINSURANCE:
   - The percentage the MEMBER pays (e.g., 20 means 20%)
   - Often applies after deductible is met

4. INPATIENT COVERAGE:
   - Hospital stays (per day or per admission)
   - Mental health/substance abuse inpatient
   - Maternity (facility fee)
   - Skilled nursing facility (SNF) with day limits

5. OUTPATIENT COVERAGE:
   - Ambulatory/outpatient surgery
   - Mental health visits
   - Lab and diagnostic imaging

6. THERAPY/REHAB VISIT LIMITS:
   - Physical therapy (PT) visits per year
   - Occupational therapy (OT) visits per year
   - Speech therapy visits per year
   - Combined limits if applicable

7. PRESCRIPTION (Rx) BENEFITS:
   - Tier 1 (generic) copay
   - Tier 2 (preferred brand) copay
   - Tier 3 (non-preferred brand) copay
   - Tier 4 (specialty) copay or coinsurance
   - Retail days supply (usually 30)
   - Mail order days supply (usually 90)
   - Separate Rx deductible if applicable

8. PREVENTIVE SERVICES:
   - List all covered preventive services
   - Usually covered at 100% (no cost sharing)
   - Examples: annual exam, immunizations, screenings

9. EXCLUSIONS (What's NOT Covered):
   - Cosmetic procedures
   - Experimental treatments
   - Services not listed
   - Specific limitations

10. PRIOR AUTHORIZATION REQUIREMENTS:
    - List services requiring prior auth
    - Hospital admissions, surgeries, specialty drugs, DME, etc.

FORMATTING RULES:
- All dollar amounts: numbers without $ or commas
- Coinsurance/percentages: just the number (20, not 20%)
- Dates: ISO format YYYY-MM-DD
- null for values not found in document
- Empty arrays [] if no items found for lists

EXTRACTION CONFIDENCE (0.0-1.0):
- 0.9+: Clear SBC with all major fields found
- 0.7-0.9: Most fields found, some unclear
- 0.5-0.7: Limited information extracted
- <0.5: Document may not be an SBC

Return ONLY the JSON object, no other text.`;

/**
 * Extract insurance plan data from an SBC PDF using Claude Sonnet API
 *
 * @param pdfBuffer - The PDF file as a buffer
 * @returns Extraction result with comprehensive plan details
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
      max_tokens: 16384,
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

    // Ensure arrays are valid
    if (!Array.isArray(result.preventiveServices)) {
      result.preventiveServices = [];
    }
    if (!Array.isArray(result.exclusions)) {
      result.exclusions = [];
    }
    if (!Array.isArray(result.priorAuthRequirements)) {
      result.priorAuthRequirements = [];
    }

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
      preventiveServicesCount: result.preventiveServices?.length || 0,
      exclusionsCount: result.exclusions?.length || 0,
      priorAuthCount: result.priorAuthRequirements?.length || 0,
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
