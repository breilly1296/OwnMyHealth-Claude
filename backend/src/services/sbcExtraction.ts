/**
 * Claude Sonnet SBC Extraction Service
 *
 * Uses Claude Sonnet's document understanding to extract comprehensive insurance
 * plan details from Summary of Benefits and Coverage (SBC) PDF documents.
 *
 * @module services/sbcExtraction
 */

import { logger } from '../utils/logger.js';
import { InternalServerError, ValidationError } from '../middleware/errorHandler.js';
import { trackAIUsage } from './aiCostTracker.js';
import { extractTextFromPDF } from './pdfTextExtraction.js';
import { redactPHI, stripPHIFromText } from '../utils/phiRedaction.js';
import { getAnthropicClient } from './anthropicClient.js';
import { config } from '../config/index.js';

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
  dayLimit?: number;
  limitations?: string;
}

/**
 * Prescription (Rx) benefits structure
 */
export interface ExtractedRxBenefits {
  tier1Copay?: number;
  tier1CoinsurancePercent?: number;
  tier2Copay?: number;
  tier2CoinsurancePercent?: number;
  tier3Copay?: number;
  tier3CoinsurancePercent?: number;
  tier4Copay?: number;
  tier4CoinsurancePercent?: number;
  specialtyCopay?: number;
  specialtyCoinsurancePercent?: number;
  retailDaysSupply?: number;
  mailOrderDaysSupply?: number;
  mailOrderCostMultiplier?: number;
  deductibleIndividual?: number;
  deductibleFamily?: number;
  oopMaxIndividual?: number;
  oopMaxFamily?: number;
  separateRxDeductible?: boolean;
  preferredPharmacyRequired?: boolean;
}

/**
 * Inpatient coverage structure
 */
export interface ExtractedInpatientCoverage {
  hospitalCopayPerDay?: number;
  hospitalCopayPerAdmission?: number;
  hospitalCoinsurance?: number;
  hospitalDayLimit?: number;
  mentalHealthCopay?: number;
  mentalHealthCoinsurance?: number;
  mentalHealthDayLimit?: number;
  substanceAbuseCopay?: number;
  substanceAbuseCoinsurance?: number;
  substanceAbuseDayLimit?: number;
  maternityCopay?: number;
  maternityCoinsurance?: number;
  skilledNursingCopay?: number;
  skilledNursingCoinsurance?: number;
  skilledNursingDaysLimit?: number;
  rehabilitationCopay?: number;
  rehabilitationCoinsurance?: number;
  rehabilitationDayLimit?: number;
}

/**
 * Outpatient coverage structure
 */
export interface ExtractedOutpatientCoverage {
  surgeryCopay?: number;
  surgeryCoinsurance?: number;
  mentalHealthIndividualCopay?: number;
  mentalHealthGroupCopay?: number;
  mentalHealthCoinsurance?: number;
  mentalHealthVisitLimit?: number;
  substanceAbuseIndividualCopay?: number;
  substanceAbuseGroupCopay?: number;
  substanceAbuseCoinsurance?: number;
  labWorkCopay?: number;
  labWorkCoinsurance?: number;
  xrayCopay?: number;
  xrayCoinsurance?: number;
  advancedImagingCopay?: number;
  advancedImagingCoinsurance?: number;
  chemotherapyCopay?: number;
  chemotherapyCoinsurance?: number;
  radiationCopay?: number;
  radiationCoinsurance?: number;
  dialysisCopay?: number;
  dialysisCoinsurance?: number;
}

/**
 * Therapy/Rehab coverage structure
 */
export interface ExtractedTherapyCoverage {
  physicalTherapyCopay?: number;
  physicalTherapyCoinsurance?: number;
  physicalTherapyVisitsLimit?: number;
  occupationalTherapyCopay?: number;
  occupationalTherapyCoinsurance?: number;
  occupationalTherapyVisitsLimit?: number;
  speechTherapyCopay?: number;
  speechTherapyCoinsurance?: number;
  speechTherapyVisitsLimit?: number;
  cardiacRehabCopay?: number;
  cardiacRehabVisitsLimit?: number;
  pulmonaryRehabCopay?: number;
  pulmonaryRehabVisitsLimit?: number;
  chiropracticCopay?: number;
  chiropracticVisitsLimit?: number;
  acupunctureCopay?: number;
  acupunctureVisitsLimit?: number;
}

