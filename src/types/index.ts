export interface BiomarkerHistory {
  date: string;
  value: number;
  notes?: string;
}

export interface NormalRange {
  min: number;
  max: number;
  source: string;
}

/**
 * Per-analyte trend directionality (DV-3/JC-2). A property of the analyte type,
 * resolved by name via src/data/biomarkerDirections.ts — NOT stored on a row.
 */
export type BiomarkerDirection =
  | 'higherIsBetter'
  | 'lowerIsBetter'
  | 'targetBand'
  | 'unknown';

/** Result of the centralized, direction-aware biomarker trend classifier. */
export interface TrendClassification {
  /** Clinical reading of the change (color is driven by this, not by the arrow). */
  status: 'improving' | 'worsening' | 'stable' | 'insufficient';
  /** Signed % change oldest→newest, or null when not computable. */
  magnitudePct: number | null;
  /** Raw movement for the glyph only — decoupled from good/bad. */
  direction: 'up' | 'down' | 'flat';
}

// Biomarker category type - all supported categories (24 total)
export type BiomarkerCategoryType =
  // Core categories
  | 'Body Composition'
  | 'Blood'
  | 'Hormones'
  | 'Vitamins'
  | 'Vital Signs'
  | 'Lipids'
  | 'Electrolytes'
  // Organ function
  | 'Kidney Function'
  | 'Liver Function'
  | 'Thyroid'
  | 'Cardiac'
  | 'Pancreatic'
  // Specialized panels
  | 'Diabetes'
  | 'Iron Studies'
  | 'Bone Health'
  | 'Coagulation'
  | 'Inflammation Markers'
  | 'Autoimmune'
  // Diagnostic categories
  | 'Tumor Markers'
  | 'Infectious Disease'
  | 'Urinalysis'
  | 'Blood Gas'
  | 'Allergy'
  | 'Genetic'
  // Legacy/Other
  | 'Calcium CT'
  | 'EKG'
  | 'Other';

export interface Biomarker {
  id: string;
  name: string;
  value: number;
  unit: string;
  date: string;
  category: BiomarkerCategoryType;
  normalRange: NormalRange;
  description?: string;
  notes?: string;
  history?: BiomarkerHistory[];
  sourceFile?: string;
  extractionConfidence?: number;
}

export interface BiomarkerCategory {
  name: string;
  description: string;
  icon: string;
  group?: 'overview' | 'files' | 'insurance' | 'biomarkers' | 'care' | 'admin';
  /** Optional role gate — when set, only users with one of these roles see
   *  this nav item. Omitted → visible to everyone. */
  roles?: string[];
}

export interface NavGroup {
  id: 'overview' | 'files' | 'insurance' | 'biomarkers' | 'care' | 'admin';
  label: string;
  icon: string;
  collapsible: boolean;
}

export interface MeasurementOption {
  name: string;
  unit: string;
  normalRange: NormalRange;
  description: string;
}

export interface ClinicalFile {
  id: string;
  name: string;
  type: 'DEXA' | 'EKG' | 'Lab Report' | 'Other';
  uploadDate: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  extractedData?: ExtractedData[];
  originalFileName: string;
  fileSize: number;
}

export interface ExtractedData {
  biomarkerName: string;
  value: number;
  unit: string;
  confidence: number;
  rawText: string;
  category: string;
  normalRange?: NormalRange;
}

export interface ProcessingResult {
  success: boolean;
  extractedBiomarkers: Partial<Biomarker>[];
  errors?: string[];
  processingTime: number;
  confidence: number;
}

// User File Types
export interface UserFile {
  id: string;
  filename: string;
  originalFilename: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  labName: string | null;
  labDate: string | null;
  biomarkersExtracted: number;
  extractionConfidence: number | null;
  categories: string[];
  createdAt: string;
}

// Insurance SBC Types
export interface InsurancePlan {
  id: string;
  planName: string;
  insurerName: string;
  planType: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP' | 'Other';
  planIdNumber?: string;
  effectiveDate: string;
  terminationDate?: string;
  // Optional: only locally SBC-parsed plans carry these; API-fetched plans
  // (InsurancePlanData) don't. Previously required, which forced
  // `as unknown as InsurancePlan` casts on every API-sourced plan.
  uploadDate?: string;
  sourceFile?: string;
  extractionConfidence?: number;

  // Core financial fields
  deductibleIndividual?: number;
  deductibleFamily?: number;
  oopMaxIndividual?: number;
  oopMaxFamily?: number;
  premiumMonthly?: number;

