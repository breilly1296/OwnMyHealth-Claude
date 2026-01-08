/**
 * Biomarker Patterns for OCR Extraction
 *
 * Defines regex patterns and normalization rules for extracting
 * biomarkers from lab result OCR text, optimized for Quest Diagnostics format.
 *
 * Supports comprehensive lab panels including:
 * - Basic Metabolic Panel (BMP)
 * - Comprehensive Metabolic Panel (CMP)
 * - Lipid Panel
 * - Thyroid Panel
 * - Complete Blood Count (CBC)
 * - Bone Health markers
 */

/**
 * All supported biomarker categories
 * Keep in sync with frontend src/types/index.ts BiomarkerCategoryType
 */
export const BIOMARKER_CATEGORIES = [
  // Existing categories
  'Body Composition',
  'Blood',
  'Hormones',
  'Vitamins',
  'Calcium CT',
  'Vital Signs',
  'Lipids',
  'Kidney Function',
  'Liver Function',
  'Inflammation Markers',
  'Electrolytes',
  'EKG',
  // New categories
  'Thyroid',
  'Diabetes',
  'Cardiac',
  'Iron Studies',
  'Bone Health',
  'Coagulation',
  'Autoimmune',
  'Other',
] as const;

export type BiomarkerCategory = (typeof BIOMARKER_CATEGORIES)[number];

/**
 * Category metadata for display and organization
 */
export const CATEGORY_METADATA: Record<BiomarkerCategory, { description: string; icon: string }> = {
  'Body Composition': { description: 'Body composition measurements including body fat and lean mass', icon: 'Scale' },
  'Blood': { description: 'Complete blood count and metabolic panel', icon: 'Droplets' },
  'Hormones': { description: 'Hormone levels and endocrine function', icon: 'Activity' },
  'Vitamins': { description: 'Vitamin and mineral levels', icon: 'Zap' },
  'Calcium CT': { description: 'Coronary calcium CT scan results', icon: 'Heart' },
  'Vital Signs': { description: 'Basic vital measurements', icon: 'HeartPulse' },
  'Lipids': { description: 'Cholesterol and triglyceride levels', icon: 'Droplet' },
  'Kidney Function': { description: 'Kidney health markers', icon: 'Bean' },
  'Liver Function': { description: 'Liver enzyme and function tests', icon: 'Pill' },
  'Inflammation Markers': { description: 'Inflammation and immune response', icon: 'Flame' },
  'Electrolytes': { description: 'Electrolyte balance', icon: 'Bolt' },
  'EKG': { description: 'Electrocardiogram results', icon: 'Activity' },
  'Thyroid': { description: 'Thyroid function and hormone levels', icon: 'Waves' },
  'Diabetes': { description: 'Blood sugar and diabetes markers', icon: 'Candy' },
  'Cardiac': { description: 'Heart health and cardiac markers', icon: 'Heart' },
  'Iron Studies': { description: 'Iron levels and related markers', icon: 'CircleDot' },
  'Bone Health': { description: 'Bone density and metabolism markers', icon: 'Bone' },
  'Coagulation': { description: 'Blood clotting and coagulation factors', icon: 'Timer' },
  'Autoimmune': { description: 'Autoimmune markers and antibodies', icon: 'ShieldAlert' },
  'Other': { description: 'Other biomarkers and tests', icon: 'Activity' },
};

export interface BiomarkerPattern {
  /** Display name for the biomarker */
  name: string;
  /** Alternative names/aliases to match */
  aliases: string[];
  /** Biomarker category - must be one of BIOMARKER_CATEGORIES */
  category: BiomarkerCategory;
  /** Default unit if not detected */
  defaultUnit: string;
  /** Normal reference range */
  normalRange: {
    min: number;
    max: number;
  };
  /** Alternative unit ranges */
  unitRanges?: Record<string, { min: number; max: number }>;
  /** Regex patterns to match this biomarker in OCR text */
  patterns: RegExp[];
}

/**
 * Comprehensive biomarker definitions for common lab tests
 */