/**
 * Vision coverage structure
 */
export interface ExtractedVisionCoverage {
  examCopay?: number;
  examFrequency?: string;
  lensesAllowance?: number;
  lensesFrequency?: string;
  framesAllowance?: number;
  framesFrequency?: string;
  contactsAllowance?: number;
  contactsFrequency?: string;
  includedInMedical?: boolean;
}

/**
 * Dental coverage structure
 */
export interface ExtractedDentalCoverage {
  preventiveCoinsurance?: number;
  basicCoinsurance?: number;
  majorCoinsurance?: number;
  annualMaximum?: number;
  deductible?: number;
  orthodontiaCoinsurance?: number;
  orthodontiaLifetimeMax?: number;
  includedInMedical?: boolean;
}

/**
 * Emergency/Urgent care coverage
 */
export interface ExtractedEmergencyCoverage {
  emergencyRoomCopay?: number;
  emergencyRoomCoinsurance?: number;
  emergencyRoomDeductibleApplies?: boolean;
  urgentCareCopay?: number;
  urgentCareCoinsurance?: number;
  ambulanceGroundCopay?: number;
  ambulanceGroundCoinsurance?: number;
  ambulanceAirCopay?: number;
  ambulanceAirCoinsurance?: number;
}

/**
 * Durable Medical Equipment coverage
 */
export interface ExtractedDMECoverage {
  copay?: number;
  coinsurance?: number;
  priorAuthRequired?: boolean;
  rentalVsPurchase?: string;
}

/**
 * Home Health coverage
 */
export interface ExtractedHomeHealthCoverage {
  visitCopay?: number;
  visitCoinsurance?: number;
  visitLimit?: number;
  priorAuthRequired?: boolean;
}

/**
 * Hospice coverage
 */
export interface ExtractedHospiceCoverage {
  inpatientCopay?: number;
  inpatientCoinsurance?: number;
  respiteCopay?: number;
  respiteCoinsurance?: number;
  respiteDayLimit?: number;
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
  groupNumber?: string;
  networkName?: string;

  // Core financial details (individual AND family) - In-network
  deductibleIndividual?: number;
  deductibleFamily?: number;
  oopMaxIndividual?: number;
  oopMaxFamily?: number;
  premiumMonthly?: number;
  coinsuranceRate?: number;

  // Out-of-network financial limits
  deductibleIndividualOutOfNetwork?: number;
  deductibleFamilyOutOfNetwork?: number;
  oopMaxIndividualOutOfNetwork?: number;
  oopMaxFamilyOutOfNetwork?: number;

  // Deductible details
  deductibleCrossAccumulation?: boolean;
  deductibleIncludesRx?: boolean;
  oopIncludesDeductible?: boolean;

  // Common copays
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayPreventive?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  copayTelehealth?: number;
  copayLabWork?: number;
  copayXray?: number;
  copayAdvancedImaging?: number;

  // Per-service coinsurance (for plans with "X% after deductible" instead of copays)
  coinsurancePrimaryCare?: number;
  coinsuranceSpecialist?: number;
  coinsuranceUrgentCare?: number;
  coinsuranceEmergency?: number;
  coinsuranceTelehealth?: number;
  coinsuranceLabWork?: number;
  coinsuranceXray?: number;
  coinsuranceAdvancedImaging?: number;

  // Detailed coverage sections
  inpatientCoverage?: ExtractedInpatientCoverage;
  outpatientCoverage?: ExtractedOutpatientCoverage;
  therapyCoverage?: ExtractedTherapyCoverage;
  emergencyCoverage?: ExtractedEmergencyCoverage;
  rxBenefits?: ExtractedRxBenefits;
  visionCoverage?: ExtractedVisionCoverage;
  dentalCoverage?: ExtractedDentalCoverage;
  dmeCoverage?: ExtractedDMECoverage;
  homeHealthCoverage?: ExtractedHomeHealthCoverage;
  hospiceCoverage?: ExtractedHospiceCoverage;

  // Preventive services list (covered at 100%)
  preventiveServices?: string[];

  // Exclusions (what's NOT covered)
  exclusions?: string[];

  // Prior authorization requirements
  priorAuthRequirements?: string[];

  // Services with visit/day limits
  servicesWithLimits?: Array<{
    service: string;
    limit: number;
    limitType: 'visits' | 'days' | 'dollars' | 'lifetime';
    period: 'per year' | 'per admission' | 'lifetime' | 'per occurrence';
  }>;