  // Tracking fields (how much has been paid toward limits)
  deductibleMetIndividual?: number;
  deductibleMetFamily?: number;
  oopMetIndividual?: number;
  oopMetFamily?: number;

  // Core copay amounts
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  copayTelehealth?: number;
  copayLabWork?: number;
  copayXray?: number;
  copayAdvancedImaging?: number;
  coinsuranceRate?: number;

  // Per-service coinsurance (for plans with "X% after deductible" instead of copays)
  coinsurancePrimaryCare?: number;
  coinsuranceSpecialist?: number;
  coinsuranceUrgentCare?: number;
  coinsuranceEmergency?: number;
  coinsuranceTelehealth?: number;
  coinsuranceLabWork?: number;
  coinsuranceXray?: number;
  coinsuranceAdvancedImaging?: number;

  // Inpatient coverage
  inpatientHospitalCopay?: number;
  inpatientHospitalCoinsurance?: number;
  inpatientMentalHealthCopay?: number;
  inpatientMentalCoinsurance?: number;
  maternityCopay?: number;
  maternityCoinsurance?: number;
  skilledNursingCopay?: number;
  skilledNursingCoinsurance?: number;
  skilledNursingDaysLimit?: number;

  // Outpatient coverage
  outpatientSurgeryCopay?: number;
  outpatientSurgeryCoinsurance?: number;
  outpatientMentalHealthCopay?: number;
  outpatientMentalCoinsurance?: number;

  // Therapy/Rehab coverage
  physicalTherapyCopay?: number;
  physicalTherapyVisitsLimit?: number;
  occupationalTherapyCopay?: number;
  occupationalTherapyVisitsLimit?: number;
  speechTherapyCopay?: number;
  speechTherapyVisitsLimit?: number;
  chiropracticCopay?: number;
  chiropracticVisitsLimit?: number;
  acupunctureCopay?: number;
  acupunctureVisitsLimit?: number;
  cardiacRehabCopay?: number;
  cardiacRehabVisitsLimit?: number;
  pulmonaryRehabCopay?: number;
  pulmonaryRehabVisitsLimit?: number;

  // Prescription (Rx) benefits
  rxTier1Copay?: number;
  rxTier2Copay?: number;
  rxTier3Copay?: number;
  rxTier4Copay?: number;
  rxTier1Coinsurance?: number;
  rxTier2Coinsurance?: number;
  rxTier3Coinsurance?: number;
  rxTier4Coinsurance?: number;
  rxRetailDaysSupply?: number;
  rxMailOrderDaysSupply?: number;
  rxDeductibleIndividual?: number;
  rxDeductibleFamily?: number;
  rxOopMaxIndividual?: number;
  rxOopMaxFamily?: number;

  // Emergency/Ambulance coverage
  ambulanceGroundCopay?: number;
  ambulanceGroundCoinsurance?: number;
  ambulanceAirCopay?: number;
  ambulanceAirCoinsurance?: number;

  // Vision coverage
  visionExamCopay?: number;
  visionExamFrequency?: string;
  visionLensesAllowance?: number;
  visionFramesAllowance?: number;
  visionContactsAllowance?: number;

  // Dental coverage
  dentalPreventiveCoinsurance?: number;
  dentalBasicCoinsurance?: number;
  dentalMajorCoinsurance?: number;
  dentalAnnualMax?: number;
  dentalDeductible?: number;
  dentalOrthodontiaCoinsurance?: number;
  dentalOrthodontiaLifetimeMax?: number;

  // DME coverage
  dmeCopay?: number;
  dmeCoinsurance?: number;

  // Home Health coverage
  homeHealthVisitCopay?: number;
  homeHealthVisitCoinsurance?: number;
  homeHealthVisitLimit?: number;

  // Hospice coverage
  hospiceInpatientCopay?: number;
  hospiceInpatientCoinsurance?: number;
  hospiceRespiteCopay?: number;
  hospiceRespiteCoinsurance?: number;
  hospiceRespiteDayLimit?: number;

  // JSON list fields (parsed from strings)
  preventiveServicesList?: string[];
  exclusionsList?: string[];
  priorAuthRequirements?: string[];
  servicesWithLimits?: ServiceLimit[];

  // Source tracking
  extractedFromSbc?: boolean;
  sbcExtractionConfidence?: number;

  // Legacy fields for backwards compatibility
  benefits: InsuranceBenefit[];
  costs: InsuranceCost[];
  limitations: InsuranceLimitation[];
  network: NetworkInfo;
}

