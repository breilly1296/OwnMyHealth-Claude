/**
 * PDF Parser Service
 *
 * Parses lab reports and insurance SBC documents to extract structured data.
 * Uses comprehensive pattern matching to identify biomarkers, values, units,
 * and reference ranges from various lab report formats.
 */

import { BadRequestError, InternalServerError } from '../middleware/errorHandler.js';

/**
 * PDF Parse Result interface
 * Properly types the return value from pdf-parse library
 */
interface PDFParseResult {
  /** Number of pages in the PDF */
  numpages: number;
  /** Number of rendered pages */
  numrender: number;
  /** PDF version information */
  info: PDFInfo;
  /** PDF metadata */
  metadata: unknown;
  /** Extracted text content from all pages */
  text: string;
  /** PDF version string */
  version: string;
}

/**
 * PDF Info interface
 */
interface PDFInfo {
  PDFFormatVersion?: string;
  IsAcroFormPresent?: boolean;
  IsXFAPresent?: boolean;
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: string;
  ModDate?: string;
}

/**
 * PDF Parser function type
 */
type PDFParser = (buffer: Buffer) => Promise<PDFParseResult>;

// Dynamic import for pdf-parse to handle CJS/ESM compatibility
async function getPdfParser(): Promise<PDFParser> {
  const pdfParseModule = await import('pdf-parse');
  // Handle both default and named exports
  const pdfParse = (pdfParseModule as { default?: PDFParser }).default ?? pdfParseModule;
  return pdfParse as PDFParser;
}

// Logger for extraction confidence tracking
interface ExtractionLog {
  biomarkerName: string;
  rawMatch: string;
  extractedValue: number;
  extractedUnit: string;
  extractedRange?: { min: number; max: number };
  confidence: number;
  confidenceFactors: string[];
}

function logExtraction(log: ExtractionLog): void {
  console.log(`[pdfParser] Extracted biomarker:`, {
    name: log.biomarkerName,
    value: log.extractedValue,
    unit: log.extractedUnit,
    range: log.extractedRange,
    confidence: log.confidence.toFixed(2),
    factors: log.confidenceFactors,
    rawMatch: log.rawMatch.substring(0, 100),
  });
}

// Types for parsed data
export interface ParsedBiomarker {
  name: string;
  value: number;
  unit: string;
  category: string;
  normalRange: {
    min: number;
    max: number;
    source?: string;
  };
  date: string;
  labName?: string;
  extractionConfidence: number;
}

export interface ParsedInsurancePlan {
  planName?: string;
  insurerName?: string;
  planType?: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';
  deductible?: number;
  deductibleFamily?: number;
  outOfPocketMax?: number;
  outOfPocketMaxFamily?: number;
  benefits: ParsedBenefit[];
  extractionConfidence: number;
}

export interface ParsedBenefit {
  serviceName: string;
  serviceCategory: string;
  inNetworkCoverage: {
    covered: boolean;
    copay?: number;
    coinsurance?: number;
    deductibleApplies?: boolean;
  };
  outNetworkCoverage?: {
    covered: boolean;
    copay?: number;
    coinsurance?: number;
    deductibleApplies?: boolean;
  };
  preAuthRequired?: boolean;
}

// Unit conversion patterns for common lab units
const UNIT_PATTERNS: Record<string, RegExp> = {
  'mg/dL': /mg\s*\/?\s*d[lL]/i,
  'mmol/L': /mmol\s*\/?\s*[lL]/i,
  'g/dL': /g\s*\/?\s*d[lL]/i,
  'g/L': /g\s*\/?\s*[lL]/i,
  'mEq/L': /m[eE]q\s*\/?\s*[lL]/i,
  'U/L': /[uU]\s*\/?\s*[lL]/i,
  'IU/L': /[iI][uU]\s*\/?\s*[lL]/i,
  'ng/mL': /ng\s*\/?\s*m[lL]/i,
  'pg/mL': /pg\s*\/?\s*m[lL]/i,
  'ug/dL': /[uμ]g\s*\/?\s*d[lL]/i,
  'mcg/dL': /mcg\s*\/?\s*d[lL]/i,
  'mIU/L': /m[iI][uU]\s*\/?\s*[lL]/i,
  'uIU/mL': /[uμ][iI][uU]\s*\/?\s*m[lL]/i,
  'K/uL': /[kK]\s*\/?\s*[uμ][lL]/i,
  'M/uL': /[mM]\s*\/?\s*[uμ][lL]/i,
  'x10^9/L': /x?\s*10\^?9\s*\/?\s*[lL]/i,
  'x10^12/L': /x?\s*10\^?12\s*\/?\s*[lL]/i,
  '%': /%/,
  'fL': /f[lL]/i,
  'pg': /pg/i,
  'mL/min/1.73m²': /m[lL]\s*\/?\s*min\s*\/?\s*1\.?73\s*m[²2]/i,
  'ratio': /ratio/i,
};

// Biomarker definitions with comprehensive patterns
interface BiomarkerDefinition {
  names: string[]; // Alternative names/aliases
  displayName: string;
  category: string;
  defaultUnit: string;
  alternativeUnits?: string[];
  normalRange: { min: number; max: number };
  // Some biomarkers need unit-specific ranges
  unitRanges?: Record<string, { min: number; max: number }>;
}