  // Effective dates
  effectiveDate?: string;
  terminationDate?: string;
  planYear?: string;

  // Benefits by category (detailed breakdown)
  benefits: ExtractedBenefit[];

  // Extraction metadata
  extractionConfidence: number;
  warnings?: string[];
  pagesProcessed?: number;
}

/**
 * Comprehensive SBC extraction prompt for Claude Sonnet
 */
const SBC_EXTRACTION_PROMPT = `You are an expert insurance analyst. Your task is to extract EVERY detail from this Summary of Benefits and Coverage (SBC) document.

CRITICAL: This document has MULTIPLE PAGES. You MUST read and extract information from ALL pages, not just the first page. SBC documents typically have:
- Page 1-2: Summary of important coverage features
- Page 3-4: Common medical events and services table
- Page 5-6: Excluded services and other covered services
- Page 7+: Coverage examples, definitions, and additional details

READ EVERY PAGE THOROUGHLY before responding.

Return ONLY valid JSON (no markdown, no code blocks, no explanation text):

{
  "planName": "Full plan name from document header",
  "insurerName": "Insurance company name",
  "planType": "HMO|PPO|EPO|POS|HDHP",
  "planIdNumber": "Plan ID/contract number if shown",
  "groupNumber": "Group number if shown",
  "networkName": "Network name (e.g., BlueCard PPO)",

  "deductibleIndividual": 1500,
  "deductibleFamily": 3000,
  "oopMaxIndividual": 6000,
  "oopMaxFamily": 12000,
  "deductibleIndividualOutOfNetwork": 3000,
  "deductibleFamilyOutOfNetwork": 6000,
  "oopMaxIndividualOutOfNetwork": 12000,
  "oopMaxFamilyOutOfNetwork": 24000,
  "premiumMonthly": null,
  "coinsuranceRate": 20,
  "deductibleCrossAccumulation": true,
  "deductibleIncludesRx": false,
  "oopIncludesDeductible": true,

  "copayPrimaryCare": 25,
  "copaySpecialist": 50,
  "copayPreventive": 0,
  "copayUrgentCare": 75,
  "copayEmergency": 250,
  "copayTelehealth": 0,
  "copayLabWork": 0,
  "copayXray": 0,
  "copayAdvancedImaging": 250,

  "coinsurancePrimaryCare": null,
  "coinsuranceSpecialist": null,
  "coinsuranceUrgentCare": null,
  "coinsuranceEmergency": null,
  "coinsuranceTelehealth": null,
  "coinsuranceLabWork": null,
  "coinsuranceXray": null,
  "coinsuranceAdvancedImaging": null,

  "emergencyCoverage": {
    "emergencyRoomCopay": 250,
    "emergencyRoomCoinsurance": null,
    "emergencyRoomDeductibleApplies": true,
    "urgentCareCopay": 75,
    "urgentCareCoinsurance": null,
    "ambulanceGroundCopay": null,
    "ambulanceGroundCoinsurance": 20,
    "ambulanceAirCopay": null,
    "ambulanceAirCoinsurance": 20
  },

  "inpatientCoverage": {
    "hospitalCopayPerDay": 500,
    "hospitalCopayPerAdmission": null,
    "hospitalCoinsurance": 20,
    "hospitalDayLimit": null,
    "mentalHealthCopay": null,
    "mentalHealthCoinsurance": 20,
    "mentalHealthDayLimit": 30,
    "substanceAbuseCopay": null,
    "substanceAbuseCoinsurance": 20,
    "substanceAbuseDayLimit": 30,
    "maternityCopay": null,
    "maternityCoinsurance": 20,
    "skilledNursingCopay": null,
    "skilledNursingCoinsurance": 20,
    "skilledNursingDaysLimit": 60,
    "rehabilitationCopay": null,
    "rehabilitationCoinsurance": 20,
    "rehabilitationDayLimit": 60
  },

  "outpatientCoverage": {
    "surgeryCopay": 250,
    "surgeryCoinsurance": 20,
    "mentalHealthIndividualCopay": 25,
    "mentalHealthGroupCopay": 15,
    "mentalHealthCoinsurance": null,
    "mentalHealthVisitLimit": null,
    "substanceAbuseIndividualCopay": 25,
    "substanceAbuseGroupCopay": 15,
    "substanceAbuseCoinsurance": null,
    "labWorkCopay": 0,
    "labWorkCoinsurance": null,
    "xrayCopay": 0,
    "xrayCoinsurance": null,
    "advancedImagingCopay": 250,
    "advancedImagingCoinsurance": null,
    "chemotherapyCopay": null,
    "chemotherapyCoinsurance": 20,
    "radiationCopay": null,
    "radiationCoinsurance": 20,
    "dialysisCopay": null,
    "dialysisCoinsurance": 20
  },

  "therapyCoverage": {
    "physicalTherapyCopay": 40,
    "physicalTherapyCoinsurance": null,
    "physicalTherapyVisitsLimit": 30,
    "occupationalTherapyCopay": 40,
    "occupationalTherapyCoinsurance": null,
    "occupationalTherapyVisitsLimit": 30,
    "speechTherapyCopay": 40,
    "speechTherapyCoinsurance": null,
    "speechTherapyVisitsLimit": 30,
    "cardiacRehabCopay": 40,
    "cardiacRehabVisitsLimit": 36,
    "pulmonaryRehabCopay": 40,
    "pulmonaryRehabVisitsLimit": null,
    "chiropracticCopay": 40,
    "chiropracticVisitsLimit": 20,
    "acupunctureCopay": 40,
    "acupunctureVisitsLimit": 20
  },

  "rxBenefits": {
    "tier1Copay": 10,
    "tier1CoinsurancePercent": null,
    "tier2Copay": 35,
    "tier2CoinsurancePercent": null,
    "tier3Copay": 60,
    "tier3CoinsurancePercent": null,
    "tier4Copay": null,
    "tier4CoinsurancePercent": 30,
    "specialtyCopay": null,
    "specialtyCoinsurancePercent": 30,
    "retailDaysSupply": 30,
    "mailOrderDaysSupply": 90,
    "mailOrderCostMultiplier": 2.5,
    "deductibleIndividual": null,
    "deductibleFamily": null,
    "oopMaxIndividual": null,
    "oopMaxFamily": null,
    "separateRxDeductible": false,
    "preferredPharmacyRequired": true
  },

  "visionCoverage": {
    "examCopay": 10,
    "examFrequency": "once per 12 months",
    "lensesAllowance": 150,
    "lensesFrequency": "once per 12 months",
    "framesAllowance": 150,
    "framesFrequency": "once per 24 months",
    "contactsAllowance": 150,
    "contactsFrequency": "once per 12 months",
    "includedInMedical": false
  },

  "dentalCoverage": {
    "preventiveCoinsurance": 0,
    "basicCoinsurance": 20,
    "majorCoinsurance": 50,
    "annualMaximum": 1500,
    "deductible": 50,
    "orthodontiaCoinsurance": 50,
    "orthodontiaLifetimeMax": 1500,
    "includedInMedical": false
  },

  "dmeCoverage": {
    "copay": null,
    "coinsurance": 20,
    "priorAuthRequired": true,
    "rentalVsPurchase": "rental preferred"
  },

  "homeHealthCoverage": {
    "visitCopay": null,
    "visitCoinsurance": 20,
    "visitLimit": 60,
    "priorAuthRequired": true
  },

  "hospiceCoverage": {
    "inpatientCopay": null,
    "inpatientCoinsurance": 0,
    "respiteCopay": null,
    "respiteCoinsurance": 0,
    "respiteDayLimit": 5
  },

  "preventiveServices": [
    "Annual wellness exam - --",
    "Routine immunizations - --",
    "Well-child visits - --",
    "Mammogram screening - --",
    "Colonoscopy screening - --",
    "Cervical cancer screening (Pap) - --",
    "Prostate cancer screening (PSA) - --",
    "Bone density test (DEXA) - --",
    "Diabetes screening - --",
    "Cholesterol screening - --",
    "Blood pressure screening - --",
    "Depression screening - --",
    "Obesity screening and counseling - --",
    "Tobacco cessation counseling - --",
    "Contraceptive counseling - --",
    "STI screening - --"
  ],

  "exclusions": [
    "Cosmetic surgery (unless medically necessary)",
    "Long-term care / custodial care",
    "Routine dental care (adults)",
    "Routine vision care (if not included)",
    "Weight loss surgery (unless criteria met)",
    "Infertility treatment (or limited)",
    "Hearing aids",
    "Private duty nursing",
    "Non-emergency care outside US",
    "Experimental/investigational treatments",
    "Services not medically necessary"
  ],

  "priorAuthRequirements": [
    "Inpatient hospital admissions (non-emergency)",
    "Inpatient mental health/substance abuse",
    "Skilled nursing facility stays",
    "Inpatient rehabilitation",
    "Outpatient surgery (select procedures)",
    "Advanced imaging (MRI, CT, PET scans)",
    "Specialty drugs / biologics",
    "Durable medical equipment over $500",
    "Home health care",
    "Private duty nursing",
    "Transplants",
    "Bariatric surgery",
    "Genetic testing",
    "Sleep studies"
  ],

  "servicesWithLimits": [
    {"service": "Physical therapy", "limit": 30, "limitType": "visits", "period": "per year"},
    {"service": "Occupational therapy", "limit": 30, "limitType": "visits", "period": "per year"},
    {"service": "Speech therapy", "limit": 30, "limitType": "visits", "period": "per year"},
    {"service": "Chiropractic care", "limit": 20, "limitType": "visits", "period": "per year"},
    {"service": "Skilled nursing facility", "limit": 60, "limitType": "days", "period": "per year"},
    {"service": "Inpatient mental health", "limit": 30, "limitType": "days", "period": "per year"},
    {"service": "Home health visits", "limit": 60, "limitType": "visits", "period": "per year"},
    {"service": "Hospice respite care", "limit": 5, "limitType": "days", "period": "per occurrence"}
  ],

  "effectiveDate": "2024-01-01",
  "terminationDate": "2024-12-31",
  "planYear": "2024",

  "benefits": [
    {
      "serviceName": "Primary Care Visit",
      "serviceCategory": "Physician Services",
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
      "dayLimit": null,
      "limitations": null
    },
    {
      "serviceName": "Specialist Visit",
      "serviceCategory": "Physician Services",
      "inNetworkCovered": true,
      "inNetworkCopay": 50,
      "inNetworkCoinsurance": null,
      "inNetworkDeductibleApplies": false,
      "outNetworkCovered": true,
      "outNetworkCopay": null,
      "outNetworkCoinsurance": 40,
      "outNetworkDeductibleApplies": true,
      "preAuthRequired": false,
      "visitLimit": null,
      "dayLimit": null,
      "limitations": null
    }
  ],

  "extractionConfidence": 0.85,
  "warnings": [],
  "pagesProcessed": 7
}

EXTRACTION INSTRUCTIONS - READ CAREFULLY:

1. DEDUCTIBLES & OUT-OF-POCKET MAXIMUMS:
   - Get BOTH individual AND family amounts
   - Get BOTH in-network AND out-of-network amounts (look in "Cost Sharing Expenses" section)
     - Example: "Deductible - Single: $2,500 (In Network) / $5,000 (Out of Network)"
     - deductibleIndividual = 2500, deductibleIndividualOutOfNetwork = 5000
   - Out-of-network limits are typically 2x the in-network amounts
   - Use deductibleIndividualOutOfNetwork, deductibleFamilyOutOfNetwork, oopMaxIndividualOutOfNetwork, oopMaxFamilyOutOfNetwork
   - Check if Rx has separate deductible
   - Note if deductible cross-accumulates between family members
   - Check if OOP max includes deductible or is in addition

2. OFFICE VISITS (Look in "If you visit a health care provider's office"):
   - Primary care visit copay OR coinsurance
   - Specialist visit copay OR coinsurance
   - Preventive/wellness visit copay (usually $0)
   - Telehealth/virtual visit copay OR coinsurance

   IMPORTANT: Many plans (especially HDHP) have NO copays - they use coinsurance instead.
   If the document shows "X% coinsurance" or "X% after deductible" instead of a dollar copay:
   - Set the copay field to null (e.g., copayPrimaryCare: null)
   - Set the coinsurance field to the percentage (e.g., coinsurancePrimaryCare: 0 for "0% after deductible")
   - "0% after deductible" means patient pays 0% (plan pays 100%) after deductible is met
   - "20% after deductible" means patient pays 20% after deductible is met

3. INPATIENT HOSPITAL (Look in "If you have a hospital stay"):
   - Hospital facility fee (per day OR per admission)
   - Physician/surgeon fees
   - Mental health inpatient
   - Substance abuse inpatient
   - Maternity (facility and professional fees)
   - Skilled nursing facility (and day limits!)
   - Inpatient rehabilitation

4. OUTPATIENT SERVICES (Look in "If you have outpatient surgery" and "If you need mental health"):
   - Outpatient surgery (facility fee)
   - Mental health visits (individual vs group therapy)
   - Substance abuse outpatient
   - Lab tests - use copayLabWork/coinsuranceLabWork
   - X-rays and diagnostic imaging - use copayXray/coinsuranceXray
   - CT/MRI/PET scans (advanced imaging) - use copayAdvancedImaging/coinsuranceAdvancedImaging
   - Chemotherapy
   - Radiation therapy
   - Dialysis
   NOTE: For lab/imaging, if document shows "0% after deductible" or "X% coinsurance",
   use the coinsurance fields (coinsuranceLabWork, coinsuranceXray, coinsuranceAdvancedImaging)

5. THERAPY SERVICES (Look for rehabilitation/habilitation):
   - Physical therapy (copay AND visit limit)
   - Occupational therapy (copay AND visit limit)
   - Speech therapy (copay AND visit limit)
   - Cardiac rehabilitation
   - Pulmonary rehabilitation
   - Chiropractic (often has visit limits)
   - Acupuncture (if covered)

6. EMERGENCY & URGENT CARE (Look in "If you need immediate"):
   - Emergency room copay OR coinsurance (use copayEmergency/coinsuranceEmergency)
   - Urgent care copay OR coinsurance (use copayUrgentCare/coinsuranceUrgentCare)
   - Ground ambulance
   - Air ambulance
   NOTE: If ER shows "0% after deductible", set copayEmergency: null and coinsuranceEmergency: 0
   Some plans waive ER copay if admitted - note this but still extract the copay/coinsurance

7. PRESCRIPTION DRUGS (Look for "If you need drugs"):
   - Tier 1/Generic: copay (tier1Copay) OR coinsurance % (tier1CoinsurancePercent)
   - Tier 2/Preferred brand: copay (tier2Copay) OR coinsurance % (tier2CoinsurancePercent)
   - Tier 3/Non-preferred: copay (tier3Copay) OR coinsurance % (tier3CoinsurancePercent)
   - Tier 4/Specialty: copay (tier4Copay) OR coinsurance % (tier4CoinsurancePercent)
   - Retail supply days (usually 30)
   - Mail order supply days (usually 90)
   - Mail order pricing (e.g., 2x copay for 3x supply)
   - Separate Rx deductible?
   NOTE: HDHP plans often have "X% after deductible" for all tiers instead of flat copays.
   If drug tier shows "0% after deductible", set copay to null and coinsurance to 0.

8. VISION & DENTAL (if included - often separate):
   - Vision exam copay/frequency
   - Lens/frame allowances
   - Dental preventive/basic/major coinsurance
   - Annual and lifetime maximums

9. OTHER SERVICES:
   - Durable medical equipment (DME)
   - Home health care (visit limits)
   - Hospice care
   - Habilitative services

10. PREVENTIVE SERVICES (Usually page 5-6):
    - List ALL services covered at 100%
    - Wellness exams, screenings, immunizations
    - Cancer screenings (mammogram, colonoscopy, PSA, Pap)
    - Bone density (DEXA)

11. EXCLUSIONS (Look for "Excluded Services & Other"):
    - What is NOT covered
    - Services requiring medical necessity
    - Experimental treatments
    - Coverage limitations

12. PRIOR AUTHORIZATION:
    - Services requiring pre-approval
    - Usually indicated by footnotes or asterisks
    - Common: hospital admits, imaging, specialty drugs

13. VISIT/DAY LIMITS:
    - Extract ALL limits mentioned
    - Therapy visits, SNF days, mental health days
    - Often buried in footnotes or limitations

FORMATTING:
- Dollar amounts: numbers only (no $, no commas)
- Percentages: number only (20 not 20%)
- null for not found (not "N/A" or empty string)
- Empty arrays [] if no items found
- Dates: YYYY-MM-DD format

CONFIDENCE SCORING:
- 0.95+: All major sections found, clear document
- 0.85-0.94: Most details found, minor gaps
- 0.70-0.84: Key information found, some sections unclear
- 0.50-0.69: Limited extraction, document quality issues
- <0.50: Unable to extract meaningful data

Set pagesProcessed to the number of pages you actually read.

Return ONLY the JSON object. No other text.`;