export interface ServiceLimit {
  service: string;
  limit: number;
  limitType: 'visits' | 'days' | 'dollars' | 'lifetime';
  period: 'per year' | 'per admission' | 'lifetime' | 'per occurrence';
}

export interface InsuranceBenefit {
  id: string;
  category: 'Primary Care' | 'Specialist Care' | 'Emergency Care' | 'Urgent Care' | 
           'Preventive Care' | 'Diagnostic Tests' | 'Imaging' | 'Lab Tests' | 
           'Prescription Drugs' | 'Mental Health' | 'Maternity' | 'Surgery' | 
           'Hospital Stay' | 'Rehabilitation' | 'Other';
  serviceName: string;
  inNetworkCoverage: CoverageDetails;
  outOfNetworkCoverage?: CoverageDetails;
  description: string;
  notes?: string;
  priorAuthRequired?: boolean;
  referralRequired?: boolean;
}

export interface CoverageDetails {
  copay?: number;
  coinsurance?: number;
  deductible?: number;
  outOfPocketMax?: number;
  covered: boolean;
  coveragePercentage?: number;
  limitations?: string[];
}

export interface InsuranceCost {
  id: string;
  type: 'Premium' | 'Deductible' | 'Out-of-Pocket Maximum' | 'Copay' | 'Coinsurance';
  amount: number;
  frequency?: 'Monthly' | 'Annual' | 'Per Visit' | 'Per Service';
  description: string;
  appliesTo: 'Individual' | 'Family' | 'In-Network' | 'Out-of-Network';
}

export interface InsuranceLimitation {
  id: string;
  category: string;
  description: string;
  limitType: 'Annual' | 'Lifetime' | 'Per Visit' | 'Per Service';
  limitValue?: number;
  exceptions?: string[];
}

export interface NetworkInfo {
  providerCount?: number;
  hospitalCount?: number;
  specialtyCount?: number;
  geographicCoverage: string[];
  networkName?: string;
}

export interface SBCProcessingResult {
  success: boolean;
  extractedPlan?: InsurancePlan;
  errors?: string[];
  processingTime: number;
  confidence: number;
  warnings?: string[];
}

export interface InsuranceComparison {
  plans: InsurancePlan[];
  comparisonMetrics: ComparisonMetric[];
  recommendations: string[];
}

export interface ComparisonMetric {
  category: string;
  planComparisons: {
    planId: string;
    value: string | number;
    rating: 'excellent' | 'good' | 'fair' | 'poor';
  }[];
}

// Insurance Education Types
export interface InsuranceTermExplanation {
  term: string;
  definition: string;
  contextualExample: string;
  userSpecificExample?: string;
  relatedTerms: string[];
  tips: string[];
  commonMisconceptions: string[];
}

export interface InsuranceEducationModule {
  id: string;
  title: string;
  description: string;
  terms: InsuranceTermExplanation[];
  scenarios: InsuranceScenario[];
  recommendations: string[];
}

export interface InsuranceScenario {
  id: string;
  title: string;
  description: string;
  userSituation: string;
  costBreakdown: CostBreakdownItem[];
  keyLearnings: string[];
  actionItems: string[];
}

export interface CostBreakdownItem {
  service: string;
  originalCost: number;
  yourCost: number;
  explanation: string;
  insuranceCovers: number;
  whyThisCost: string;
}

export interface PersonalizedInsuranceGuide {
  userProfile: {
    detectedConditions: string[];
    recommendedServices: string[];
    riskFactors: string[];
    currentPlans: string[];
  };
  educationModules: InsuranceEducationModule[];
  costProjections: AnnualCostProjection[];
  optimizationTips: InsuranceOptimizationTip[];
  glossary: InsuranceTermExplanation[];
}

export interface AnnualCostProjection {
  scenario: string;
  description: string;
  estimatedCosts: {
    premiums: number;
    deductibles: number;
    copays: number;
    coinsurance: number;
    outOfPocket: number;
    total: number;
  };
  breakdown: CostBreakdownItem[];
}

export interface InsuranceOptimizationTip {
  id: string;
  category: 'Cost Savings' | 'Coverage Optimization' | 'Network Usage' | 'Preventive Care';
  title: string;
  description: string;
  potentialSavings?: number;
  difficulty: 'Easy' | 'Moderate' | 'Advanced';
  timeToImplement: string;
  userSpecific: boolean;
}


