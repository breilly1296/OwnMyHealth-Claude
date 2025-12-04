import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { InsurancePlan, InsuranceBenefit, InsuranceCost, SBCProcessingResult, CoverageDetails } from '../../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// SBC parsing patterns for different insurance elements
const SBC_PATTERNS = {
  planInfo: {
    planName: /plan\s*name[:\s]+([^\n\r]+)/gi,
    insurer: /insurance\s*company[:\s]+([^\n\r]+)/gi,
    planType: /(hmo|ppo|epo|pos|hdhp|high\s*deductible)/gi,
    effectiveDate: /effective\s*date[:\s]+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/gi
  },
  costs: {
    premium: /premium[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
    deductible: /deductible[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
    outOfPocketMax: /out.of.pocket\s*maximum[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
    copay: /copay[:\s]+\$?([0-9,]+\.?[0-9]*)/gi,
    coinsurance: /coinsurance[:\s]+([0-9]+)%/gi
  },
  benefits: {
    primaryCare: /primary\s*care[:\s]+([^\n\r]+)/gi,
    specialist: /specialist[:\s]+([^\n\r]+)/gi,
    emergency: /emergency\s*room[:\s]+([^\n\r]+)/gi,
    urgentCare: /urgent\s*care[:\s]+([^\n\r]+)/gi,
    preventive: /preventive\s*care[:\s]+([^\n\r]+)/gi,
    labTests: /lab\s*tests?[:\s]+([^\n\r]+)/gi,
    imaging: /imaging[:\s]+([^\n\r]+)/gi,
    xray: /x.ray[:\s]+([^\n\r]+)/gi,
    mri: /mri[:\s]+([^\n\r]+)/gi,
    ctScan: /ct\s*scan[:\s]+([^\n\r]+)/gi,
    ultrasound: /ultrasound[:\s]+([^\n\r]+)/gi,
    mammogram: /mammogram[:\s]+([^\n\r]+)/gi,
    colonoscopy: /colonoscopy[:\s]+([^\n\r]+)/gi,
    prescriptions: /prescription\s*drugs?[:\s]+([^\n\r]+)/gi,
    mentalHealth: /mental\s*health[:\s]+([^\n\r]+)/gi,
    maternity: /maternity[:\s]+([^\n\r]+)/gi,
    surgery: /surgery[:\s]+([^\n\r]+)/gi,
    hospitalStay: /hospital\s*stay[:\s]+([^\n\r]+)/gi
  },
  coverage: {
    covered: /(covered|yes|included)/gi,
    notCovered: /(not\s*covered|no|excluded)/gi,
    copayAmount: /\$([0-9,]+\.?[0-9]*)\s*copay/gi,
    coinsurancePercent: /([0-9]+)%\s*coinsurance/gi,
    deductibleApplies: /deductible\s*applies/gi,
    priorAuth: /prior\s*authorization/gi,
    referralRequired: /referral\s*required/gi
  }
};

// Standard benefit categories and their variations
const BENEFIT_CATEGORIES = {
  'Primary Care': ['primary care', 'pcp', 'family doctor', 'general practitioner'],
  'Specialist Care': ['specialist', 'specialty care', 'specialist visit'],
  'Emergency Care': ['emergency room', 'er', 'emergency care', 'emergency services'],
  'Urgent Care': ['urgent care', 'walk-in clinic'],
  'Preventive Care': ['preventive care', 'wellness', 'annual physical', 'checkup'],
  'Diagnostic Tests': ['diagnostic tests', 'blood work', 'diagnostic procedures'],
  'Imaging': ['imaging', 'radiology', 'medical imaging'],
  'Lab Tests': ['lab tests', 'laboratory', 'blood tests', 'lab work'],
  'Prescription Drugs': ['prescription drugs', 'medications', 'pharmacy', 'prescriptions'],
  'Mental Health': ['mental health', 'behavioral health', 'therapy', 'counseling'],
  'Maternity': ['maternity', 'pregnancy', 'prenatal care', 'delivery'],
  'Surgery': ['surgery', 'surgical procedures', 'operations'],
  'Hospital Stay': ['hospital stay', 'inpatient', 'hospitalization'],
  'Rehabilitation': ['rehabilitation', 'physical therapy', 'occupational therapy']
};

export async function extractTextFromSBC(file: File): Promise<string> {
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

export function parsePlanInformation(text: string): Partial<InsurancePlan> {
  const planInfo: Partial<InsurancePlan> = {};
  
  // Extract plan name
  const planNameMatch = text.match(SBC_PATTERNS.planInfo.planName);
  if (planNameMatch) {
    planInfo.planName = planNameMatch[1].trim();
  }

  // Extract insurer name
  const insurerMatch = text.match(SBC_PATTERNS.planInfo.insurer);
  if (insurerMatch) {
    planInfo.insurerName = insurerMatch[1].trim();
  }

  // Extract plan type
  const planTypeMatch = text.match(SBC_PATTERNS.planInfo.planType);
  if (planTypeMatch) {
    const type = planTypeMatch[0].toUpperCase().replace(/\s+/g, '');
    planInfo.planType = type as InsurancePlan['planType'];
  }

  // Extract effective date
  const effectiveDateMatch = text.match(SBC_PATTERNS.planInfo.effectiveDate);
  if (effectiveDateMatch) {
    planInfo.effectiveDate = effectiveDateMatch[1];
  }

  return planInfo;
}

export function parseCosts(text: string): InsuranceCost[] {
  const costs: InsuranceCost[] = [];

  // Parse premium
  const premiumMatch = text.match(SBC_PATTERNS.costs.premium);
  if (premiumMatch) {
    costs.push({
      id: crypto.randomUUID(),
      type: 'Premium',
      amount: parseFloat(premiumMatch[1].replace(/,/g, '')),
      frequency: 'Monthly',
      description: 'Monthly premium cost',
      appliesTo: 'Individual'
    });
  }

  // Parse deductible
  const deductibleMatch = text.match(SBC_PATTERNS.costs.deductible);
  if (deductibleMatch) {
    costs.push({
      id: crypto.randomUUID(),
      type: 'Deductible',
      amount: parseFloat(deductibleMatch[1].replace(/,/g, '')),
      frequency: 'Annual',
      description: 'Annual deductible amount',
      appliesTo: 'Individual'
    });
  }

  // Parse out-of-pocket maximum
  const oopMaxMatch = text.match(SBC_PATTERNS.costs.outOfPocketMax);
  if (oopMaxMatch) {
    costs.push({
      id: crypto.randomUUID(),
      type: 'Out-of-Pocket Maximum',
      amount: parseFloat(oopMaxMatch[1].replace(/,/g, '')),
      frequency: 'Annual',
      description: 'Annual out-of-pocket maximum',
      appliesTo: 'Individual'
    });
  }

  return costs;
}

export function parseBenefits(text: string): InsuranceBenefit[] {
  const benefits: InsuranceBenefit[] = [];

  Object.entries(BENEFIT_CATEGORIES).forEach(([category, keywords]) => {
    keywords.forEach(keyword => {
      const pattern = new RegExp(`${keyword}[:\\s]+([^\\n\\r]+)`, 'gi');
      const matches = [...text.matchAll(pattern)];
      
      matches.forEach(match => {
        const benefitText = match[1].trim();
        const coverage = parseCoverageDetails(benefitText);
        
        if (coverage.covered !== undefined) {
          benefits.push({
            id: crypto.randomUUID(),
            category: category as InsuranceBenefit['category'],
            serviceName: keyword,
            inNetworkCoverage: coverage,
            description: benefitText,
            priorAuthRequired: /prior\s*authorization/i.test(benefitText),
            referralRequired: /referral\s*required/i.test(benefitText)
          });
        }
      });
    });
  });

  // Remove duplicates based on category and similar coverage
  const uniqueBenefits = benefits.filter((benefit, index, self) => 
    index === self.findIndex(b => 
      b.category === benefit.category && 
      Math.abs((b.inNetworkCoverage.copay || 0) - (benefit.inNetworkCoverage.copay || 0)) < 1
    )
  );

  return uniqueBenefits;
}

export function parseCoverageDetails(text: string): CoverageDetails {
  const coverage: CoverageDetails = {
    covered: true
  };

  // Check if covered
  if (SBC_PATTERNS.coverage.notCovered.test(text)) {
    coverage.covered = false;
    return coverage;
  }

  // Extract copay
  const copayMatch = text.match(SBC_PATTERNS.coverage.copayAmount);
  if (copayMatch) {
    coverage.copay = parseFloat(copayMatch[1].replace(/,/g, ''));
  }

  // Extract coinsurance
  const coinsuranceMatch = text.match(SBC_PATTERNS.coverage.coinsurancePercent);
  if (coinsuranceMatch) {
    coverage.coinsurance = parseFloat(coinsuranceMatch[1]);
    coverage.coveragePercentage = 100 - coverage.coinsurance;
  }

  // Check if deductible applies
  if (SBC_PATTERNS.coverage.deductibleApplies.test(text)) {
    coverage.deductible = 0; // Will be filled from plan-level deductible
  }

  return coverage;
}

export function calculateConfidence(extractedPlan: Partial<InsurancePlan>): number {
  let confidence = 0.5; // Base confidence

  // Increase confidence based on extracted information
  if (extractedPlan.planName) confidence += 0.15;
  if (extractedPlan.insurerName) confidence += 0.15;
  if (extractedPlan.planType) confidence += 0.1;
  if (extractedPlan.benefits && extractedPlan.benefits.length > 5) confidence += 0.1;
  if (extractedPlan.costs && extractedPlan.costs.length > 2) confidence += 0.1;

  return Math.min(confidence, 1.0);
}

export async function processSBCFile(file: File): Promise<SBCProcessingResult> {
  const startTime = Date.now();
  
  try {
    // Extract text from PDF
    const text = await extractTextFromSBC(file);
    
    // Parse different sections
    const planInfo = parsePlanInformation(text);
    const costs = parseCosts(text);
    const benefits = parseBenefits(text);
    
    // Create insurance plan object
    const extractedPlan: InsurancePlan = {
      id: crypto.randomUUID(),
      planName: planInfo.planName || 'Unknown Plan',
      insurerName: planInfo.insurerName || 'Unknown Insurer',
      planType: planInfo.planType || 'Other',
      effectiveDate: planInfo.effectiveDate || new Date().toISOString().split('T')[0],
      uploadDate: new Date().toISOString(),
      sourceFile: file.name,
      extractionConfidence: 0,
      benefits,
      costs,
      limitations: [],
      network: {
        geographicCoverage: ['Unknown']
      }
    };

    // Calculate confidence
    extractedPlan.extractionConfidence = calculateConfidence(extractedPlan);

    const processingTime = Date.now() - startTime;

    // Generate warnings for missing information
    const warnings: string[] = [];
    if (!planInfo.planName) warnings.push('Plan name could not be extracted');
    if (!planInfo.insurerName) warnings.push('Insurance company name could not be extracted');
    if (benefits.length === 0) warnings.push('No benefits information found');
    if (costs.length === 0) warnings.push('No cost information found');

    return {
      success: true,
      extractedPlan,
      processingTime,
      confidence: extractedPlan.extractionConfidence,
      warnings: warnings.length > 0 ? warnings : undefined
    };
    
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error occurred'],
      processingTime: Date.now() - startTime,
      confidence: 0
    };
  }
}

// Utility functions for highlighting key features
export function getKeyPlanFeatures(plan: InsurancePlan): {
  specialistCoverage?: InsuranceBenefit;
  imagingCoverage: InsuranceBenefit[];
  emergencyCoverage?: InsuranceBenefit;
  preventiveCoverage?: InsuranceBenefit;
  prescriptionCoverage?: InsuranceBenefit;
} {
  return {
    specialistCoverage: plan.benefits.find(b => b.category === 'Specialist Care'),
    imagingCoverage: plan.benefits.filter(b => b.category === 'Imaging'),
    emergencyCoverage: plan.benefits.find(b => b.category === 'Emergency Care'),
    preventiveCoverage: plan.benefits.find(b => b.category === 'Preventive Care'),
    prescriptionCoverage: plan.benefits.find(b => b.category === 'Prescription Drugs')
  };
}

export function formatCoverageDisplay(coverage: CoverageDetails): string {
  if (!coverage.covered) return 'Not Covered';
  
  const parts: string[] = [];
  
  if (coverage.copay) {
    parts.push(`$${coverage.copay} copay`);
  }
  
  if (coverage.coinsurance) {
    parts.push(`${coverage.coinsurance}% coinsurance`);
  }
  
  if (coverage.coveragePercentage) {
    parts.push(`${coverage.coveragePercentage}% covered`);
  }
  
  if (coverage.deductible !== undefined) {
    parts.push('after deductible');
  }
  
  return parts.length > 0 ? parts.join(', ') : 'Covered';
}