/**
 * Extract insurance plan data from an SBC PDF using Claude Sonnet API.
 *
 * Flow (C-7 minimum-necessary): extract text locally via pdf-parse → run
 * PHI redaction on the text → send text-only prompt to Claude. Raw PDF
 * bytes never leave the process. Scanned/image-only SBC PDFs are rejected
 * — no vision fallback by design.
 *
 * @param pdfBuffer - The PDF file as a buffer
 * @param userId    - The uploading user's ID, attributed to AI-cost tracking
 * @returns Extraction result with comprehensive plan details
 */
export async function extractInsuranceFromSBC(
  pdfBuffer: Buffer,
  userId: string
): Promise<ExtractedInsuranceData> {
  const startTime = Date.now();

  sbcLogger.info('Starting Claude SBC extraction', {
    bufferSize: pdfBuffer.length,
  });

  // C-7 runtime gate — BAA must be acknowledged before PHI leaves the box.
  if (!config.anthropic.baaActive) {
    throw new InternalServerError(
      'Claude API calls with PHI require an active BAA. ' +
      'Set ANTHROPIC_BAA_ACTIVE=true after confirming BAA coverage. See SECURITY_STATUS.md C-7.'
    );
  }

  try {
    const client = getAnthropicClient();

    // Stage A — local text extraction.
    const extracted = await extractTextFromPDF(pdfBuffer);

    // Scanned SBCs fall out here — the fallback regex parser at the call
    // site in controllers/upload/shared.ts picks up the slack.
    if (!extracted.usable) {
      sbcLogger.warn('Local SBC text extraction insufficient — refusing to call Claude', {
        textLength: extracted.text.length,
        isLikelyScanned: extracted.isLikelyScanned,
      });
      throw new ValidationError(
        'SBC text extraction did not yield enough readable text (likely a scanned document). ' +
        'Upload a text-based SBC PDF or re-scan at higher quality.'
      );
    }

    // Stage B — redact PHI from the extracted text.
    const { text: redactedText, firedPatterns } = redactPHI(extracted.text);

    sbcLogger.info('PHI redaction applied to SBC text', {
      originalLength: extracted.text.length,
      redactedLength: redactedText.length,
      firedPatterns,
    });

    // Stage C — call Claude Sonnet with redacted text. No document block.
    sbcLogger.info('Sending PHI-redacted SBC text to Claude Sonnet', {
      model: 'claude-sonnet-4-5-20250929',
      redactedLength: redactedText.length,
    });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 16384,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${SBC_EXTRACTION_PROMPT}\n\n--- SBC DOCUMENT TEXT (PHI-redacted) ---\n${redactedText}\n\nNote: patient/subscriber identifiers have been redacted as [*_REDACTED] tokens. Do not attempt to reconstruct them.`,
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

    // Defense-in-depth: strip any PHI Claude may have echoed back (e.g., a
    // subscriber name pulled from a vision-path page that slipped past the
    // banner cover, or a member ID quoted in a warnings string). Matches
    // the posture in claudeExtraction.ts. Applied before JSON parsing so
    // parser sees only scrubbed text.
    const responseText = stripPHIFromText(textContent.text);
    sbcLogger.info('Received Claude SBC response', {
      responseLength: responseText.length,
      processingTimeMs,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    trackAIUsage({
      endpoint: 'sbc-extraction',
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      userId,
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
        responseLength: responseText.length,
      });
      throw new InternalServerError('Claude response did not contain valid JSON');
    }

    let result: ExtractedInsuranceData;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      sbcLogger.error('Failed to parse Claude SBC JSON response', {
        parseError: parseError instanceof Error ? parseError.message : 'Unknown',
        jsonLength: jsonMatch[0].length,
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
    if (!Array.isArray(result.servicesWithLimits)) {
      result.servicesWithLimits = [];
    }

    // Ensure extractionConfidence is valid
    if (
      typeof result.extractionConfidence !== 'number' ||
      isNaN(result.extractionConfidence)
    ) {
      result.extractionConfidence = 0.5;
    }
    result.extractionConfidence = Math.max(0, Math.min(1, result.extractionConfidence));

    // F-19 fix: planName + insurerName are PHI-adjacent (a particular plan
    // narrows the user pool, especially for employer-specific group plans)
    // and shouldn't persist in logs. planType (HMO/PPO/etc.) stays — it's
    // a generic enum and useful for diagnostics.
    sbcLogger.info('Claude SBC extraction complete', {
      planType: result.planType || 'Unknown',
      benefitsExtracted: result.benefits.length,
      preventiveServicesCount: result.preventiveServices?.length || 0,
      exclusionsCount: result.exclusions?.length || 0,
      priorAuthCount: result.priorAuthRequirements?.length || 0,
      servicesWithLimitsCount: result.servicesWithLimits?.length || 0,
      hasInpatientCoverage: !!result.inpatientCoverage,
      hasOutpatientCoverage: !!result.outpatientCoverage,
      hasTherapyCoverage: !!result.therapyCoverage,
      hasRxBenefits: !!result.rxBenefits,
      hasVisionCoverage: !!result.visionCoverage,
      hasDentalCoverage: !!result.dentalCoverage,
      extractionConfidence: result.extractionConfidence,
      pagesProcessed: result.pagesProcessed,
      processingTimeMs,
    });

    // Debug logging for fields that often show "--" in UI
    sbcLogger.info('SBC extraction details - Office visits & copays', {
      copayPrimaryCare: result.copayPrimaryCare,
      copaySpecialist: result.copaySpecialist,
      copayTelehealth: result.copayTelehealth,
      copayLabWork: result.copayLabWork,
      copayXray: result.copayXray,
      copayAdvancedImaging: result.copayAdvancedImaging,
      copayUrgentCare: result.copayUrgentCare,
      copayEmergency: result.copayEmergency,
      coinsuranceRate: result.coinsuranceRate,
      // New coinsurance fields
      coinsurancePrimaryCare: result.coinsurancePrimaryCare,
      coinsuranceSpecialist: result.coinsuranceSpecialist,
      coinsuranceTelehealth: result.coinsuranceTelehealth,
      coinsuranceLabWork: result.coinsuranceLabWork,
      coinsuranceXray: result.coinsuranceXray,
      coinsuranceAdvancedImaging: result.coinsuranceAdvancedImaging,
      coinsuranceUrgentCare: result.coinsuranceUrgentCare,
      coinsuranceEmergency: result.coinsuranceEmergency,
    });

    sbcLogger.info('SBC extraction details - Rx tiers', {
      rxTier1Copay: result.rxBenefits?.tier1Copay,
      rxTier1Coinsurance: result.rxBenefits?.tier1CoinsurancePercent,
      rxTier2Copay: result.rxBenefits?.tier2Copay,
      rxTier2Coinsurance: result.rxBenefits?.tier2CoinsurancePercent,
      rxTier3Copay: result.rxBenefits?.tier3Copay,
      rxTier3Coinsurance: result.rxBenefits?.tier3CoinsurancePercent,
      rxTier4Copay: result.rxBenefits?.tier4Copay,
      rxTier4Coinsurance: result.rxBenefits?.tier4CoinsurancePercent,
      rxRetailDaysSupply: result.rxBenefits?.retailDaysSupply,
      rxMailOrderDaysSupply: result.rxBenefits?.mailOrderDaysSupply,
    });

    sbcLogger.info('SBC extraction details - Emergency coverage', {
      emergencyRoomCopay: result.emergencyCoverage?.emergencyRoomCopay,
      emergencyRoomCoinsurance: result.emergencyCoverage?.emergencyRoomCoinsurance,
      urgentCareCopay: result.emergencyCoverage?.urgentCareCopay,
      urgentCareCoinsurance: result.emergencyCoverage?.urgentCareCoinsurance,
      ambulanceGroundCopay: result.emergencyCoverage?.ambulanceGroundCopay,
      ambulanceGroundCoinsurance: result.emergencyCoverage?.ambulanceGroundCoinsurance,
      ambulanceAirCopay: result.emergencyCoverage?.ambulanceAirCopay,
      ambulanceAirCoinsurance: result.emergencyCoverage?.ambulanceAirCoinsurance,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle timeout errors
    if (error instanceof Error && (error.name === 'APIConnectionTimeoutError' || errorMessage.includes('timed out'))) {
      sbcLogger.error('Anthropic API request timed out', { errorMessage });
      throw new InternalServerError('AI extraction service timed out. Please try again.');
    }

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