export const ALL_BIOMARKERS: BiomarkerPattern[] = [
  // ===== BASIC/COMPREHENSIVE METABOLIC PANEL =====
  {
    name: 'Glucose',
    aliases: ['blood glucose', 'fasting glucose', 'blood sugar', 'glu'],
    category: 'Diabetes',
    defaultUnit: 'mg/dL',
    normalRange: { min: 70, max: 100 },
    patterns: [
      /\bglucose\s+(\d+\.?\d*)/i,
      /\bglucose[,\s.:]+(\d+\.?\d*)/i,
      /\bglu\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'BUN',
    aliases: ['blood urea nitrogen', 'urea nitrogen'],
    category: 'Kidney Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 7, max: 20 },
    patterns: [
      /\bbun\b\s+(\d+\.?\d*)/i,
      /\burea\s+nitrogen\s+(\d+\.?\d*)/i,
      /\bblood\s+urea\s+nitrogen\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Creatinine',
    aliases: ['creat', 'serum creatinine'],
    category: 'Kidney Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0.7, max: 1.3 },
    patterns: [
      /\bcreatinine\s+(\d+\.?\d*)/i,
      /\bcreat\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'eGFR',
    aliases: ['estimated gfr', 'gfr', 'glomerular filtration rate'],
    category: 'Kidney Function',
    defaultUnit: 'mL/min/1.73m2',
    normalRange: { min: 90, max: 120 },
    patterns: [
      /\begfr\b\s+[>]?(\d+\.?\d*)/i,
      /\bgfr\b\s+[>]?(\d+\.?\d*)/i,
      /glomerular\s+filtration\s+[>]?(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Sodium',
    aliases: ['na', 'serum sodium'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 136, max: 145 },
    patterns: [
      /\bsodium\s+(\d+\.?\d*)/i,
      /\bna\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Potassium',
    aliases: ['k', 'serum potassium'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 3.5, max: 5.0 },
    patterns: [
      /\bpotassium\s+(\d+\.?\d*)/i,
      /\bk\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Chloride',
    aliases: ['cl', 'serum chloride'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 98, max: 106 },
    patterns: [
      /\bchloride\s+(\d+\.?\d*)/i,
      /\bcl\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'CO2',
    aliases: ['carbon dioxide', 'bicarbonate', 'hco3', 'total co2'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 23, max: 29 },
    patterns: [
      /\bco2\b\s+(\d+\.?\d*)/i,
      /\bcarbon\s+dioxide\s+(\d+\.?\d*)/i,
      /\bbicarbonate\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Calcium',
    aliases: ['ca', 'serum calcium', 'total calcium'],
    category: 'Bone Health',
    defaultUnit: 'mg/dL',
    normalRange: { min: 8.5, max: 10.5 },
    patterns: [
      /\bcalcium\s+(\d+\.?\d*)/i,
      /\bcalcium[,\s.:]+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Phosphorus',
    aliases: ['phosphate', 'phos', 'inorganic phosphorus'],
    category: 'Bone Health',
    defaultUnit: 'mg/dL',
    normalRange: { min: 2.5, max: 4.5 },
    patterns: [
      /\bphosphorus\s+(\d+\.?\d*)/i,
      /\bphosphate\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Total Protein',
    aliases: ['protein total', 'serum protein'],
    category: 'Liver Function',
    defaultUnit: 'g/dL',
    normalRange: { min: 6.0, max: 8.3 },
    patterns: [
      /\btotal\s+protein\s+(\d+\.?\d*)/i,
      /\bprotein[,\s]+total\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Albumin',
    aliases: ['alb', 'serum albumin'],
    category: 'Liver Function',
    defaultUnit: 'g/dL',
    normalRange: { min: 3.5, max: 5.0 },
    patterns: [
      /\balbumin\s+(\d+\.?\d*)/i,
      /\balb\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Bilirubin',
    aliases: ['total bilirubin', 'tbili', 'bili'],
    category: 'Liver Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0.1, max: 1.2 },
    patterns: [
      /\bbilirubin\s+(\d+\.?\d*)/i,
      /\btotal\s+bilirubin\s+(\d+\.?\d*)/i,
      /\btbili\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Alkaline Phosphatase',
    aliases: ['alk phos', 'alp', 'alkp'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 44, max: 147 },
    patterns: [
      /\balkaline\s+phosphatase\s+(\d+\.?\d*)/i,
      /\balk\s*phos\s+(\d+\.?\d*)/i,
      /\balp\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'AST',
    aliases: ['sgot', 'aspartate aminotransferase'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 10, max: 40 },
    patterns: [
      /\bast\b\s+(\d+\.?\d*)/i,
      /\bsgot\b\s+(\d+\.?\d*)/i,
      /\baspartate\s+amino\s*transferase\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'ALT',
    aliases: ['sgpt', 'alanine aminotransferase'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 7, max: 56 },
    patterns: [
      /\balt\b\s+(\d+\.?\d*)/i,
      /\bsgpt\b\s+(\d+\.?\d*)/i,
      /\balanine\s+amino\s*transferase\s+(\d+\.?\d*)/i,
    ],
  },

  // ===== LIPID PANEL =====
  {
    name: 'Cholesterol',
    aliases: ['total cholesterol', 'chol'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 200 },
    patterns: [
      /\bcholesterol\s+(\d+\.?\d*)/i,
      /\btotal\s+cholesterol\s+(\d+\.?\d*)/i,
      /\bchol\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'HDL',
    aliases: ['hdl cholesterol', 'hdl-c', 'good cholesterol'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 40, max: 60 },
    patterns: [
      /\bhdl\b\s+(\d+\.?\d*)/i,
      /\bhdl\s+cholesterol\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'LDL',
    aliases: ['ldl cholesterol', 'ldl-c', 'bad cholesterol'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 100 },
    patterns: [
      /\bldl\b\s+(\d+\.?\d*)/i,
      /\bldl\s+cholesterol\s+(\d+\.?\d*)/i,
      /\bldl\s+calc\w*\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Triglycerides',
    aliases: ['trig', 'trigs'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 150 },
    patterns: [
      /\btriglycerides\s+(\d+\.?\d*)/i,
      /\btrig\b\s+(\d+\.?\d*)/i,
    ],
  },

  // ===== THYROID PANEL =====
  {
    name: 'TSH',
    aliases: ['thyroid stimulating hormone', 'thyrotropin'],
    category: 'Thyroid',
    defaultUnit: 'mIU/L',
    normalRange: { min: 0.4, max: 4.0 },
    patterns: [
      /\btsh\b\s+(\d+\.?\d*)/i,
      /\bthyroid\s+stimulating\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Free T4',
    aliases: ['ft4', 'free thyroxine', 't4 free'],
    category: 'Thyroid',
    defaultUnit: 'ng/dL',
    normalRange: { min: 0.8, max: 1.8 },
    patterns: [
      /\bfree\s+t4\s+(\d+\.?\d*)/i,
      /\bft4\b\s+(\d+\.?\d*)/i,
      /\bt4\s+free\s+(\d+\.?\d*)/i,
    ],
  },

  // ===== BONE HEALTH =====
  {
    name: 'Vitamin D',
    aliases: ['25-hydroxyvitamin d', '25-oh vitamin d', 'vit d'],
    category: 'Bone Health',
    defaultUnit: 'ng/mL',
    normalRange: { min: 30, max: 100 },
    patterns: [
      /\bvitamin\s*d\s+(\d+\.?\d*)/i,
      /\b25-?(?:oh|hydroxy)\s*(?:vitamin\s*)?d?\s+(\d+\.?\d*)/i,
      /\bvit\s*d\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'PTH',
    aliases: ['parathyroid hormone', 'pth intact'],
    category: 'Bone Health',
    defaultUnit: 'pg/mL',
    normalRange: { min: 15, max: 65 },
    patterns: [
      /\bpth\b\s+(\d+\.?\d*)/i,
      /\bparathyroid\s+hormone\s+(\d+\.?\d*)/i,
    ],
  },

  // ===== COMPLETE BLOOD COUNT (CBC) =====
  {
    name: 'WBC',
    aliases: ['white blood cell', 'white blood cells', 'leukocytes'],
    category: 'Blood',
    defaultUnit: 'K/uL',
    normalRange: { min: 4.5, max: 11.0 },
    patterns: [
      /\bwbc\b\s+(\d+\.?\d*)/i,
      /\bwhite\s+blood\s+cell\w*\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'RBC',
    aliases: ['red blood cell', 'red blood cells', 'erythrocytes'],
    category: 'Blood',
    defaultUnit: 'M/uL',
    normalRange: { min: 4.5, max: 5.5 },
    patterns: [
      /\brbc\b\s+(\d+\.?\d*)/i,
      /\bred\s+blood\s+cell\w*\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Hemoglobin',
    aliases: ['hgb', 'hb'],
    category: 'Blood',
    defaultUnit: 'g/dL',
    normalRange: { min: 12.0, max: 17.5 },
    patterns: [
      /\bhemoglobin\s+(\d+\.?\d*)/i,
      /\bhgb\b\s+(\d+\.?\d*)/i,
      /\bhb\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Hematocrit',
    aliases: ['hct'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 36, max: 50 },
    patterns: [
      /\bhematocrit\s+(\d+\.?\d*)/i,
      /\bhct\b\s+(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Platelets',
    aliases: ['plt', 'platelet count', 'thrombocytes'],
    category: 'Blood',
    defaultUnit: 'K/uL',
    normalRange: { min: 150, max: 400 },
    patterns: [
      /\bplatelets\s+(\d+\.?\d*)/i,
      /\bplt\b\s+(\d+\.?\d*)/i,
      /\bplatelet\s+count\s+(\d+\.?\d*)/i,
    ],
  },
];

// Legacy export for backward compatibility
export const BONE_HEALTH_BIOMARKERS = ALL_BIOMARKERS.filter(
  (b) => b.category === 'Bone Health'
);

/**
 * Extracted biomarker result from OCR text
 */
export interface ExtractedBiomarker {
  name: string;
  value: number;
  unit: string;
  category: string;
  normalRange: {
    min: number;
    max: number;
    source: string;
  };
  confidence: number;
  rawMatch: string;
}

/**
 * Unit normalization map
 */
const UNIT_NORMALIZATIONS: Record<string, string> = {
  'mg/dl': 'mg/dL',
  'mg/dL': 'mg/dL',
  'mmol/l': 'mmol/L',
  'mmol/L': 'mmol/L',
  'ng/ml': 'ng/mL',
  'ng/mL': 'ng/mL',
  'nmol/l': 'nmol/L',
  'nmol/L': 'nmol/L',
  'pg/ml': 'pg/mL',
  'pg/mL': 'pg/mL',
  'pmol/l': 'pmol/L',
  'pmol/L': 'pmol/L',
  'ng/l': 'ng/L',
  'ng/L': 'ng/L',
  'u/l': 'U/L',
  'U/L': 'U/L',
  'iu/l': 'IU/L',
  'IU/L': 'IU/L',
  'meq/l': 'mEq/L',
  'mEq/L': 'mEq/L',
  'g/dl': 'g/dL',
  'g/dL': 'g/dL',
  'miu/l': 'mIU/L',
  'mIU/L': 'mIU/L',
  'k/ul': 'K/uL',
  'K/uL': 'K/uL',
  'm/ul': 'M/uL',
  'M/uL': 'M/uL',
  '%': '%',
};

/**
 * Normalize unit string to standard format
 */
export function normalizeUnit(unit: string): string {
  const cleaned = unit.trim();
  return UNIT_NORMALIZATIONS[cleaned] || UNIT_NORMALIZATIONS[cleaned.toLowerCase()] || cleaned;
}

/**
 * Extract biomarkers using regex patterns
 */
function extractWithPatterns(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();

  for (const biomarker of ALL_BIOMARKERS) {
    if (foundNames.has(biomarker.name)) continue;

    for (const pattern of biomarker.patterns) {
      const match = text.match(pattern);
      if (!match) continue;

      const rawValue = match[1]?.trim();
      if (!rawValue) continue;

      const value = parseFloat(rawValue);
      if (isNaN(value) || value < 0 || value > 100000) continue;

      const rawUnit = match[2]?.trim() || biomarker.defaultUnit;
      const unit = normalizeUnit(rawUnit);

      let normalRange = biomarker.normalRange;
      if (biomarker.unitRanges && biomarker.unitRanges[unit]) {
        normalRange = biomarker.unitRanges[unit];
      }

      let confidence = 0.8;
      if (match[2]) confidence += 0.1;
      if (value >= normalRange.min * 0.5 && value <= normalRange.max * 2) {
        confidence += 0.1;
      }

      foundNames.add(biomarker.name);

      results.push({
        name: biomarker.name,
        value,
        unit,
        category: biomarker.category,
        normalRange: { ...normalRange, source: 'Standard Reference Range' },
        confidence: Math.min(confidence, 1.0),
        rawMatch: match[0].substring(0, 100),
      });

      console.log(`[BIOMARKER MATCH] ${biomarker.name}: ${value} ${unit} (pattern: ${pattern.source.substring(0, 50)})`);
      break;
    }
  }

  return results;
}

/**
 * Extract biomarkers using line-by-line analysis for tabular formats
 */
function extractFromLines(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();
  const lines = text.split('\n');

  console.log(`[LINE ANALYSIS] Processing ${lines.length} lines`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 3) continue;

    for (const biomarker of ALL_BIOMARKERS) {
      if (foundNames.has(biomarker.name)) continue;

      // Check if line contains the biomarker name or any alias
      const namesToCheck = [biomarker.name, ...biomarker.aliases];
      let matched = false;

      for (const name of namesToCheck) {
        const nameRegex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (nameRegex.test(line)) {
          matched = true;
          break;
        }
      }

      if (!matched) continue;

      // Find first number in this line or next line
      const numberMatch = line.match(/(\d+\.?\d*)/);
      let value: number | null = null;
      let rawMatch = line;

      if (numberMatch) {
        value = parseFloat(numberMatch[1]);
      } else if (i + 1 < lines.length) {
        // Check next line for number
        const nextLine = lines[i + 1].trim();
        const nextMatch = nextLine.match(/^(\d+\.?\d*)/);
        if (nextMatch) {
          value = parseFloat(nextMatch[1]);
          rawMatch = `${line} ${nextLine}`;
        }
      }

      if (value === null || isNaN(value) || value < 0 || value > 100000) continue;

      // Skip if value seems unreasonable for this biomarker
      const range = biomarker.normalRange;
      if (value < range.min * 0.01 || value > range.max * 100) continue;

      foundNames.add(biomarker.name);

      results.push({
        name: biomarker.name,
        value,
        unit: biomarker.defaultUnit,
        category: biomarker.category,
        normalRange: { ...range, source: 'Standard Reference Range' },
        confidence: 0.7,
        rawMatch: rawMatch.substring(0, 100),
      });

      console.log(`[LINE MATCH] ${biomarker.name}: ${value} ${biomarker.defaultUnit} from line: "${line.substring(0, 50)}"`);
      break;
    }
  }

  return results;
}

/**
 * Hybrid extraction: Try regex patterns first, then line-by-line analysis
 */
export function extractBiomarkersFromText(text: string): ExtractedBiomarker[] {
  console.log('[EXTRACTION] Starting hybrid biomarker extraction');
  console.log(`[EXTRACTION] Text length: ${text.length} chars`);

  // First try regex patterns
  const patternResults = extractWithPatterns(text);
  console.log(`[EXTRACTION] Pattern extraction found: ${patternResults.length} biomarkers`);

  // Then try line-by-line analysis for any we missed
  const lineResults = extractFromLines(text);
  console.log(`[EXTRACTION] Line extraction found: ${lineResults.length} biomarkers`);

  // Merge results, preferring pattern matches (higher confidence)
  const foundNames = new Set(patternResults.map((r) => r.name));
  const additionalFromLines = lineResults.filter((r) => !foundNames.has(r.name));

  const combined = [...patternResults, ...additionalFromLines];
  console.log(`[EXTRACTION] Total unique biomarkers: ${combined.length}`);

  return combined;
}

/**
 * Validate extracted biomarker values
 */
export function validateBiomarkerValue(
  name: string,
  value: number,
  unit: string
): { valid: boolean; reason?: string } {
  const biomarker = ALL_BIOMARKERS.find(
    (b) => b.name === name || b.aliases.some((a) => a.toLowerCase() === name.toLowerCase())
  );

  if (!biomarker) {
    // Unknown biomarker - still valid, just can't validate range
    return { valid: true };
  }

  let range = biomarker.normalRange;
  if (biomarker.unitRanges && biomarker.unitRanges[unit]) {
    range = biomarker.unitRanges[unit];
  }

  // Very permissive validation - just check for obviously wrong values
  if (value < range.min * 0.01 || value > range.max * 100) {
    return {
      valid: false,
      reason: `Value ${value} ${unit} is outside reasonable range for ${name}`,
    };
  }

  return { valid: true };
}

export default {
  ALL_BIOMARKERS,
  BONE_HEALTH_BIOMARKERS,
  extractBiomarkersFromText,
  validateBiomarkerValue,
  normalizeUnit,
};
