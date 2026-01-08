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
  group?: 'overview' | 'insurance' | 'biomarkers';
}

export interface NavGroup {
  id: 'overview' | 'insurance' | 'biomarkers';
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

// Insurance SBC Types
export interface InsurancePlan {
  id: string;
  planName: string;
  insurerName: string;
  planType: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP' | 'Other';
  effectiveDate: string;
  uploadDate: string;
  sourceFile: string;
  extractionConfidence: number;
  benefits: InsuranceBenefit[];
  costs: InsuranceCost[];
  limitations: InsuranceLimitation[];
  network: NetworkInfo;
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


