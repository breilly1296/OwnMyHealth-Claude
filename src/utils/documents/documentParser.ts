import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Enhanced document types
export interface DocumentParsingResult {
  success: boolean;
  documentType: 'SBC' | 'EOB' | 'Plan_Document' | 'Benefits_Summary' | 'Unknown';
  extractedData: ExtractedInsuranceData;
  confidence: number;
  processingTime: number;
  errors?: string[];
  warnings?: string[];
  rawText?: string;
  structuredSections?: DocumentSection[];
}

export interface ExtractedInsuranceData {
  planInformation?: PlanInformation;
  costs?: ExtractedCost[];
  benefits?: ExtractedBenefit[];
  coverage?: CoverageInformation;
  network?: NetworkInformation;
  limitations?: LimitationInformation[];
  keyTerms?: ExtractedTerm[];
  procedures?: ProcedureInformation[];
}

export interface DocumentSection {
  type: 'header' | 'costs' | 'benefits' | 'coverage' | 'network' | 'limitations' | 'footer';
  title: string;
  content: string;
  confidence: number;
  keyTerms: string[];
  structuredData?: Record<string, unknown>;
}

// Type for cost categories used in parsing
type CostCategory = ExtractedCost['category'];

// Helper to map string to cost category
function mapCostCategory(category: string): CostCategory {
  const categoryMap: Record<string, CostCategory> = {
    'individual': 'individual',
    'family': 'family',
    'in_network': 'in_network',
    'out_of_network': 'out_of_network'
  };
  return categoryMap[category] || 'individual';
}

// Type for limitation types
type LimitationType = LimitationInformation['type'];

// Helper to map string to limitation type
function mapLimitationType(limitationType: string): LimitationType {
  const typeMap: Record<string, LimitationType> = {
    'annual': 'annual',
    'lifetime': 'lifetime',
    'per_visit': 'per_visit',
    'per_service': 'per_service'
  };
  return typeMap[limitationType] || 'annual';
}

export interface PlanInformation {
  planName?: string;
  insurerName?: string;
  planType?: string;
  effectiveDate?: string;
  policyNumber?: string;
  groupNumber?: string;
  memberID?: string;
  planYear?: string;
}

export interface ExtractedCost {
  type: 'deductible' | 'premium' | 'out_of_pocket_max' | 'copay' | 'coinsurance';
  category: 'individual' | 'family' | 'in_network' | 'out_of_network';
  amount?: number;
  percentage?: number;
  frequency?: string;
  description: string;
  confidence: number;
  rawText: string;
}

export interface ExtractedBenefit {
  serviceName: string;
  category: string;
  inNetworkCoverage: ExtractedCoverage;
  outOfNetworkCoverage?: ExtractedCoverage;
  priorAuthRequired?: boolean;
  referralRequired?: boolean;
  limitations?: string[];
  confidence: number;
  rawText: string;
}

export interface ExtractedCoverage {
  covered: boolean;
  copay?: number;
  coinsurance?: number;
  deductibleApplies?: boolean;
  coveragePercentage?: number;
  limitations?: string[];
  notes?: string;
}

export interface CoverageInformation {
  inNetworkDeductible?: number;
  outOfNetworkDeductible?: number;
  inNetworkOutOfPocketMax?: number;
  outOfNetworkOutOfPocketMax?: number;
  coinsuranceAfterDeductible?: number;
}

export interface NetworkInformation {
  providerNetworkName?: string;
  geographicCoverage?: string[];
  providerCount?: number;
  hospitalCount?: number;
  pharmacyNetwork?: string;
}

export interface LimitationInformation {
  service: string;
  limitation: string;
  type: 'annual' | 'lifetime' | 'per_visit' | 'per_service';
  value?: number;
  description: string;
}

export interface ExtractedTerm {
  term: string;
  definition: string;
  context: string;
  importance: 'high' | 'medium' | 'low';
  category: 'cost' | 'coverage' | 'network' | 'procedure' | 'limitation';
}