const BIOMARKER_DEFINITIONS: BiomarkerDefinition[] = [
  // Lipid Panel
  { names: ['total cholesterol', 'cholesterol, total', 'chol'], displayName: 'Total Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL', normalRange: { min: 0, max: 200 }, unitRanges: { 'mmol/L': { min: 0, max: 5.2 } } },
  { names: ['ldl', 'ldl cholesterol', 'ldl-c', 'low density lipoprotein'], displayName: 'LDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL', normalRange: { min: 0, max: 100 }, unitRanges: { 'mmol/L': { min: 0, max: 2.6 } } },
  { names: ['hdl', 'hdl cholesterol', 'hdl-c', 'high density lipoprotein'], displayName: 'HDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL', normalRange: { min: 40, max: 100 }, unitRanges: { 'mmol/L': { min: 1.0, max: 2.6 } } },
  { names: ['triglycerides', 'trig', 'tg'], displayName: 'Triglycerides', category: 'Lipids', defaultUnit: 'mg/dL', normalRange: { min: 0, max: 150 }, unitRanges: { 'mmol/L': { min: 0, max: 1.7 } } },
  { names: ['vldl', 'vldl cholesterol'], displayName: 'VLDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL', normalRange: { min: 5, max: 40 } },
  { names: ['non-hdl cholesterol', 'non hdl'], displayName: 'Non-HDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL', normalRange: { min: 0, max: 130 } },

  // Blood Sugar / Metabolic
  { names: ['glucose', 'fasting glucose', 'blood glucose', 'blood sugar', 'glu'], displayName: 'Glucose', category: 'Metabolic', defaultUnit: 'mg/dL', normalRange: { min: 70, max: 100 }, unitRanges: { 'mmol/L': { min: 3.9, max: 5.6 } } },
  { names: ['hba1c', 'hemoglobin a1c', 'a1c', 'glycated hemoglobin', 'glycohemoglobin'], displayName: 'HbA1c', category: 'Metabolic', defaultUnit: '%', normalRange: { min: 4.0, max: 5.7 } },
  { names: ['insulin', 'fasting insulin'], displayName: 'Insulin', category: 'Metabolic', defaultUnit: 'uIU/mL', normalRange: { min: 2.6, max: 24.9 } },
  { names: ['c-peptide', 'c peptide'], displayName: 'C-Peptide', category: 'Metabolic', defaultUnit: 'ng/mL', normalRange: { min: 0.8, max: 3.1 } },

  // Complete Blood Count (CBC)
  { names: ['wbc', 'white blood cell', 'white blood cells', 'leukocytes'], displayName: 'White Blood Cells', category: 'Blood', defaultUnit: 'K/uL', alternativeUnits: ['x10^9/L'], normalRange: { min: 4.5, max: 11.0 } },
  { names: ['rbc', 'red blood cell', 'red blood cells', 'erythrocytes'], displayName: 'Red Blood Cells', category: 'Blood', defaultUnit: 'M/uL', alternativeUnits: ['x10^12/L'], normalRange: { min: 4.5, max: 5.5 } },
  { names: ['hemoglobin', 'hgb', 'hb'], displayName: 'Hemoglobin', category: 'Blood', defaultUnit: 'g/dL', normalRange: { min: 12.0, max: 17.5 }, unitRanges: { 'g/L': { min: 120, max: 175 } } },
  { names: ['hematocrit', 'hct'], displayName: 'Hematocrit', category: 'Blood', defaultUnit: '%', normalRange: { min: 36, max: 50 } },
  { names: ['platelets', 'platelet count', 'plt'], displayName: 'Platelets', category: 'Blood', defaultUnit: 'K/uL', alternativeUnits: ['x10^9/L'], normalRange: { min: 150, max: 400 } },
  { names: ['mcv', 'mean corpuscular volume'], displayName: 'MCV', category: 'Blood', defaultUnit: 'fL', normalRange: { min: 80, max: 100 } },
  { names: ['mch', 'mean corpuscular hemoglobin'], displayName: 'MCH', category: 'Blood', defaultUnit: 'pg', normalRange: { min: 27, max: 33 } },
  { names: ['mchc', 'mean corpuscular hemoglobin concentration'], displayName: 'MCHC', category: 'Blood', defaultUnit: 'g/dL', normalRange: { min: 32, max: 36 } },
  { names: ['rdw', 'red cell distribution width'], displayName: 'RDW', category: 'Blood', defaultUnit: '%', normalRange: { min: 11.5, max: 14.5 } },
  { names: ['mpv', 'mean platelet volume'], displayName: 'MPV', category: 'Blood', defaultUnit: 'fL', normalRange: { min: 7.5, max: 11.5 } },

  // Kidney Function
  { names: ['creatinine', 'creat', 'cr'], displayName: 'Creatinine', category: 'Kidney', defaultUnit: 'mg/dL', normalRange: { min: 0.6, max: 1.2 }, unitRanges: { 'umol/L': { min: 53, max: 106 } } },
  { names: ['bun', 'blood urea nitrogen', 'urea nitrogen'], displayName: 'BUN', category: 'Kidney', defaultUnit: 'mg/dL', normalRange: { min: 7, max: 20 } },
  { names: ['egfr', 'gfr', 'estimated gfr', 'glomerular filtration rate'], displayName: 'eGFR', category: 'Kidney', defaultUnit: 'mL/min/1.73m²', normalRange: { min: 60, max: 120 } },
  { names: ['uric acid'], displayName: 'Uric Acid', category: 'Kidney', defaultUnit: 'mg/dL', normalRange: { min: 3.5, max: 7.2 } },
  { names: ['cystatin c', 'cystatin-c'], displayName: 'Cystatin C', category: 'Kidney', defaultUnit: 'mg/L', normalRange: { min: 0.53, max: 0.95 } },

  // Liver Function
  { names: ['alt', 'alanine aminotransferase', 'sgpt', 'alanine transaminase'], displayName: 'ALT', category: 'Liver', defaultUnit: 'U/L', normalRange: { min: 7, max: 56 } },
  { names: ['ast', 'aspartate aminotransferase', 'sgot', 'aspartate transaminase'], displayName: 'AST', category: 'Liver', defaultUnit: 'U/L', normalRange: { min: 10, max: 40 } },
  { names: ['alp', 'alkaline phosphatase', 'alk phos'], displayName: 'ALP', category: 'Liver', defaultUnit: 'U/L', normalRange: { min: 44, max: 147 } },
  { names: ['bilirubin', 'total bilirubin', 'bilirubin total', 'tbili'], displayName: 'Bilirubin', category: 'Liver', defaultUnit: 'mg/dL', normalRange: { min: 0.1, max: 1.2 } },
  { names: ['direct bilirubin', 'bilirubin direct', 'dbili', 'conjugated bilirubin'], displayName: 'Direct Bilirubin', category: 'Liver', defaultUnit: 'mg/dL', normalRange: { min: 0, max: 0.3 } },
  { names: ['ggt', 'gamma-glutamyl transferase', 'gamma gt', 'ggtp'], displayName: 'GGT', category: 'Liver', defaultUnit: 'U/L', normalRange: { min: 9, max: 48 } },
  { names: ['albumin', 'alb'], displayName: 'Albumin', category: 'Liver', defaultUnit: 'g/dL', normalRange: { min: 3.5, max: 5.0 } },
  { names: ['total protein', 'protein total', 'tp'], displayName: 'Total Protein', category: 'Liver', defaultUnit: 'g/dL', normalRange: { min: 6.0, max: 8.3 } },
  { names: ['globulin'], displayName: 'Globulin', category: 'Liver', defaultUnit: 'g/dL', normalRange: { min: 2.0, max: 3.5 } },
  { names: ['a/g ratio', 'albumin/globulin ratio', 'ag ratio'], displayName: 'A/G Ratio', category: 'Liver', defaultUnit: 'ratio', normalRange: { min: 1.1, max: 2.5 } },

  // Thyroid
  { names: ['tsh', 'thyroid stimulating hormone', 'thyrotropin'], displayName: 'TSH', category: 'Thyroid', defaultUnit: 'mIU/L', alternativeUnits: ['uIU/mL'], normalRange: { min: 0.4, max: 4.0 } },
  { names: ['free t4', 'ft4', 'free thyroxine', 't4 free'], displayName: 'Free T4', category: 'Thyroid', defaultUnit: 'ng/dL', normalRange: { min: 0.8, max: 1.8 } },
  { names: ['total t4', 't4', 'thyroxine'], displayName: 'Total T4', category: 'Thyroid', defaultUnit: 'ug/dL', normalRange: { min: 4.5, max: 11.2 } },
  { names: ['free t3', 'ft3', 'free triiodothyronine', 't3 free'], displayName: 'Free T3', category: 'Thyroid', defaultUnit: 'pg/mL', normalRange: { min: 2.3, max: 4.2 } },
  { names: ['total t3', 't3', 'triiodothyronine'], displayName: 'Total T3', category: 'Thyroid', defaultUnit: 'ng/dL', normalRange: { min: 80, max: 200 } },
  { names: ['t3 uptake', 't3u'], displayName: 'T3 Uptake', category: 'Thyroid', defaultUnit: '%', normalRange: { min: 24, max: 39 } },
  { names: ['thyroglobulin', 'tg'], displayName: 'Thyroglobulin', category: 'Thyroid', defaultUnit: 'ng/mL', normalRange: { min: 1.5, max: 38 } },

  // Vitamins & Minerals
  { names: ['vitamin d', '25-hydroxy vitamin d', '25-oh vitamin d', 'vit d', '25-hydroxyvitamin d'], displayName: 'Vitamin D', category: 'Vitamins', defaultUnit: 'ng/mL', normalRange: { min: 30, max: 100 }, unitRanges: { 'nmol/L': { min: 75, max: 250 } } },
  { names: ['vitamin b12', 'b12', 'cobalamin'], displayName: 'Vitamin B12', category: 'Vitamins', defaultUnit: 'pg/mL', normalRange: { min: 200, max: 900 } },
  { names: ['folate', 'folic acid', 'vitamin b9'], displayName: 'Folate', category: 'Vitamins', defaultUnit: 'ng/mL', normalRange: { min: 2.7, max: 17.0 } },
  { names: ['iron', 'serum iron', 'fe'], displayName: 'Iron', category: 'Vitamins', defaultUnit: 'ug/dL', normalRange: { min: 60, max: 170 } },
  { names: ['ferritin'], displayName: 'Ferritin', category: 'Vitamins', defaultUnit: 'ng/mL', normalRange: { min: 12, max: 300 } },
  { names: ['tibc', 'total iron binding capacity'], displayName: 'TIBC', category: 'Vitamins', defaultUnit: 'ug/dL', normalRange: { min: 250, max: 370 } },
  { names: ['transferrin saturation', 'tsat', 'iron saturation'], displayName: 'Transferrin Saturation', category: 'Vitamins', defaultUnit: '%', normalRange: { min: 20, max: 50 } },

  // Electrolytes
  { names: ['sodium', 'na'], displayName: 'Sodium', category: 'Electrolytes', defaultUnit: 'mEq/L', alternativeUnits: ['mmol/L'], normalRange: { min: 136, max: 145 } },
  { names: ['potassium', 'k'], displayName: 'Potassium', category: 'Electrolytes', defaultUnit: 'mEq/L', alternativeUnits: ['mmol/L'], normalRange: { min: 3.5, max: 5.0 } },
  { names: ['chloride', 'cl'], displayName: 'Chloride', category: 'Electrolytes', defaultUnit: 'mEq/L', alternativeUnits: ['mmol/L'], normalRange: { min: 98, max: 106 } },
  { names: ['co2', 'carbon dioxide', 'bicarbonate', 'hco3'], displayName: 'CO2', category: 'Electrolytes', defaultUnit: 'mEq/L', normalRange: { min: 23, max: 29 } },
  { names: ['calcium', 'ca'], displayName: 'Calcium', category: 'Electrolytes', defaultUnit: 'mg/dL', normalRange: { min: 8.5, max: 10.5 }, unitRanges: { 'mmol/L': { min: 2.1, max: 2.6 } } },
  { names: ['magnesium', 'mg'], displayName: 'Magnesium', category: 'Electrolytes', defaultUnit: 'mg/dL', normalRange: { min: 1.7, max: 2.2 }, unitRanges: { 'mEq/L': { min: 1.4, max: 1.8 } } },
  { names: ['phosphorus', 'phosphate', 'phos'], displayName: 'Phosphorus', category: 'Electrolytes', defaultUnit: 'mg/dL', normalRange: { min: 2.5, max: 4.5 } },
  { names: ['anion gap'], displayName: 'Anion Gap', category: 'Electrolytes', defaultUnit: 'mEq/L', normalRange: { min: 7, max: 16 } },

  // Inflammation Markers
  { names: ['crp', 'c-reactive protein', 'c reactive protein'], displayName: 'CRP', category: 'Inflammation', defaultUnit: 'mg/L', normalRange: { min: 0, max: 3.0 } },
  { names: ['hs-crp', 'high sensitivity crp', 'high-sensitivity c-reactive protein'], displayName: 'hs-CRP', category: 'Inflammation', defaultUnit: 'mg/L', normalRange: { min: 0, max: 1.0 } },
  { names: ['esr', 'sed rate', 'sedimentation rate', 'erythrocyte sedimentation rate'], displayName: 'ESR', category: 'Inflammation', defaultUnit: 'mm/hr', normalRange: { min: 0, max: 20 } },
  { names: ['homocysteine'], displayName: 'Homocysteine', category: 'Inflammation', defaultUnit: 'umol/L', normalRange: { min: 4, max: 15 } },

  // Hormones
  { names: ['testosterone', 'total testosterone'], displayName: 'Testosterone', category: 'Hormones', defaultUnit: 'ng/dL', normalRange: { min: 300, max: 1000 } },
  { names: ['free testosterone'], displayName: 'Free Testosterone', category: 'Hormones', defaultUnit: 'pg/mL', normalRange: { min: 50, max: 210 } },
  { names: ['estradiol', 'e2'], displayName: 'Estradiol', category: 'Hormones', defaultUnit: 'pg/mL', normalRange: { min: 10, max: 50 } },
  { names: ['dhea-s', 'dhea sulfate', 'dehydroepiandrosterone sulfate'], displayName: 'DHEA-S', category: 'Hormones', defaultUnit: 'ug/dL', normalRange: { min: 80, max: 560 } },
  { names: ['cortisol'], displayName: 'Cortisol', category: 'Hormones', defaultUnit: 'ug/dL', normalRange: { min: 6, max: 23 } },
  { names: ['psa', 'prostate specific antigen'], displayName: 'PSA', category: 'Hormones', defaultUnit: 'ng/mL', normalRange: { min: 0, max: 4.0 } },

  // Cardiac Markers
  { names: ['bnp', 'b-type natriuretic peptide', 'brain natriuretic peptide'], displayName: 'BNP', category: 'Cardiac', defaultUnit: 'pg/mL', normalRange: { min: 0, max: 100 } },
  { names: ['nt-probnp', 'n-terminal pro-bnp'], displayName: 'NT-proBNP', category: 'Cardiac', defaultUnit: 'pg/mL', normalRange: { min: 0, max: 125 } },
  { names: ['troponin', 'troponin i', 'troponin t', 'hs-troponin'], displayName: 'Troponin', category: 'Cardiac', defaultUnit: 'ng/mL', normalRange: { min: 0, max: 0.04 } },
  { names: ['lp(a)', 'lipoprotein a', 'lipoprotein(a)'], displayName: 'Lipoprotein(a)', category: 'Cardiac', defaultUnit: 'nmol/L', normalRange: { min: 0, max: 75 } },
  { names: ['apolipoprotein b', 'apo b', 'apob'], displayName: 'Apolipoprotein B', category: 'Cardiac', defaultUnit: 'mg/dL', normalRange: { min: 0, max: 100 } },
];

