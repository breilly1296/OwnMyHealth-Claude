/**
 * Biomarker Patterns for OCR Extraction
 *
 * Defines regex patterns and normalization rules for extracting
 * bone health biomarkers from lab result OCR text.
 *
 * Focused on osteoporosis-related markers:
 * - Calcium
 * - Vitamin D (25-hydroxyvitamin D)
 * - PTH (Parathyroid Hormone)
 * - Phosphorus
 * - Alkaline Phosphatase
 */

export interface BiomarkerPattern {
  /** Display name for the biomarker */
  name: string;
  /** Alternative names/aliases to match */
  aliases: string[];
  /** Biomarker category */
  category: string;
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
 * Bone health biomarkers for osteoporosis tracking
 */
export const BONE_HEALTH_BIOMARKERS: BiomarkerPattern[] = [
  {
    name: 'Calcium',
    aliases: ['ca', 'serum calcium', 'total calcium', 'calcium, serum', 'calcium total'],
    category: 'Bone Health',
    defaultUnit: 'mg/dL',
    normalRange: { min: 8.5, max: 10.5 },
    unitRanges: {
      'mmol/L': { min: 2.12, max: 2.62 },
    },
    patterns: [
      // Flexible: CALCIUM then any chars (up to 50) then number
      /\bcalcium[\s\S]{0,50}?(\d+\.?\d*)\s*(mg\/d[lL]|mmol\/[lL])?/i,
      // CA shorthand - be more strict to avoid false positives
      /\bca\b[\s,:]{1,20}(\d+\.?\d*)\s*(mg\/d[lL]|mmol\/[lL])?/i,
      // Total/Serum calcium
      /(?:total|serum)\s+calcium[\s\S]{0,30}?(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Vitamin D',
    aliases: [
      '25-hydroxyvitamin d',
      '25-oh vitamin d',
      'vitamin d 25-hydroxy',
      '25-hydroxy vitamin d',
      'vit d',
      'd 25-oh',
      '25(oh)d',
      'cholecalciferol',
    ],
    category: 'Bone Health',
    defaultUnit: 'ng/mL',
    normalRange: { min: 30, max: 100 },
    unitRanges: {
      'nmol/L': { min: 75, max: 250 },
    },
    patterns: [
      // Flexible: VITAMIN D then any chars (up to 50) then number
      /vitamin\s*d[\s\S]{0,50}?(\d+\.?\d*)\s*(ng\/m[lL]|nmol\/[lL])?/i,
      // 25-OH or 25-HYDROXY VITAMIN D
      /25-?(?:oh|hydroxy)[\s\S]{0,40}?(\d+\.?\d*)\s*(ng\/m[lL]|nmol\/[lL])?/i,
      // VIT D shorthand
      /\bvit\.?\s*d[\s\S]{0,30}?(\d+\.?\d*)\s*(ng\/m[lL]|nmol\/[lL])?/i,
      // 25(OH)D format
      /25\s*\(?oh\)?\s*d[\s\S]{0,30}?(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'PTH',
    aliases: [
      'parathyroid hormone',
      'pth intact',
      'intact pth',
      'parathormone',
      'pth, intact',
    ],
    category: 'Bone Health',
    defaultUnit: 'pg/mL',
    normalRange: { min: 15, max: 65 },
    unitRanges: {
      'pmol/L': { min: 1.6, max: 6.9 },
      'ng/L': { min: 15, max: 65 },
    },
    patterns: [
      // Flexible: PTH then any chars (up to 50) then number
      /\bpth[\s\S]{0,50}?(\d+\.?\d*)\s*(pg\/m[lL]|pmol\/[lL]|ng\/[lL])?/i,
      // Parathyroid hormone
      /parathyroid\s*hormone[\s\S]{0,40}?(\d+\.?\d*)\s*(pg\/m[lL]|pmol\/[lL])?/i,
      // Intact PTH
      /intact\s+pth[\s\S]{0,30}?(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Phosphorus',
    aliases: ['phosphate', 'phos', 'inorganic phosphorus', 'serum phosphorus', 'phosphorus, serum'],
    category: 'Bone Health',
    defaultUnit: 'mg/dL',
    normalRange: { min: 2.5, max: 4.5 },
    unitRanges: {
      'mmol/L': { min: 0.81, max: 1.45 },
    },
    patterns: [
      // Flexible: PHOSPHORUS then any chars (up to 50) then number
      /\bphosphorus[\s\S]{0,50}?(\d+\.?\d*)\s*(mg\/d[lL]|mmol\/[lL])?/i,
      // Phosphate
      /\bphosphate[\s\S]{0,40}?(\d+\.?\d*)\s*(mg\/d[lL]|mmol\/[lL])?/i,
      // PHOS shorthand - more strict to avoid false positives
      /\bphos\b[\s,:]{1,20}(\d+\.?\d*)\s*(mg\/d[lL]|mmol\/[lL])?/i,
    ],
  },
  {
    name: 'Alkaline Phosphatase',
    aliases: ['alk phos', 'alp', 'alkaline phos', 'alk phosphatase', 'alkp'],
    category: 'Bone Health',
    defaultUnit: 'U/L',
    normalRange: { min: 44, max: 147 },
    unitRanges: {
      'IU/L': { min: 44, max: 147 },
    },
    patterns: [
      // Flexible: ALKALINE PHOSPHATASE then any chars (up to 50) then number
      /alkaline\s*phosphatase[\s\S]{0,50}?(\d+\.?\d*)\s*([uU]\/[lL]|[iI][uU]\/[lL])?/i,
      // ALK PHOS variations
      /\balk(?:aline)?\.?\s*phos(?:phatase)?[\s\S]{0,40}?(\d+\.?\d*)\s*([uU]\/[lL]|[iI][uU]\/[lL])?/i,
      // ALP shorthand - more strict
      /\balp\b[\s,:]{1,20}(\d+\.?\d*)\s*([uU]\/[lL]|[iI][uU]\/[lL])?/i,
      // ALKP shorthand
      /\balkp\b[\s,:]{1,20}(\d+\.?\d*)/i,
    ],
  },
];

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
};

/**
 * Normalize unit string to standard format
 */
export function normalizeUnit(unit: string): string {
  const cleaned = unit.trim();
  return UNIT_NORMALIZATIONS[cleaned] || UNIT_NORMALIZATIONS[cleaned.toLowerCase()] || cleaned;
}

/**
 * Extract biomarkers from OCR text
 */
export function extractBiomarkersFromText(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();

  for (const biomarker of BONE_HEALTH_BIOMARKERS) {
    if (foundNames.has(biomarker.name)) continue;

    for (const pattern of biomarker.patterns) {
      const match = text.match(pattern);
      if (!match) continue;

      // Extract value (group 1)
      const rawValue = match[1]?.trim();
      if (!rawValue) continue;

      // Parse value, handling < or > prefixes
      const valueMatch = rawValue.match(/([<>]?)\s*(\d+\.?\d*)/);
      if (!valueMatch) continue;

      const value = parseFloat(valueMatch[2]);
      if (isNaN(value) || value < 0 || value > 100000) continue;

      // Extract unit (group 2) or use default
      const rawUnit = match[2]?.trim() || biomarker.defaultUnit;
      const unit = normalizeUnit(rawUnit);

      // Get appropriate normal range based on unit
      let normalRange = biomarker.normalRange;
      if (biomarker.unitRanges && biomarker.unitRanges[unit]) {
        normalRange = biomarker.unitRanges[unit];
      }

      // Calculate confidence based on match quality
      let confidence = 0.7;
      if (match[2]) confidence += 0.1; // Unit was detected
      if (value >= normalRange.min * 0.5 && value <= normalRange.max * 2) {
        confidence += 0.1; // Value is reasonable
      }
      if (match[0].toLowerCase().includes(biomarker.name.toLowerCase())) {
        confidence += 0.1; // Exact name match
      }

      foundNames.add(biomarker.name);

      results.push({
        name: biomarker.name,
        value,
        unit,
        category: biomarker.category,
        normalRange: {
          ...normalRange,
          source: 'Standard Reference Range',
        },
        confidence: Math.min(confidence, 1.0),
        rawMatch: match[0].substring(0, 100),
      });

      break; // Found this biomarker, move to next
    }
  }

  return results;
}

/**
 * Validate extracted biomarker values
 */
export function validateBiomarkerValue(
  name: string,
  value: number,
  unit: string
): { valid: boolean; reason?: string } {
  const biomarker = BONE_HEALTH_BIOMARKERS.find(
    (b) => b.name === name || b.aliases.some((a) => a.toLowerCase() === name.toLowerCase())
  );

  if (!biomarker) {
    return { valid: false, reason: 'Unknown biomarker' };
  }

  // Get appropriate range for unit
  let range = biomarker.normalRange;
  if (biomarker.unitRanges && biomarker.unitRanges[unit]) {
    range = biomarker.unitRanges[unit];
  }

  // Check if value is within a reasonable range (10x outside normal)
  if (value < range.min * 0.1 || value > range.max * 10) {
    return {
      valid: false,
      reason: `Value ${value} ${unit} is outside reasonable range for ${name}`,
    };
  }

  return { valid: true };
}

export default {
  BONE_HEALTH_BIOMARKERS,
  extractBiomarkersFromText,
  validateBiomarkerValue,
  normalizeUnit,
};