export interface ProcedureInformation {
  procedureName: string;
  cptCode?: string;
  category: string;
  coverage: ExtractedCoverage;
  estimatedCost?: number;
  description: string;
}

// Enhanced pattern matching for insurance documents
const INSURANCE_PATTERNS = {
  // Document type identification
  documentType: {
    sbc: /summary\s+of\s+benefits\s+and\s+coverage|sbc/gi,
    eob: /explanation\s+of\s+benefits|eob/gi,
    planDocument: /plan\s+document|certificate\s+of\s+coverage|member\s+handbook/gi,
    benefitsSummary: /benefits?\s+summary|coverage\s+summary/gi
  },

  // Plan information patterns
  planInfo: {
    planName: /plan\s+name[:\s]+([^\n\r]+)|coverage\s+type[:\s]+([^\n\r]+)/gi,
    insurer: /insurance\s+company[:\s]+([^\n\r]+)|insurer[:\s]+([^\n\r]+)|carrier[:\s]+([^\n\r]+)/gi,
    planType: /(hmo|ppo|epo|pos|hdhp|high\s*deductible\s*health\s*plan)/gi,
    effectiveDate: /effective\s+date[:\s]+([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})/gi,
    policyNumber: /policy\s+number[:\s]+([A-Z0-9-]+)/gi,
    groupNumber: /group\s+number[:\s]+([A-Z0-9-]+)/gi,
    memberID: /member\s+id[:\s]+([A-Z0-9-]+)/gi
  },

  // Cost patterns with enhanced detection
  costs: {
    deductible: {
      individual: /individual\s+deductible[:\s]+\$?([0-9,]+\.?[0-9]*)|deductible\s+\(individual\)[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      family: /family\s+deductible[:\s]+\$?([0-9,]+\.?[0-9]*)|deductible\s+\(family\)[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      inNetwork: /in.network\s+deductible[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      outOfNetwork: /out.of.network\s+deductible[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      general: /deductible[:\s]+\$?([0-9,]+\.?[0-9]*)/gi
    },
    premium: {
      monthly: /monthly\s+premium[:\s]+\$?([0-9,]+\.?[0-9]*)|premium\s+\(monthly\)[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      annual: /annual\s+premium[:\s]+\$?([0-9,]+\.?[0-9]*)|premium\s+\(annual\)[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      general: /premium[:\s]+\$?([0-9,]+\.?[0-9]*)/gi
    },
    outOfPocketMax: {
      individual: /individual\s+out.of.pocket\s+maximum[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      family: /family\s+out.of.pocket\s+maximum[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
      general: /out.of.pocket\s+maximum[:\s]+\$?([0-9,]+\.?[0-9]*)/gi
    },
    copay: /copay[:\s]+\$?([0-9,]+\.?[0-9]*)|co.pay[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
    coinsurance: /coinsurance[:\s]+([0-9]+)%|co.insurance[:\s]+([0-9]+)%/gi
  },

  // Enhanced benefit patterns
  benefits: {
    primaryCare: {
      visit: /primary\s+care\s+visit[:\s]+([^\n\r]+)|pcp\s+visit[:\s]+([^\n\r]+)|family\s+doctor[:\s]+([^\n\r]+)/gi,
      preventive: /preventive\s+care[:\s]+([^\n\r]+)|wellness\s+visit[:\s]+([^\n\r]+)|annual\s+physical[:\s]+([^\n\r]+)/gi
    },
    specialist: {
      visit: /specialist\s+visit[:\s]+([^\n\r]+)|specialty\s+care[:\s]+([^\n\r]+)/gi,
      consultation: /specialist\s+consultation[:\s]+([^\n\r]+)/gi
    },
    emergency: {
      room: /emergency\s+room[:\s]+([^\n\r]+)|er\s+visit[:\s]+([^\n\r]+)|emergency\s+care[:\s]+([^\n\r]+)/gi,
      services: /emergency\s+services[:\s]+([^\n\r]+)/gi
    },
    urgentCare: /urgent\s+care[:\s]+([^\n\r]+)|walk.in\s+clinic[:\s]+([^\n\r]+)/gi,
    imaging: {
      xray: /x.ray[:\s]+([^\n\r]+)|radiography[:\s]+([^\n\r]+)/gi,
      mri: /mri[:\s]+([^\n\r]+)|magnetic\s+resonance[:\s]+([^\n\r]+)/gi,
      ctScan: /ct\s+scan[:\s]+([^\n\r]+)|computed\s+tomography[:\s]+([^\n\r]+)/gi,
      ultrasound: /ultrasound[:\s]+([^\n\r]+)|sonography[:\s]+([^\n\r]+)/gi,
      mammogram: /mammogram[:\s]+([^\n\r]+)|breast\s+imaging[:\s]+([^\n\r]+)/gi,
      general: /imaging[:\s]+([^\n\r]+)|radiology[:\s]+([^\n\r]+)/gi
    },
    labTests: {
      bloodWork: /blood\s+work[:\s]+([^\n\r]+)|blood\s+tests?[:\s]+([^\n\r]+)/gi,
      labTests: /lab\s+tests?[:\s]+([^\n\r]+)|laboratory[:\s]+([^\n\r]+)/gi,
      diagnosticTests: /diagnostic\s+tests?[:\s]+([^\n\r]+)/gi
    },
    procedures: {
      surgery: /surgery[:\s]+([^\n\r]+)|surgical\s+procedures?[:\s]+([^\n\r]+)/gi,
      outpatient: /outpatient\s+procedures?[:\s]+([^\n\r]+)/gi,
      inpatient: /inpatient\s+procedures?[:\s]+([^\n\r]+)/gi
    },
    prescriptions: {
      generic: /generic\s+drugs?[:\s]+([^\n\r]+)|generic\s+medications?[:\s]+([^\n\r]+)/gi,
      brandName: /brand\s+name\s+drugs?[:\s]+([^\n\r]+)|brand\s+medications?[:\s]+([^\n\r]+)/gi,
      specialty: /specialty\s+drugs?[:\s]+([^\n\r]+)|specialty\s+medications?[:\s]+([^\n\r]+)/gi,
      general: /prescription\s+drugs?[:\s]+([^\n\r]+)|medications?[:\s]+([^\n\r]+)/gi
    },
    mentalHealth: /mental\s+health[:\s]+([^\n\r]+)|behavioral\s+health[:\s]+([^\n\r]+)|therapy[:\s]+([^\n\r]+)/gi,
    maternity: /maternity[:\s]+([^\n\r]+)|pregnancy[:\s]+([^\n\r]+)|prenatal\s+care[:\s]+([^\n\r]+)/gi,
    hospitalStay: /hospital\s+stay[:\s]+([^\n\r]+)|inpatient\s+care[:\s]+([^\n\r]+)|hospitalization[:\s]+([^\n\r]+)/gi
  },

  // Coverage detail patterns
  coverage: {
    covered: /(covered|yes|included|100%\s*covered)/gi,
    notCovered: /(not\s*covered|no|excluded|0%\s*covered)/gi,
    copayAmount: /\$([0-9,]+\.?[0-9]*)\s*copay|copay\s*\$([0-9,]+\.?[0-9]*)/gi,
    coinsurancePercent: /([0-9]+)%\s*coinsurance|coinsurance\s*([0-9]+)%/gi,
    deductibleApplies: /deductible\s*applies|subject\s*to\s*deductible|after\s*deductible/gi,
    priorAuth: /prior\s*authorization|pre.authorization|pa\s*required/gi,
    referralRequired: /referral\s*required|requires?\s*referral/gi,
    noCharge: /no\s*charge|free|$0/gi,
    percentageCovered: /([0-9]+)%\s*covered|covered\s*at\s*([0-9]+)%/gi
  },

  // Network and limitation patterns
  network: {
    inNetwork: /in.network|preferred\s*provider|participating\s*provider/gi,
    outOfNetwork: /out.of.network|non.preferred|non.participating/gi,
    networkName: /network\s*name[:\s]+([^\n\r]+)|provider\s*network[:\s]+([^\n\r]+)/gi
  },

  limitations: {
    annual: /annual\s*limit[:\s]+([^\n\r]+)|per\s*year\s*limit[:\s]+([^\n\r]+)/gi,
    lifetime: /lifetime\s*limit[:\s]+([^\n\r]+)|lifetime\s*maximum[:\s]+([^\n\r]+)/gi,
    perVisit: /per\s*visit\s*limit[:\s]+([^\n\r]+)|visit\s*limit[:\s]+([^\n\r]+)/gi,
    waiting: /waiting\s*period[:\s]+([^\n\r]+)|waiting\s*time[:\s]+([^\n\r]+)/gi
  }
};

// Key insurance terms for NLP extraction
const INSURANCE_KEY_TERMS = {
  'Deductible': {
    keywords: ['deductible', 'annual deductible', 'plan deductible'],
    importance: 'high',
    category: 'cost'
  },
  'Coinsurance': {
    keywords: ['coinsurance', 'co-insurance', 'percentage you pay'],
    importance: 'high',
    category: 'cost'
  },
  'Copay': {
    keywords: ['copay', 'co-pay', 'copayment', 'fixed amount'],
    importance: 'high',
    category: 'cost'
  },
  'Out-of-Pocket Maximum': {
    keywords: ['out-of-pocket maximum', 'annual limit', 'maximum you pay'],
    importance: 'high',
    category: 'cost'
  },
  'Premium': {
    keywords: ['premium', 'monthly payment', 'plan cost'],
    importance: 'high',
    category: 'cost'
  },
  'Prior Authorization': {
    keywords: ['prior authorization', 'pre-authorization', 'approval required'],
    importance: 'medium',
    category: 'procedure'
  },
  'Formulary': {
    keywords: ['formulary', 'drug list', 'covered medications'],
    importance: 'medium',
    category: 'coverage'
  },
  'Network Provider': {
    keywords: ['in-network', 'preferred provider', 'participating provider'],
    importance: 'high',
    category: 'network'
  },
  'Specialist Visit': {
    keywords: ['specialist visit', 'specialty care', 'specialist consultation'],
    importance: 'high',
    category: 'coverage'
  },
  'Imaging Services': {
    keywords: ['imaging', 'radiology', 'x-ray', 'mri', 'ct scan', 'ultrasound'],
    importance: 'high',
    category: 'coverage'
  },
  'Laboratory Tests': {
    keywords: ['lab tests', 'laboratory', 'blood work', 'diagnostic tests'],
    importance: 'high',
    category: 'coverage'
  }
};

// Enhanced text extraction with OCR fallback
export async function extractTextFromDocument(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    return await extractTextFromPDF(file);
  } else if (file.type.startsWith('image/')) {
    return await performOCR(file);
  } else {
    throw new Error('Unsupported file type');
  }
}

async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item): item is TextItem => 'str' in item)
      .map((item) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

async function performOCR(file: File): Promise<string> {
  const worker = await createWorker('eng');
  
  try {
    const { data: { text } } = await worker.recognize(file);
    return text;
  } finally {
    await worker.terminate();
  }
}

// Document type detection using NLP
export function detectDocumentType(text: string, fileName: string): 'SBC' | 'EOB' | 'Plan_Document' | 'Benefits_Summary' | 'Unknown' {
  const lowerText = text.toLowerCase();
  const lowerFileName = fileName.toLowerCase();

  // Check filename first
  if (lowerFileName.includes('sbc') || lowerFileName.includes('summary of benefits')) {
    return 'SBC';
  }
  if (lowerFileName.includes('eob') || lowerFileName.includes('explanation of benefits')) {
    return 'EOB';
  }

  // Check content patterns
  if (INSURANCE_PATTERNS.documentType.sbc.test(lowerText)) {
    return 'SBC';
  }
  if (INSURANCE_PATTERNS.documentType.eob.test(lowerText)) {
    return 'EOB';
  }
  if (INSURANCE_PATTERNS.documentType.planDocument.test(lowerText)) {
    return 'Plan_Document';
  }
  if (INSURANCE_PATTERNS.documentType.benefitsSummary.test(lowerText)) {
    return 'Benefits_Summary';
  }

  return 'Unknown';
}

// Enhanced structured data extraction
export function extractStructuredData(text: string, _documentType: string): ExtractedInsuranceData {
  const extractedData: ExtractedInsuranceData = {
    costs: [],
    benefits: [],
    keyTerms: [],
    procedures: []
  };

  // Extract plan information
  extractedData.planInformation = extractPlanInformation(text);

  // Extract costs with enhanced patterns
  extractedData.costs = extractCosts(text);

  // Extract benefits with detailed coverage
  extractedData.benefits = extractBenefits(text);

  // Extract coverage information
  extractedData.coverage = extractCoverageInformation(text);

  // Extract network information
  extractedData.network = extractNetworkInformation(text);

  // Extract limitations
  extractedData.limitations = extractLimitations(text);

  // Extract key terms using NLP
  extractedData.keyTerms = extractKeyTerms(text);

  // Extract procedure information
  extractedData.procedures = extractProcedures(text);

  return extractedData;
}

function extractPlanInformation(text: string): PlanInformation {
  const planInfo: PlanInformation = {};

  // Extract plan name
  const planNameMatch = text.match(INSURANCE_PATTERNS.planInfo.planName);
  if (planNameMatch) {
    planInfo.planName = (planNameMatch[1] || planNameMatch[2])?.trim();
  }

  // Extract insurer name
  const insurerMatch = text.match(INSURANCE_PATTERNS.planInfo.insurer);
  if (insurerMatch) {
    planInfo.insurerName = (insurerMatch[1] || insurerMatch[2] || insurerMatch[3])?.trim();
  }

  // Extract plan type
  const planTypeMatch = text.match(INSURANCE_PATTERNS.planInfo.planType);
  if (planTypeMatch) {
    planInfo.planType = planTypeMatch[0].toUpperCase().replace(/\s+/g, '');
  }

  // Extract effective date
  const effectiveDateMatch = text.match(INSURANCE_PATTERNS.planInfo.effectiveDate);
  if (effectiveDateMatch) {
    planInfo.effectiveDate = effectiveDateMatch[1];
  }

  // Extract policy number
  const policyMatch = text.match(INSURANCE_PATTERNS.planInfo.policyNumber);
  if (policyMatch) {
    planInfo.policyNumber = policyMatch[1];
  }

  // Extract group number
  const groupMatch = text.match(INSURANCE_PATTERNS.planInfo.groupNumber);
  if (groupMatch) {
    planInfo.groupNumber = groupMatch[1];
  }

  // Extract member ID
  const memberMatch = text.match(INSURANCE_PATTERNS.planInfo.memberID);
  if (memberMatch) {
    planInfo.memberID = memberMatch[1];
  }

  return planInfo;
}

function extractCosts(text: string): ExtractedCost[] {
  const costs: ExtractedCost[] = [];

  // Extract deductibles
  Object.entries(INSURANCE_PATTERNS.costs.deductible).forEach(([category, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const amount = parseFloat((match[1] || match[2])?.replace(/,/g, '') || '0');
      if (amount > 0) {
        costs.push({
          type: 'deductible',
          category: mapCostCategory(category),
          amount,
          description: `${category} deductible`,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  // Extract premiums
  Object.entries(INSURANCE_PATTERNS.costs.premium).forEach(([frequency, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const amount = parseFloat((match[1] || match[2])?.replace(/,/g, '') || '0');
      if (amount > 0) {
        costs.push({
          type: 'premium',
          category: 'individual',
          amount,
          frequency,
          description: `${frequency} premium`,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  // Extract out-of-pocket maximums
  Object.entries(INSURANCE_PATTERNS.costs.outOfPocketMax).forEach(([category, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const amount = parseFloat((match[1])?.replace(/,/g, '') || '0');
      if (amount > 0) {
        costs.push({
          type: 'out_of_pocket_max',
          category: mapCostCategory(category),
          amount,
          description: `${category} out-of-pocket maximum`,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  // Extract copays
  const copayMatches = [...text.matchAll(INSURANCE_PATTERNS.costs.copay)];
  copayMatches.forEach(match => {
    const amount = parseFloat((match[1] || match[2])?.replace(/,/g, '') || '0');
    if (amount > 0) {
      costs.push({
        type: 'copay',
        category: 'individual',
        amount,
        description: 'Copay amount',
        confidence: calculatePatternConfidence(match[0]),
        rawText: match[0]
      });
    }
  });

  // Extract coinsurance
  const coinsuranceMatches = [...text.matchAll(INSURANCE_PATTERNS.costs.coinsurance)];
  coinsuranceMatches.forEach(match => {
    const percentage = parseFloat(match[1] || match[2] || '0');
    if (percentage > 0) {
      costs.push({
        type: 'coinsurance',
        category: 'individual',
        percentage,
        description: 'Coinsurance percentage',
        confidence: calculatePatternConfidence(match[0]),
        rawText: match[0]
      });
    }
  });

  return costs;
}

function extractBenefits(text: string): ExtractedBenefit[] {
  const benefits: ExtractedBenefit[] = [];

  // Extract primary care benefits
  Object.entries(INSURANCE_PATTERNS.benefits.primaryCare).forEach(([subType, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const benefitText = (match[1] || match[2])?.trim();
      if (benefitText) {
        const coverage = parseCoverageFromText(benefitText);
        benefits.push({
          serviceName: `Primary Care - ${subType}`,
          category: 'Primary Care',
          inNetworkCoverage: coverage,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  // Extract specialist benefits
  Object.entries(INSURANCE_PATTERNS.benefits.specialist).forEach(([subType, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const benefitText = (match[1] || match[2])?.trim();
      if (benefitText) {
        const coverage = parseCoverageFromText(benefitText);
        benefits.push({
          serviceName: `Specialist - ${subType}`,
          category: 'Specialist Care',
          inNetworkCoverage: coverage,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  // Extract imaging benefits
  Object.entries(INSURANCE_PATTERNS.benefits.imaging).forEach(([imageType, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const benefitText = (match[1] || match[2])?.trim();
      if (benefitText) {
        const coverage = parseCoverageFromText(benefitText);
        benefits.push({
          serviceName: imageType.toUpperCase(),
          category: 'Imaging',
          inNetworkCoverage: coverage,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  // Extract lab test benefits
  Object.entries(INSURANCE_PATTERNS.benefits.labTests).forEach(([labType, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const benefitText = (match[1] || match[2])?.trim();
      if (benefitText) {
        const coverage = parseCoverageFromText(benefitText);
        benefits.push({
          serviceName: `Lab Tests - ${labType}`,
          category: 'Lab Tests',
          inNetworkCoverage: coverage,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  // Extract prescription benefits
  Object.entries(INSURANCE_PATTERNS.benefits.prescriptions).forEach(([drugType, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const benefitText = (match[1] || match[2])?.trim();
      if (benefitText) {
        const coverage = parseCoverageFromText(benefitText);
        benefits.push({
          serviceName: `Prescriptions - ${drugType}`,
          category: 'Prescription Drugs',
          inNetworkCoverage: coverage,
          confidence: calculatePatternConfidence(match[0]),
          rawText: match[0]
        });
      }
    });
  });

  return benefits;
}

function parseCoverageFromText(text: string): ExtractedCoverage {
  const coverage: ExtractedCoverage = {
    covered: true
  };

  // Check if not covered
  if (INSURANCE_PATTERNS.coverage.notCovered.test(text)) {
    coverage.covered = false;
    return coverage;
  }

  // Extract copay
  const copayMatch = text.match(INSURANCE_PATTERNS.coverage.copayAmount);
  if (copayMatch) {
    coverage.copay = parseFloat((copayMatch[1] || copayMatch[2])?.replace(/,/g, '') || '0');
  }

  // Extract coinsurance
  const coinsuranceMatch = text.match(INSURANCE_PATTERNS.coverage.coinsurancePercent);
  if (coinsuranceMatch) {
    coverage.coinsurance = parseFloat(coinsuranceMatch[1] || coinsuranceMatch[2] || '0');
  }

  // Extract coverage percentage
  const percentageMatch = text.match(INSURANCE_PATTERNS.coverage.percentageCovered);
  if (percentageMatch) {
    coverage.coveragePercentage = parseFloat(percentageMatch[1] || percentageMatch[2] || '0');
  }

  // Check if deductible applies
  if (INSURANCE_PATTERNS.coverage.deductibleApplies.test(text)) {
    coverage.deductibleApplies = true;
  }

  // Check for no charge
  if (INSURANCE_PATTERNS.coverage.noCharge.test(text)) {
    coverage.copay = 0;
    coverage.coinsurance = 0;
    coverage.coveragePercentage = 100;
  }

  return coverage;
}

function extractCoverageInformation(text: string): CoverageInformation {
  const coverage: CoverageInformation = {};

  // Extract deductible information
  const inNetworkDeductibleMatch = text.match(INSURANCE_PATTERNS.costs.deductible.inNetwork);
  if (inNetworkDeductibleMatch) {
    coverage.inNetworkDeductible = parseFloat(inNetworkDeductibleMatch[1]?.replace(/,/g, '') || '0');
  }

  const outOfNetworkDeductibleMatch = text.match(INSURANCE_PATTERNS.costs.deductible.outOfNetwork);
  if (outOfNetworkDeductibleMatch) {
    coverage.outOfNetworkDeductible = parseFloat(outOfNetworkDeductibleMatch[1]?.replace(/,/g, '') || '0');
  }

  return coverage;
}

function extractNetworkInformation(text: string): NetworkInformation {
  const network: NetworkInformation = {};

  const networkNameMatch = text.match(INSURANCE_PATTERNS.network.networkName);
  if (networkNameMatch) {
    network.providerNetworkName = (networkNameMatch[1] || networkNameMatch[2])?.trim();
  }

  return network;
}

function extractLimitations(text: string): LimitationInformation[] {
  const limitations: LimitationInformation[] = [];

  Object.entries(INSURANCE_PATTERNS.limitations).forEach(([limitationType, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const limitationText = (match[1])?.trim();
      if (limitationText) {
        limitations.push({
          service: 'General',
          limitation: limitationText,
          type: mapLimitationType(limitationType),
          description: `${limitationType} limitation: ${limitationText}`
        });
      }
    });
  });

  return limitations;
}

function extractKeyTerms(text: string): ExtractedTerm[] {
  const terms: ExtractedTerm[] = [];

  Object.entries(INSURANCE_KEY_TERMS).forEach(([termName, termInfo]) => {
    termInfo.keywords.forEach(keyword => {
      const regex = new RegExp(`(${keyword})[:\\s]+([^\\n\\r]{1,200})`, 'gi');
      const matches = [...text.matchAll(regex)];
      
      matches.forEach(match => {
        const context = match[2]?.trim();
        if (context && context.length > 10) {
          terms.push({
            term: termName,
            definition: generateDefinition(termName),
            context,
            importance: termInfo.importance,
            category: termInfo.category
          });
        }
      });
    });
  });

  return terms;
}

function extractProcedures(text: string): ProcedureInformation[] {
  const procedures: ProcedureInformation[] = [];

  Object.entries(INSURANCE_PATTERNS.benefits.procedures).forEach(([procedureType, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const procedureText = (match[1])?.trim();
      if (procedureText) {
        const coverage = parseCoverageFromText(procedureText);
        procedures.push({
          procedureName: procedureType,
          category: 'Surgical Procedures',
          coverage,
          description: procedureText
        });
      }
    });
  });

  return procedures;
}

function calculatePatternConfidence(matchText: string): number {
  let confidence = 0.7; // Base confidence

  // Increase confidence for specific patterns
  if (/\$[0-9,]+/.test(matchText)) confidence += 0.1;
  if (/[0-9]+%/.test(matchText)) confidence += 0.1;
  if (/covered|not covered/i.test(matchText)) confidence += 0.1;

  return Math.min(confidence, 1.0);
}

function generateDefinition(termName: string): string {
  const definitions: Record<string, string> = {
    'Deductible': 'The amount you pay for covered health care services before your insurance plan starts to pay.',
    'Coinsurance': 'The percentage of costs of a covered health care service you pay after you\'ve paid your deductible.',
    'Copay': 'A fixed amount you pay for a covered health care service after you\'ve paid your deductible.',
    'Out-of-Pocket Maximum': 'The most you have to pay for covered services in a plan year.',
    'Premium': 'The amount you pay for your health insurance every month.',
    'Prior Authorization': 'A decision by your health insurer that a health care service is medically necessary.',
    'Formulary': 'A list of prescription drugs covered by a prescription drug plan.',
    'Network Provider': 'A provider who has a contract with your health insurer to provide services to you at a discount.',
    'Specialist Visit': 'A visit to a doctor who specializes in a particular area of medicine.',
    'Imaging Services': 'Tests that create pictures of areas inside your body.',
    'Laboratory Tests': 'Medical tests performed on samples of blood, urine, or other body fluids.'
  };

  return definitions[termName] || 'Insurance-related term requiring definition.';
}

// Main parsing function
export async function parseInsuranceDocument(file: File): Promise<DocumentParsingResult> {
  const startTime = Date.now();
  
  try {
    // Extract text from document
    const rawText = await extractTextFromDocument(file);
    
    // Detect document type
    const documentType = detectDocumentType(rawText, file.name);
    
    // Extract structured data
    const extractedData = extractStructuredData(rawText, documentType);
    
    // Calculate overall confidence
    const confidence = calculateOverallConfidence(extractedData);
    
    const processingTime = Date.now() - startTime;

    // Generate warnings
    const warnings: string[] = [];
    if (!extractedData.planInformation?.planName) {
      warnings.push('Plan name could not be extracted');
    }
    if (!extractedData.costs || extractedData.costs.length === 0) {
      warnings.push('No cost information found');
    }
    if (!extractedData.benefits || extractedData.benefits.length === 0) {
      warnings.push('No benefits information found');
    }

    return {
      success: true,
      documentType,
      extractedData,
      confidence,
      processingTime,
      rawText,
      warnings: warnings.length > 0 ? warnings : undefined
    };
    
  } catch (error) {
    return {
      success: false,
      documentType: 'Unknown',
      extractedData: {},
      confidence: 0,
      processingTime: Date.now() - startTime,
      errors: [error instanceof Error ? error.message : 'Unknown error occurred']
    };
  }
}

function calculateOverallConfidence(data: ExtractedInsuranceData): number {
  let confidence = 0.5; // Base confidence

  if (data.planInformation?.planName) {
    confidence += 0.15;
  }
  if (data.planInformation?.insurerName) {
    confidence += 0.15;
  }
  if (data.costs && data.costs.length > 0) {
    confidence += 0.2;
  }
  if (data.benefits && data.benefits.length > 0) {
    confidence += 0.2;
  }
  if (data.keyTerms && data.keyTerms.length > 0) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}