// ============================================
// SBC (Summary of Benefits and Coverage) Parsing
// ============================================

// Logger for SBC extraction
interface SBCExtractionLog {
  field: string;
  rawMatch: string;
  extractedValue: string | number | boolean;
  confidence: number;
  source: string;
}

function logSBCExtraction(log: SBCExtractionLog): void {
  console.log(`[pdfParser:SBC] Extracted ${log.field}:`, {
    value: log.extractedValue,
    confidence: log.confidence.toFixed(2),
    source: log.source,
    rawMatch: log.rawMatch.substring(0, 80),
  });
}

// Comprehensive SBC extraction patterns
const SBC_EXTRACTION_PATTERNS = {
  // Plan identification
  planName: [
    /(?:plan\s*name|coverage\s*for|plan\s*option)[:\s]*([^\n]{5,100})/i,
    /(?:this\s*is\s*(?:a\s*)?|your\s*)([A-Z][A-Za-z\s]+(?:Plan|Coverage|Benefits))/i,
    /(?:^|\n)([A-Z][A-Za-z\s]+(?:Gold|Silver|Bronze|Platinum|Basic|Premium|Select|Choice|Plus)(?:\s+Plan)?)/m,
  ],
  insurerName: [
    /(?:insurance\s*company|insurer|carrier|provided\s*by|underwritten\s*by)[:\s]*([^\n]{3,80})/i,
    /(?:^|\n)((?:Aetna|Anthem|Blue\s*Cross|Blue\s*Shield|BCBS|Cigna|Humana|Kaiser|United\s*Healthcare|UnitedHealth|Oscar|Molina|Centene|CVS|Highmark)[A-Za-z\s]*)/im,
    /(?:issued\s*by|administered\s*by)[:\s]*([^\n]{3,80})/i,
  ],

  // Coverage period
  coveragePeriod: [
    /coverage\s*period[:\s]*([^\n]{5,50})/i,
    /(?:effective|plan\s*year)[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|through|[-–])\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
  ],

  // Deductibles - multiple patterns for different formats
  deductibleIndividual: [
    /(?:individual|person|single)\s*(?:annual\s*)?deductible[:\s]*\$?([\d,]+)/i,
    /deductible[:\s]*\$?([\d,]+)\s*(?:individual|person|per\s*person)/i,
    /(?:^|\n)(?:overall\s*)?deductible[:\s]*\$?([\d,]+)/im,
    /what\s*is\s*the\s*(?:overall\s*)?deductible[?\s]*\$?([\d,]+)/i,
    /\$?([\d,]+)\s*(?:individual|person)\s*(?:annual\s*)?deductible/i,
  ],
  deductibleFamily: [
    /family\s*(?:annual\s*)?deductible[:\s]*\$?([\d,]+)/i,
    /deductible[:\s]*\$?([\d,]+)\s*(?:family|per\s*family)/i,
    /\$?([\d,]+)\s*family\s*(?:annual\s*)?deductible/i,
    /(?:two\s*or\s*more|2\+)\s*(?:members|people)[:\s]*\$?([\d,]+)/i,
  ],

  // Out-of-pocket maximums
  oopMaxIndividual: [
    /(?:individual|person|single)\s*(?:annual\s*)?(?:out.of.pocket|oop)\s*(?:maximum|max|limit)[:\s]*\$?([\d,]+)/i,
    /(?:out.of.pocket|oop)\s*(?:maximum|max|limit)[:\s]*\$?([\d,]+)\s*(?:individual|person)/i,
    /what\s*is\s*the\s*(?:out.of.pocket|oop)\s*limit[?\s]*\$?([\d,]+)/i,
    /\$?([\d,]+)\s*(?:individual|person)\s*(?:out.of.pocket|oop)/i,
    /maximum\s*out.of.pocket[:\s]*\$?([\d,]+)/i,
  ],
  oopMaxFamily: [
    /family\s*(?:annual\s*)?(?:out.of.pocket|oop)\s*(?:maximum|max|limit)[:\s]*\$?([\d,]+)/i,
    /(?:out.of.pocket|oop)\s*(?:maximum|max|limit)[:\s]*\$?([\d,]+)\s*(?:family)/i,
    /\$?([\d,]+)\s*family\s*(?:out.of.pocket|oop)/i,
  ],

  // Premium (if included in SBC)
  premium: [
    /(?:monthly\s*)?premium[:\s]*\$?([\d,]+(?:\.\d{2})?)\s*(?:\/?\s*month|per\s*month)?/i,
    /\$?([\d,]+(?:\.\d{2})?)\s*(?:\/?\s*month|per\s*month)\s*(?:premium)?/i,
  ],

  // HSA/FSA eligibility
  hsaEligible: [
    /(?:hsa|health\s*savings\s*account)\s*(?:eligible|qualified)/i,
    /(?:eligible|qualified)\s*(?:for\s*)?(?:hsa|health\s*savings)/i,
  ],

  // Network type indicators
  networkType: [
    /(?:this\s*plan\s*(?:is\s*(?:a|an)?|uses)\s*)(hmo|ppo|epo|pos|hdhp)/i,
    /(?:^|\s)(hmo|ppo|epo|pos|hdhp)(?:\s+plan|\s*$)/im,
    /plan\s*type[:\s]*(hmo|ppo|epo|pos|hdhp)/i,
  ],
};

// Comprehensive service/benefit categories with detailed patterns
interface ServiceDefinition {
  name: string;
  category: string;
  patterns: RegExp[];
  commonCopays?: { min: number; max: number };
  commonCoinsurance?: { min: number; max: number };
}

const SERVICE_DEFINITIONS: ServiceDefinition[] = [
  // Office Visits
  {
    name: 'Primary Care Visit',
    category: 'Office Visits',
    patterns: [
      /primary\s*care\s*(?:physician|provider|doctor|visit)/i,
      /(?:pcp|family\s*doctor|general\s*practitioner)\s*(?:visit|office)/i,
      /office\s*visit[:\s-]*(?:primary|pcp)/i,
      /if\s*you\s*visit\s*a\s*(?:health\s*care\s*)?provider'?s?\s*office/i,
    ],
    commonCopays: { min: 15, max: 50 },
    commonCoinsurance: { min: 0, max: 20 },
  },
  {
    name: 'Specialist Visit',
    category: 'Office Visits',
    patterns: [
      /specialist\s*(?:visit|office|care)/i,
      /(?:visit\s*(?:to\s*)?(?:a\s*)?)?specialist/i,
      /specialty\s*care/i,
    ],
    commonCopays: { min: 30, max: 75 },
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Telehealth/Virtual Visit',
    category: 'Office Visits',
    patterns: [
      /tele(?:health|medicine)\s*(?:visit|service)?/i,
      /virtual\s*(?:visit|care|consultation)/i,
      /online\s*(?:doctor|visit|consultation)/i,
    ],
    commonCopays: { min: 0, max: 40 },
  },

  // Preventive Care
  {
    name: 'Preventive Care',
    category: 'Preventive',
    patterns: [
      /preventive\s*(?:care|service|visit)/i,
      /routine\s*(?:physical|checkup|exam)/i,
      /annual\s*(?:physical|wellness|exam)/i,
      /well(?:ness)?\s*(?:visit|exam|check)/i,
    ],
    commonCopays: { min: 0, max: 0 },
    commonCoinsurance: { min: 0, max: 0 },
  },
  {
    name: 'Immunizations',
    category: 'Preventive',
    patterns: [
      /immunization/i,
      /vaccin(?:e|ation)/i,
      /flu\s*shot/i,
    ],
    commonCopays: { min: 0, max: 0 },
  },
  {
    name: 'Screening Tests',
    category: 'Preventive',
    patterns: [
      /(?:preventive|screening)\s*(?:test|lab)/i,
      /cancer\s*screening/i,
      /mammogram/i,
      /colonoscopy/i,
    ],
    commonCopays: { min: 0, max: 0 },
  },

  // Emergency Services
  {
    name: 'Emergency Room',
    category: 'Emergency',
    patterns: [
      /emergency\s*(?:room|department|service|care)/i,
      /er\s*(?:visit|service)/i,
      /(?:if\s*you\s*)?(?:have\s*)?(?:an\s*)?emergency/i,
    ],
    commonCopays: { min: 100, max: 500 },
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Urgent Care',
    category: 'Emergency',
    patterns: [
      /urgent\s*care\s*(?:visit|center|facility)?/i,
      /walk.in\s*clinic/i,
    ],
    commonCopays: { min: 30, max: 100 },
    commonCoinsurance: { min: 10, max: 25 },
  },
  {
    name: 'Ambulance Services',
    category: 'Emergency',
    patterns: [
      /ambulance\s*(?:service|transport)?/i,
      /emergency\s*(?:medical\s*)?transport/i,
      /ems\s*service/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },

  // Hospital Services
  {
    name: 'Hospital Stay (Inpatient)',
    category: 'Hospital',
    patterns: [
      /(?:hospital|inpatient)\s*(?:stay|admission|care)/i,
      /facility\s*fee\s*\(?inpatient/i,
      /if\s*you\s*(?:have\s*)?(?:a\s*)?hospital\s*stay/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Outpatient Surgery',
    category: 'Hospital',
    patterns: [
      /outpatient\s*(?:surgery|procedure|facility)/i,
      /ambulatory\s*(?:surgery|surgical)/i,
      /same.day\s*surgery/i,
      /facility\s*fee\s*\(?outpatient/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Skilled Nursing Facility',
    category: 'Hospital',
    patterns: [
      /skilled\s*nursing\s*(?:facility|care)/i,
      /snf\s*(?:care|stay)/i,
      /nursing\s*home/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },

  // Mental Health & Substance Abuse
  {
    name: 'Mental Health (Outpatient)',
    category: 'Mental Health',
    patterns: [
      /mental\s*health\s*(?:outpatient|office|visit)/i,
      /(?:outpatient\s*)?(?:mental|behavioral)\s*health/i,
      /psychiatr(?:y|ist|ic)\s*(?:visit|office)/i,
      /psycholog(?:y|ist|ical)\s*(?:visit|service)/i,
      /counseling\s*(?:session|visit)/i,
      /therap(?:y|ist)\s*(?:visit|session)/i,
    ],
    commonCopays: { min: 20, max: 60 },
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Mental Health (Inpatient)',
    category: 'Mental Health',
    patterns: [
      /mental\s*health\s*(?:inpatient|facility|hospital)/i,
      /(?:inpatient\s*)?psychiatric\s*(?:care|hospital)/i,
      /behavioral\s*health\s*(?:inpatient|facility)/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Substance Abuse Treatment',
    category: 'Mental Health',
    patterns: [
      /substance\s*(?:abuse|use)\s*(?:treatment|disorder)/i,
      /(?:drug|alcohol)\s*(?:abuse|treatment|rehabilitation)/i,
      /addiction\s*(?:treatment|service)/i,
      /detox(?:ification)?/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },

  // Prescription Drugs
  {
    name: 'Generic Drugs',
    category: 'Pharmacy',
    patterns: [
      /generic\s*(?:drug|prescription|medication|rx)/i,
      /tier\s*1\s*(?:drug|medication)/i,
      /preferred\s*generic/i,
    ],
    commonCopays: { min: 5, max: 20 },
  },
  {
    name: 'Preferred Brand Drugs',
    category: 'Pharmacy',
    patterns: [
      /(?:preferred\s*)?brand\s*(?:name\s*)?(?:drug|medication|rx)/i,
      /tier\s*2\s*(?:drug|medication)/i,
      /formulary\s*brand/i,
    ],
    commonCopays: { min: 25, max: 60 },
  },
  {
    name: 'Non-Preferred Brand Drugs',
    category: 'Pharmacy',
    patterns: [
      /non.?preferred\s*(?:brand\s*)?(?:drug|medication)/i,
      /tier\s*3\s*(?:drug|medication)/i,
      /non.?formulary/i,
    ],
    commonCopays: { min: 50, max: 150 },
  },
  {
    name: 'Specialty Drugs',
    category: 'Pharmacy',
    patterns: [
      /specialty\s*(?:drug|medication|rx|pharmacy)/i,
      /tier\s*4\s*(?:drug|medication)/i,
      /biologic(?:al)?\s*(?:drug|medication)/i,
    ],
    commonCoinsurance: { min: 20, max: 50 },
  },

  // Diagnostic Services
  {
    name: 'Lab Tests',
    category: 'Diagnostic',
    patterns: [
      /lab(?:oratory)?\s*(?:test|work|service)/i,
      /diagnostic\s*(?:lab|test)/i,
      /blood\s*(?:test|work)/i,
    ],
    commonCopays: { min: 0, max: 50 },
    commonCoinsurance: { min: 0, max: 20 },
  },
  {
    name: 'X-Ray',
    category: 'Diagnostic',
    patterns: [
      /x.?ray/i,
      /radiograph/i,
      /basic\s*imaging/i,
    ],
    commonCopays: { min: 20, max: 100 },
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Advanced Imaging (CT/MRI/PET)',
    category: 'Diagnostic',
    patterns: [
      /(?:ct|cat)\s*scan/i,
      /mri/i,
      /pet\s*scan/i,
      /advanced\s*imaging/i,
      /diagnostic\s*imaging/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },

  // Therapy Services
  {
    name: 'Physical Therapy',
    category: 'Therapy',
    patterns: [
      /physical\s*therap(?:y|ist)/i,
      /pt\s*(?:visit|session)/i,
      /rehabilitation\s*(?:service|therap)/i,
    ],
    commonCopays: { min: 20, max: 60 },
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Occupational Therapy',
    category: 'Therapy',
    patterns: [
      /occupational\s*therap(?:y|ist)/i,
      /ot\s*(?:visit|session)/i,
    ],
    commonCopays: { min: 20, max: 60 },
  },
  {
    name: 'Speech Therapy',
    category: 'Therapy',
    patterns: [
      /speech\s*(?:therap(?:y|ist)|language)/i,
      /speech.language\s*patholog/i,
    ],
    commonCopays: { min: 20, max: 60 },
  },
  {
    name: 'Chiropractic Care',
    category: 'Therapy',
    patterns: [
      /chiropractic\s*(?:care|service|visit)/i,
      /chiropractor/i,
      /spinal\s*manipulation/i,
    ],
    commonCopays: { min: 20, max: 50 },
  },
  {
    name: 'Acupuncture',
    category: 'Therapy',
    patterns: [
      /acupuncture/i,
    ],
    commonCopays: { min: 20, max: 50 },
  },

  // Maternity & Newborn
  {
    name: 'Prenatal Care',
    category: 'Maternity',
    patterns: [
      /prenatal\s*(?:care|visit)/i,
      /(?:routine\s*)?maternity\s*(?:care|office)/i,
      /ob(?:\/gyn)?\s*(?:prenatal|maternity)/i,
    ],
    commonCopays: { min: 0, max: 30 },
  },
  {
    name: 'Delivery (Hospital)',
    category: 'Maternity',
    patterns: [
      /(?:hospital\s*)?delivery/i,
      /childbirth/i,
      /labor\s*(?:and|&)\s*delivery/i,
      /inpatient\s*maternity/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Postnatal Care',
    category: 'Maternity',
    patterns: [
      /post(?:natal|partum)\s*(?:care|visit)/i,
      /after\s*delivery\s*(?:care|visit)/i,
    ],
    commonCopays: { min: 0, max: 30 },
  },
  {
    name: 'Newborn Care',
    category: 'Maternity',
    patterns: [
      /newborn\s*(?:care|nursery)/i,
      /well.?baby\s*(?:care|visit)/i,
      /infant\s*care/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },

  // Vision & Dental (if included)
  {
    name: 'Eye Exam',
    category: 'Vision',
    patterns: [
      /(?:routine\s*)?eye\s*exam/i,
      /vision\s*(?:exam|test)/i,
      /optometr(?:y|ist)/i,
    ],
    commonCopays: { min: 10, max: 50 },
  },
  {
    name: 'Eyeglasses/Contacts',
    category: 'Vision',
    patterns: [
      /eyeglass(?:es)?/i,
      /contact\s*lens(?:es)?/i,
      /vision\s*hardware/i,
      /frames?\s*(?:and|&)?\s*lens(?:es)?/i,
    ],
  },
  {
    name: 'Dental (Preventive)',
    category: 'Dental',
    patterns: [
      /(?:routine\s*)?dental\s*(?:exam|cleaning|checkup)/i,
      /preventive\s*dental/i,
      /oral\s*exam/i,
    ],
    commonCopays: { min: 0, max: 25 },
  },
  {
    name: 'Dental (Basic)',
    category: 'Dental',
    patterns: [
      /(?:basic\s*)?dental\s*(?:filling|extraction)/i,
      /restorative\s*dental/i,
    ],
    commonCoinsurance: { min: 20, max: 50 },
  },

  // Durable Medical Equipment
  {
    name: 'Durable Medical Equipment',
    category: 'Equipment',
    patterns: [
      /durable\s*medical\s*equipment/i,
      /dme/i,
      /medical\s*(?:equipment|device|supplies)/i,
      /wheelchair/i,
      /oxygen\s*(?:equipment|supply)/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Prosthetics/Orthotics',
    category: 'Equipment',
    patterns: [
      /prosthetic/i,
      /orthotic/i,
      /artificial\s*(?:limb|device)/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },

  // Home Health & Hospice
  {
    name: 'Home Health Care',
    category: 'Home Care',
    patterns: [
      /home\s*health\s*(?:care|service)/i,
      /(?:in.?home|home.?based)\s*(?:care|nursing)/i,
    ],
    commonCoinsurance: { min: 10, max: 30 },
  },
  {
    name: 'Hospice Care',
    category: 'Home Care',
    patterns: [
      /hospice\s*(?:care|service)/i,
      /end.of.life\s*care/i,
      /palliative\s*care/i,
    ],
    commonCoinsurance: { min: 0, max: 20 },
  },
];

/**
 * Extract unit from text context around a value
 */
function extractUnit(context: string, defaultUnit: string): string {
  for (const [unitName, pattern] of Object.entries(UNIT_PATTERNS)) {
    if (pattern.test(context)) {
      return unitName;
    }
  }
  return defaultUnit;
}

/**
 * Extract reference range from text context
 * Handles formats: "70-100", "<200", ">40", "less than 200"
 */
function extractReferenceRange(
  context: string
): { min: number; max: number; source: string } | null {
  // Try range format first: "70-100" or "70 to 100"
  const rangeMatch = context.match(/(\d+(?:\.\d+)?)\s*[-–—to]+\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max) && min < max) {
      return { min, max, source: 'Lab Reference Range' };
    }
  }

  // Try less than format: "<200"
  const lessThanMatch = context.match(/[<＜]\s*(\d+(?:\.\d+)?)/);
  if (lessThanMatch) {
    const max = parseFloat(lessThanMatch[1]);
    if (!isNaN(max)) {
      return { min: 0, max, source: 'Lab Reference Range' };
    }
  }

  // Try greater than format: ">40"
  const greaterThanMatch = context.match(/[>＞]\s*(\d+(?:\.\d+)?)/);
  if (greaterThanMatch) {
    const min = parseFloat(greaterThanMatch[1]);
    if (!isNaN(min)) {
      return { min, max: min * 10, source: 'Lab Reference Range' };
    }
  }

  return null;
}

/**
 * Parse multiple date formats and return ISO string
 */
function extractDate(text: string): string {
  const monthMap: Record<string, number> = {
    'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
    'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6,
    'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'september': 9,
    'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
  };

  // Look for date near keywords
  const dateContextMatch = text.match(
    /(?:collection|specimen|report|test|drawn|received)\s*(?:date)?[:\s]*([^\n]{5,30})/i
  );
  const dateContext = dateContextMatch ? dateContextMatch[1] : text.substring(0, 1000);

  // Try Month DD, YYYY format (e.g., "January 15, 2024")
  const monthDayYear = dateContext.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i
  );
  if (monthDayYear) {
    const month = monthMap[monthDayYear[1].toLowerCase().substring(0, 3)];
    const day = parseInt(monthDayYear[2]);
    const year = parseInt(monthDayYear[3]);
    if (month && day && year) {
      return new Date(year, month - 1, day).toISOString();
    }
  }

  // Try YYYY-MM-DD format
  const isoDate = dateContext.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoDate) {
    const year = parseInt(isoDate[1]);
    const month = parseInt(isoDate[2]);
    const day = parseInt(isoDate[3]);
    if (year > 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day).toISOString();
    }
  }

  // Try MM/DD/YYYY or MM-DD-YYYY format
  const usDate = dateContext.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (usDate) {
    const month = parseInt(usDate[1]);
    const day = parseInt(usDate[2]);
    let year = parseInt(usDate[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year > 2000) {
      return new Date(year, month - 1, day).toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * Extract lab name from text
 */
function extractLabName(text: string): string | undefined {
  const patterns = [
    /(?:laboratory|laboratories|lab)\s*(?:name)?[:\s]*([^\n,]{3,50})/i,
    /(?:performed\s*(?:at|by)|testing\s*facility)[:\s]*([^\n,]{3,50})/i,
    /([A-Z][A-Za-z]+\s+(?:Medical|Health|Clinical|Diagnostic)\s+(?:Center|Lab|Laboratory|Group))/,
    /(?:Quest|LabCorp|BioReference|Sonic|ARUP|Mayo)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const labName = match[1].trim();
      if (labName.length >= 3 && labName.length <= 100) {
        return labName.substring(0, 200);
      }
    }
  }
  return undefined;
}

/**
 * Calculate extraction confidence based on multiple factors
 */
function calculateConfidence(factors: {
  nameMatchQuality: 'exact' | 'alias' | 'fuzzy';
  hasUnit: boolean;
  hasReferenceRange: boolean;
  valueReasonable: boolean;
  contextClarity: 'high' | 'medium' | 'low';
}): { confidence: number; reasons: string[] } {
  let confidence = 0.5;
  const reasons: string[] = [];

  // Name match quality
  if (factors.nameMatchQuality === 'exact') {
    confidence += 0.15;
    reasons.push('exact name match');
  } else if (factors.nameMatchQuality === 'alias') {
    confidence += 0.10;
    reasons.push('alias name match');
  } else {
    confidence += 0.05;
    reasons.push('fuzzy name match');
  }

  // Unit presence
  if (factors.hasUnit) {
    confidence += 0.10;
    reasons.push('unit found');
  }

  // Reference range from lab
  if (factors.hasReferenceRange) {
    confidence += 0.10;
    reasons.push('reference range from lab');
  }

  // Value reasonableness
  if (factors.valueReasonable) {
    confidence += 0.05;
    reasons.push('value in expected range');
  }

  // Context clarity
  if (factors.contextClarity === 'high') {
    confidence += 0.10;
    reasons.push('clear context');
  } else if (factors.contextClarity === 'medium') {
    confidence += 0.05;
    reasons.push('moderate context');
  }

  return { confidence: Math.min(confidence, 1.0), reasons };
}

/**
 * Find biomarker definition by name (case-insensitive, supports aliases)
 */
function findBiomarkerDefinition(name: string): { definition: BiomarkerDefinition; matchType: 'exact' | 'alias' } | null {
  const normalizedName = name.toLowerCase().trim();

  for (const def of BIOMARKER_DEFINITIONS) {
    // Check display name
    if (def.displayName.toLowerCase() === normalizedName) {
      return { definition: def, matchType: 'exact' };
    }
    // Check aliases
    for (const alias of def.names) {
      if (alias.toLowerCase() === normalizedName) {
        return { definition: def, matchType: 'alias' };
      }
    }
  }
  return null;
}

/**
 * Parse a lab report PDF and extract biomarkers
 */
export async function parseLabReport(buffer: Buffer, filename: string): Promise<{
  biomarkers: ParsedBiomarker[];
  labName?: string;
  reportDate?: string;
  rawText: string;
}> {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestError('PDF file is empty or invalid');
  }

  let pdf: PDFParser;
  let pdfResult: PDFParseResult;
  let text: string;

  try {
    pdf = await getPdfParser();
  } catch (error) {
    console.error('[pdfParser] Failed to load PDF parser:', error);
    throw new InternalServerError('PDF parsing service is unavailable');
  }

  try {
    pdfResult = await pdf(buffer);
    text = pdfResult.text;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[pdfParser] Failed to parse PDF "${filename}":`, errorMsg);
    throw new BadRequestError(`Unable to parse PDF file. The file may be corrupted, password-protected, or in an unsupported format.`);
  }

  if (!text || text.trim().length === 0) {
    throw new BadRequestError('PDF file appears to be empty or contains no extractable text. Please ensure the PDF contains readable text (not scanned images).');
  }

  console.log(`[pdfParser] Parsing lab report: ${filename} (${text.length} chars extracted)`);

  const biomarkers: ParsedBiomarker[] = [];
  const foundNames = new Set<string>();

  // Extract lab metadata
  const labName = extractLabName(text);
  const reportDate = extractDate(text);

  console.log(`[pdfParser] Lab: ${labName || 'Unknown'}, Date: ${reportDate}`);

  // STRATEGY 1: Search for known biomarkers using comprehensive patterns
  for (const definition of BIOMARKER_DEFINITIONS) {
    if (foundNames.has(definition.displayName)) continue;

    // Build regex pattern from all names/aliases
    const namePatterns = [definition.displayName, ...definition.names]
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');

    // Pattern: name followed by value and optionally unit
    // Captures: name, value, and surrounding context for unit/range extraction
    const pattern = new RegExp(
      `(${namePatterns})[:\\s]*([<>]?\\s*\\d+(?:\\.\\d+)?)[\\s]*([^\\n]{0,50})`,
      'gi'
    );

    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (foundNames.has(definition.displayName)) break;

      const [fullMatch, matchedName, rawValue, afterContext] = match;

      // Get broader context for reference range
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(text.length, match.index + fullMatch.length + 100);
      const fullContext = text.substring(contextStart, contextEnd);

      // Parse value
      const valueMatch = rawValue.match(/([<>]?)\s*(\d+(?:\.\d+)?)/);
      if (!valueMatch) continue;

      const value = parseFloat(valueMatch[2]);
      if (isNaN(value) || value < 0 || value >= 100000) continue;

      // Extract unit from context
      const unit = extractUnit(afterContext + fullContext, definition.defaultUnit);

      // Get appropriate normal range based on unit
      let normalRange = definition.normalRange;
      if (definition.unitRanges && definition.unitRanges[unit]) {
        normalRange = definition.unitRanges[unit];
      }

      // Try to extract reference range from lab report
      const labRange = extractReferenceRange(fullContext);

      // Calculate confidence
      const matchType = definition.displayName.toLowerCase() === matchedName.toLowerCase() ? 'exact' : 'alias';
      const hasLabRange = labRange !== null;
      const hasUnit = unit !== definition.defaultUnit || afterContext.includes(unit) || /[a-zA-Z]/.test(afterContext);
      const isValueReasonable = value >= normalRange.min * 0.1 && value <= normalRange.max * 10;

      const { confidence, reasons } = calculateConfidence({
        nameMatchQuality: matchType,
        hasUnit,
        hasReferenceRange: hasLabRange,
        valueReasonable: isValueReasonable,
        contextClarity: fullMatch.includes(':') ? 'high' : 'medium',
      });

      const finalRange = labRange || { ...normalRange, source: 'Standard Reference Range' };

      foundNames.add(definition.displayName);

      const biomarker: ParsedBiomarker = {
        name: definition.displayName,
        value,
        unit,
        category: definition.category,
        normalRange: finalRange,
        date: reportDate,
        labName,
        extractionConfidence: confidence,
      };

      biomarkers.push(biomarker);

      // Log extraction details
      logExtraction({
        biomarkerName: definition.displayName,
        rawMatch: fullMatch,
        extractedValue: value,
        extractedUnit: unit,
        extractedRange: finalRange,
        confidence,
        confidenceFactors: reasons,
      });
    }
  }

  // STRATEGY 2: Parse tabular data with format: Name Value Unit Range
  const tablePatterns = [
    // Pattern: Name ... Value Unit Min-Max
    /([A-Za-z][A-Za-z\s\-/]{2,40})\s+(\d+(?:\.\d+)?)\s+([A-Za-z/%²³µμ/]+)\s+(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/g,
    // Pattern: Name ... Value Min-Max Unit
    /([A-Za-z][A-Za-z\s\-/]{2,40})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s+([A-Za-z/%²³µμ/]+)/g,
    // Pattern: Name Value Unit (no range)
    /([A-Za-z][A-Za-z\s\-/]{2,40})\s+(\d+(?:\.\d+)?)\s+([A-Za-z/%²³µμ/]{2,15})(?:\s|$)/g,
  ];

  for (const tablePattern of tablePatterns) {
    let tableMatch;
    while ((tableMatch = tablePattern.exec(text)) !== null) {
      const rawName = tableMatch[1].trim();

      // Skip if already found or name is too generic
      if (foundNames.has(rawName)) continue;
      if (rawName.length < 3 || rawName.length > 50) continue;
      if (/^(test|result|value|normal|range|unit|flag|date|page)$/i.test(rawName)) continue;

      // Try to match to known definition
      const known = findBiomarkerDefinition(rawName);
      if (known && foundNames.has(known.definition.displayName)) continue;

      const value = parseFloat(tableMatch[2]);
      if (isNaN(value) || value < 0 || value >= 100000) continue;

      // Parse based on pattern match groups
      let unit: string;
      let min: number | undefined;
      let max: number | undefined;

      if (tableMatch.length === 6) {
        // Has all: name, value, unit, min, max
        unit = tableMatch[3].trim();
        min = parseFloat(tableMatch[4]);
        max = parseFloat(tableMatch[5]);
      } else if (tableMatch.length === 4) {
        // Name, value, unit only
        unit = tableMatch[3].trim();
      } else {
        continue;
      }

      const displayName = known ? known.definition.displayName : rawName;
      const category = known ? known.definition.category : 'Other';
      const defaultRange = known ? known.definition.normalRange : { min: 0, max: 1000 };

      let normalRange: { min: number; max: number; source: string };
      if (min !== undefined && max !== undefined && !isNaN(min) && !isNaN(max)) {
        normalRange = { min, max, source: 'Lab Reference Range' };
      } else {
        normalRange = { ...defaultRange, source: 'Standard Reference Range' };
      }

      // Calculate confidence for table extraction
      const { confidence, reasons } = calculateConfidence({
        nameMatchQuality: known ? known.matchType : 'fuzzy',
        hasUnit: true,
        hasReferenceRange: min !== undefined,
        valueReasonable: value >= normalRange.min * 0.1 && value <= normalRange.max * 10,
        contextClarity: 'high',
      });

      foundNames.add(displayName);

      const biomarker: ParsedBiomarker = {
        name: displayName,
        value,
        unit,
        category,
        normalRange,
        date: reportDate,
        labName,
        extractionConfidence: confidence,
      };

      biomarkers.push(biomarker);

      logExtraction({
        biomarkerName: displayName,
        rawMatch: tableMatch[0].substring(0, 100),
        extractedValue: value,
        extractedUnit: unit,
        extractedRange: normalRange,
        confidence,
        confidenceFactors: [...reasons, 'table format'],
      });
    }
  }

  // Sort biomarkers by category for better organization
  biomarkers.sort((a, b) => {
    const categoryOrder = ['Metabolic', 'Lipids', 'Blood', 'Kidney', 'Liver', 'Thyroid', 'Electrolytes', 'Vitamins', 'Inflammation', 'Hormones', 'Cardiac', 'Other'];
    const aIndex = categoryOrder.indexOf(a.category);
    const bIndex = categoryOrder.indexOf(b.category);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  console.log(`[pdfParser] Extraction complete: ${biomarkers.length} biomarkers found`);
  if (biomarkers.length > 0) {
    const avgConfidence = biomarkers.reduce((sum, b) => sum + b.extractionConfidence, 0) / biomarkers.length;
    console.log(`[pdfParser] Average extraction confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  }

  return {
    biomarkers,
    labName,
    reportDate,
    rawText: text.substring(0, 5000),
  };
}

/**
 * Helper function to try multiple patterns and return first match
 */
function tryPatterns(text: string, patterns: RegExp[]): { match: RegExpMatchArray | null; patternIndex: number } {
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match) {
      return { match, patternIndex: i };
    }
  }
  return { match: null, patternIndex: -1 };
}

/**
 * Extract copay amount from text section
 * Handles formats: "$30 copay", "$30/visit", "30 dollar copay", etc.
 */
function extractCopay(section: string): number | undefined {
  const patterns = [
    /\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:copay|co-pay|per\s*visit|\/\s*visit)/i,
    /copay[:\s]*\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
    /(\d+(?:,\d{3})*)\s*(?:dollar|usd)\s*copay/i,
    /you\s*pay[:\s]*\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = section.match(pattern);
    if (match && match[1]) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(value) && value >= 0 && value < 10000) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Extract coinsurance percentage from text section
 * Handles formats: "20% coinsurance", "20% after deductible", etc.
 */
function extractCoinsurance(section: string): number | undefined {
  const patterns = [
    /(\d+)\s*%\s*(?:coinsurance|co-insurance)/i,
    /(\d+)\s*%\s*(?:after|once)\s*(?:the\s*)?deductible/i,
    /coinsurance[:\s]*(\d+)\s*%/i,
    /you\s*pay[:\s]*(\d+)\s*%/i,
    /(\d+)\s*%\s*of\s*(?:the\s*)?(?:allowed|covered)\s*amount/i,
  ];

  for (const pattern of patterns) {
    const match = section.match(pattern);
    if (match && match[1]) {
      const value = parseInt(match[1]);
      if (!isNaN(value) && value >= 0 && value <= 100) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Extract out-of-network coinsurance (usually higher than in-network)
 */
function extractOutOfNetworkCoinsurance(section: string): number | undefined {
  const patterns = [
    /out.of.network[:\s]*(\d+)\s*%/i,
    /non.?participating[:\s]*(\d+)\s*%/i,
    /(\d+)\s*%\s*(?:out.of.network|non.?participating)/i,
  ];

  for (const pattern of patterns) {
    const match = section.match(pattern);
    if (match && match[1]) {
      const value = parseInt(match[1]);
      if (!isNaN(value) && value >= 0 && value <= 100) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Check if deductible applies to this service
 */
function checkDeductibleApplies(section: string): boolean {
  const appliesPatterns = [
    /deductible\s*(?:does\s*)?appl(?:y|ies)/i,
    /after\s*(?:the\s*)?(?:annual\s*)?deductible/i,
    /subject\s*to\s*(?:the\s*)?deductible/i,
    /deductible\s*(?:then|,)\s*\d+%/i,
  ];

  const notAppliesPatterns = [
    /(?:no|not?\s*)deductible/i,
    /deductible\s*(?:does\s*)?not\s*apply/i,
    /waived/i,
    /\$0\s*(?:copay)?.*no\s*deductible/i,
  ];

  // Check if explicitly waived
  for (const pattern of notAppliesPatterns) {
    if (pattern.test(section)) {
      return false;
    }
  }

  // Check if explicitly applies
  for (const pattern of appliesPatterns) {
    if (pattern.test(section)) {
      return true;
    }
  }

  // Default: assume deductible applies for most services
  return true;
}

/**
 * Check if prior authorization is required
 */
function checkPreAuthRequired(section: string): boolean {
  const patterns = [
    /pre.?auth(?:orization)?\s*(?:is\s*)?required/i,
    /prior\s*auth(?:orization)?\s*(?:is\s*)?required/i,
    /requires?\s*pre.?auth/i,
    /requires?\s*prior\s*auth/i,
    /\bpa\s*required\b/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(section)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if service is covered
 */
function checkCovered(section: string): boolean {
  const notCoveredPatterns = [
    /not\s*covered/i,
    /no\s*coverage/i,
    /excluded/i,
    /not\s*a\s*covered\s*benefit/i,
    /you\s*pay\s*(?:the\s*)?full\s*cost/i,
  ];

  for (const pattern of notCoveredPatterns) {
    if (pattern.test(section)) {
      return false;
    }
  }
  return true;
}

/**
 * Extract visit/day limits for a service
 */
function extractLimits(section: string): string | undefined {
  const patterns = [
    /(?:limit(?:ed)?|up)\s*(?:to|of)\s*(\d+)\s*(?:visit|day|session|treatment)/i,
    /(\d+)\s*(?:visit|day|session|treatment)\s*(?:limit|per\s*year|annually)/i,
    /maximum\s*(?:of\s*)?(\d+)\s*(?:visit|day|session|treatment)/i,
  ];

  for (const pattern of patterns) {
    const match = section.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  return undefined;
}

/**
 * Calculate SBC extraction confidence based on multiple factors
 */
function calculateEnhancedSBCConfidence(
  text: string,
  extractedFields: {
    planName: boolean;
    insurerName: boolean;
    deductible: boolean;
    oopMax: boolean;
    benefitCount: number;
  }
): { confidence: number; factors: string[] } {
  let confidence = 0.3;
  const factors: string[] = [];

  // Document appears to be an SBC
  if (/summary\s*of\s*benefits\s*(?:and\s*)?coverage/i.test(text)) {
    confidence += 0.15;
    factors.push('SBC document identified');
  }

  // Coverage period found
  if (/coverage\s*period/i.test(text)) {
    confidence += 0.05;
    factors.push('coverage period found');
  }

  // Plan name extracted
  if (extractedFields.planName) {
    confidence += 0.1;
    factors.push('plan name extracted');
  }

  // Insurer name extracted
  if (extractedFields.insurerName) {
    confidence += 0.1;
    factors.push('insurer name extracted');
  }

  // Deductible found
  if (extractedFields.deductible) {
    confidence += 0.1;
    factors.push('deductible found');
  }

  // Out-of-pocket max found
  if (extractedFields.oopMax) {
    confidence += 0.1;
    factors.push('OOP max found');
  }

  // Benefits extracted
  if (extractedFields.benefitCount >= 5) {
    confidence += 0.05;
    factors.push(`${extractedFields.benefitCount} benefits extracted`);
  }
  if (extractedFields.benefitCount >= 10) {
    confidence += 0.05;
    factors.push('comprehensive benefits');
  }
  if (extractedFields.benefitCount >= 15) {
    confidence += 0.05;
    factors.push('extensive benefits');
  }

  // Common insurance terms present
  if (/copay|coinsurance|in.network|out.of.network/i.test(text)) {
    confidence += 0.05;
    factors.push('insurance terminology present');
  }

  return { confidence: Math.min(confidence, 1.0), factors };
}

/**
 * Parse an insurance SBC PDF and extract plan details
 */
export async function parseSBC(buffer: Buffer, filename: string): Promise<{
  plan: ParsedInsurancePlan;
  rawText: string;
}> {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestError('PDF file is empty or invalid');
  }

  let pdf: PDFParser;
  let pdfResult: PDFParseResult;
  let text: string;

  try {
    pdf = await getPdfParser();
  } catch (error) {
    console.error('[pdfParser:SBC] Failed to load PDF parser:', error);
    throw new InternalServerError('PDF parsing service is unavailable');
  }

  try {
    pdfResult = await pdf(buffer);
    text = pdfResult.text;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[pdfParser:SBC] Failed to parse SBC PDF "${filename}":`, errorMsg);
    throw new BadRequestError(`Unable to parse SBC PDF file. The file may be corrupted, password-protected, or in an unsupported format.`);
  }

  if (!text || text.trim().length === 0) {
    throw new BadRequestError('SBC PDF file appears to be empty or contains no extractable text. Please ensure the PDF contains readable text.');
  }

  console.log(`[pdfParser:SBC] Parsing SBC document: ${filename} (${text.length} chars extracted)`);

  // ============================================
  // EXTRACT PLAN IDENTIFICATION
  // ============================================

  let planName: string | undefined;
  let insurerName: string | undefined;

  // Try all plan name patterns
  const planNameResult = tryPatterns(text, SBC_EXTRACTION_PATTERNS.planName);
  if (planNameResult.match && planNameResult.match[1]) {
    planName = planNameResult.match[1].trim().substring(0, 200);
    logSBCExtraction({
      field: 'planName',
      rawMatch: planNameResult.match[0],
      extractedValue: planName,
      confidence: 0.8,
      source: `pattern ${planNameResult.patternIndex + 1}`,
    });
  }

  // Try all insurer name patterns
  const insurerResult = tryPatterns(text, SBC_EXTRACTION_PATTERNS.insurerName);
  if (insurerResult.match && insurerResult.match[1]) {
    insurerName = insurerResult.match[1].trim().substring(0, 200);
    logSBCExtraction({
      field: 'insurerName',
      rawMatch: insurerResult.match[0],
      extractedValue: insurerName,
      confidence: 0.85,
      source: `pattern ${insurerResult.patternIndex + 1}`,
    });
  }

  // ============================================
  // EXTRACT PLAN TYPE
  // ============================================

  let planType: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP' | undefined;

  // Try explicit network type patterns first
  const networkResult = tryPatterns(text, SBC_EXTRACTION_PATTERNS.networkType);
  if (networkResult.match && networkResult.match[1]) {
    const matchedType = networkResult.match[1].toUpperCase();
    if (['HMO', 'PPO', 'EPO', 'POS', 'HDHP'].includes(matchedType)) {
      planType = matchedType as 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';
    }
  }

  // Fall back to keyword detection
  if (!planType) {
    if (/hdhp|high\s*deductible\s*health\s*plan/i.test(text)) planType = 'HDHP';
    else if (/\bhmo\b|health\s*maintenance\s*organization/i.test(text)) planType = 'HMO';
    else if (/\bppo\b|preferred\s*provider\s*organization/i.test(text)) planType = 'PPO';
    else if (/\bepo\b|exclusive\s*provider\s*organization/i.test(text)) planType = 'EPO';
    else if (/\bpos\b|point\s*of\s*service/i.test(text)) planType = 'POS';
  }

  if (planType) {
    logSBCExtraction({
      field: 'planType',
      rawMatch: planType,
      extractedValue: planType,
      confidence: networkResult.match ? 0.9 : 0.7,
      source: networkResult.match ? 'explicit pattern' : 'keyword detection',
    });
  }

  // ============================================
  // EXTRACT DEDUCTIBLES
  // ============================================

  let deductible: number | undefined;
  let deductibleFamily: number | undefined;

  const deductibleResult = tryPatterns(text, SBC_EXTRACTION_PATTERNS.deductibleIndividual);
  if (deductibleResult.match && deductibleResult.match[1]) {
    deductible = parseNumber(deductibleResult.match[1]);
    logSBCExtraction({
      field: 'deductible (individual)',
      rawMatch: deductibleResult.match[0],
      extractedValue: deductible,
      confidence: 0.85,
      source: `pattern ${deductibleResult.patternIndex + 1}`,
    });
  }

  const deductibleFamilyResult = tryPatterns(text, SBC_EXTRACTION_PATTERNS.deductibleFamily);
  if (deductibleFamilyResult.match && deductibleFamilyResult.match[1]) {
    deductibleFamily = parseNumber(deductibleFamilyResult.match[1]);
    logSBCExtraction({
      field: 'deductible (family)',
      rawMatch: deductibleFamilyResult.match[0],
      extractedValue: deductibleFamily,
      confidence: 0.85,
      source: `pattern ${deductibleFamilyResult.patternIndex + 1}`,
    });
  }

  // If only individual found, estimate family as 2x
  if (deductible && !deductibleFamily) {
    deductibleFamily = deductible * 2;
  }

  // ============================================
  // EXTRACT OUT-OF-POCKET MAXIMUMS
  // ============================================

  let outOfPocketMax: number | undefined;
  let outOfPocketMaxFamily: number | undefined;

  const oopResult = tryPatterns(text, SBC_EXTRACTION_PATTERNS.oopMaxIndividual);
  if (oopResult.match && oopResult.match[1]) {
    outOfPocketMax = parseNumber(oopResult.match[1]);
    logSBCExtraction({
      field: 'OOP max (individual)',
      rawMatch: oopResult.match[0],
      extractedValue: outOfPocketMax,
      confidence: 0.85,
      source: `pattern ${oopResult.patternIndex + 1}`,
    });
  }

  const oopFamilyResult = tryPatterns(text, SBC_EXTRACTION_PATTERNS.oopMaxFamily);
  if (oopFamilyResult.match && oopFamilyResult.match[1]) {
    outOfPocketMaxFamily = parseNumber(oopFamilyResult.match[1]);
    logSBCExtraction({
      field: 'OOP max (family)',
      rawMatch: oopFamilyResult.match[0],
      extractedValue: outOfPocketMaxFamily,
      confidence: 0.85,
      source: `pattern ${oopFamilyResult.patternIndex + 1}`,
    });
  }

  // If only individual found, estimate family as 2x
  if (outOfPocketMax && !outOfPocketMaxFamily) {
    outOfPocketMaxFamily = outOfPocketMax * 2;
  }

  // ============================================
  // EXTRACT BENEFITS/SERVICES
  // ============================================

  const benefits: ParsedBenefit[] = [];
  const foundServices = new Set<string>();

  for (const serviceDef of SERVICE_DEFINITIONS) {
    // Try each pattern for this service
    for (const pattern of serviceDef.patterns) {
      if (foundServices.has(serviceDef.name)) break;

      const match = text.match(pattern);
      if (!match) continue;

      // Extract surrounding context (up to 800 chars after match)
      const matchIndex = text.indexOf(match[0]);
      const contextStart = Math.max(0, matchIndex);
      const contextEnd = Math.min(text.length, matchIndex + match[0].length + 800);
      const section = text.substring(contextStart, contextEnd);

      // Extract coverage details from context
      const inNetworkCopay = extractCopay(section);
      const inNetworkCoinsurance = extractCoinsurance(section);
      const outNetworkCoinsurance = extractOutOfNetworkCoinsurance(section) ??
        (inNetworkCoinsurance ? Math.min(inNetworkCoinsurance + 20, 50) : 40);
      const deductibleApplies = checkDeductibleApplies(section);
      const preAuthRequired = checkPreAuthRequired(section);
      const covered = checkCovered(section);
      const limitations = extractLimits(section);

      // If no explicit values found, use common defaults for this service type
      const finalCopay = inNetworkCopay ?? serviceDef.commonCopays?.min;
      const finalCoinsurance = inNetworkCoinsurance ?? serviceDef.commonCoinsurance?.min;

      foundServices.add(serviceDef.name);

      const benefit: ParsedBenefit = {
        serviceName: serviceDef.name,
        serviceCategory: serviceDef.category,
        inNetworkCoverage: {
          covered,
          copay: finalCopay,
          coinsurance: finalCoinsurance,
          deductibleApplies,
        },
        outNetworkCoverage: {
          covered: covered && !/out.of.network.*not\s*covered/i.test(section),
          copay: finalCopay ? Math.round(finalCopay * 1.5) : undefined,
          coinsurance: outNetworkCoinsurance,
          deductibleApplies: true,
        },
        preAuthRequired,
      };

      benefits.push(benefit);

      logSBCExtraction({
        field: `benefit: ${serviceDef.name}`,
        rawMatch: match[0].substring(0, 50),
        extractedValue: `copay: $${finalCopay ?? 'N/A'}, coinsurance: ${finalCoinsurance ?? 'N/A'}%`,
        confidence: inNetworkCopay || inNetworkCoinsurance ? 0.8 : 0.6,
        source: limitations ? `with limit: ${limitations}` : 'standard extraction',
      });

      break; // Found this service, move to next
    }
  }

  // Sort benefits by category for organization
  const categoryOrder = [
    'Preventive', 'Office Visits', 'Emergency', 'Hospital',
    'Mental Health', 'Pharmacy', 'Diagnostic', 'Therapy',
    'Maternity', 'Vision', 'Dental', 'Equipment', 'Home Care'
  ];
  benefits.sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a.serviceCategory);
    const bIndex = categoryOrder.indexOf(b.serviceCategory);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  // ============================================
  // CALCULATE CONFIDENCE & BUILD RESULT
  // ============================================

  const { confidence, factors } = calculateEnhancedSBCConfidence(text, {
    planName: !!planName,
    insurerName: !!insurerName,
    deductible: !!deductible,
    oopMax: !!outOfPocketMax,
    benefitCount: benefits.length,
  });

  console.log(`[pdfParser:SBC] Extraction complete:`);
  console.log(`  Plan: ${planName || 'Unknown'} (${planType || 'Unknown type'})`);
  console.log(`  Insurer: ${insurerName || 'Unknown'}`);
  console.log(`  Deductible: $${deductible || 'N/A'} individual / $${deductibleFamily || 'N/A'} family`);
  console.log(`  OOP Max: $${outOfPocketMax || 'N/A'} individual / $${outOfPocketMaxFamily || 'N/A'} family`);
  console.log(`  Benefits extracted: ${benefits.length}`);
  console.log(`  Confidence: ${(confidence * 100).toFixed(1)}% (${factors.join(', ')})`);

  const plan: ParsedInsurancePlan = {
    planName,
    insurerName,
    planType,
    deductible,
    deductibleFamily,
    outOfPocketMax,
    outOfPocketMaxFamily,
    benefits,
    extractionConfidence: confidence,
  };

  return {
    plan,
    rawText: text.substring(0, 10000), // Store more text for multi-page documents
  };
}

// Helper functions
function parseNumber(str: string): number {
  return parseInt(str.replace(/,/g, ''), 10);
}

export default {
  parseLabReport,
  parseSBC,
};
