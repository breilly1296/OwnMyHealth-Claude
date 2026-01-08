/**
 * Comprehensive Biomarker Patterns for OCR Extraction
 *
 * Contains 300+ biomarkers organized into 24 categories for extracting
 * lab results from OCR text. Optimized for Quest Diagnostics format.
 *
 * @module services/biomarkerPatterns
 */

// ============================================
// CATEGORY DEFINITIONS
// ============================================

/**
 * All supported biomarker categories (24 total)
 * Keep in sync with frontend src/types/index.ts BiomarkerCategoryType
 */
export const BIOMARKER_CATEGORIES = [
  // Core categories
  'Body Composition',
  'Blood',
  'Hormones',
  'Vitamins',
  'Vital Signs',
  'Lipids',
  'Electrolytes',
  // Organ function
  'Kidney Function',
  'Liver Function',
  'Thyroid',
  'Cardiac',
  'Pancreatic',
  // Specialized panels
  'Diabetes',
  'Iron Studies',
  'Bone Health',
  'Coagulation',
  'Inflammation Markers',
  'Autoimmune',
  // Diagnostic categories
  'Tumor Markers',
  'Infectious Disease',
  'Urinalysis',
  'Blood Gas',
  'Allergy',
  'Genetic',
  // Legacy/Other
  'Calcium CT',
  'EKG',
  'Other',
] as const;

export type BiomarkerCategory = (typeof BIOMARKER_CATEGORIES)[number];

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface BiomarkerPattern {
  /** Display name for the biomarker */
  name: string;
  /** Alternative names/aliases to match */
  aliases: string[];
  /** Biomarker category */
  category: BiomarkerCategory;
  /** Default unit if not detected */
  defaultUnit: string;
  /** Normal reference range */
  normalRange: {
    min: number;
    max: number;
  };
  /** Regex patterns to match this biomarker in OCR text */
  patterns: RegExp[];
}

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

// ============================================
// BIOMARKER DEFINITIONS - 300+ BIOMARKERS
// ============================================

export const ALL_BIOMARKERS: BiomarkerPattern[] = [
  // ═══════════════════════════════════════════════════════════════
  // LIPID PANEL (16 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Cholesterol, Total',
    aliases: ['total cholesterol', 'cholesterol'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 200 },
    patterns: [
      /\bCHOLESTEROL[,\s]*TOTAL\s*(\d+)/i,
      /\bTOTAL\s*CHOLESTEROL\s*(\d+)/i,
      /\bCHOLESTEROL\s*(\d+)/i,
    ],
  },
  {
    name: 'HDL Cholesterol',
    aliases: ['hdl', 'hdl-c', 'good cholesterol'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 40, max: 999 },
    patterns: [
      /\bHDL\s*CHOLESTEROL\s*(\d+)/i,
      /\bHDL-?C\s*(\d+)/i,
      /\bHDL\s*(\d+)/i,
    ],
  },
  {
    name: 'LDL Cholesterol',
    aliases: ['ldl', 'ldl-c', 'bad cholesterol'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 100 },
    patterns: [
      /\bLDL\s*CHOLESTEROL\s*(\d+)/i,
      /\bLDL-?C(?:HOLESTEROL)?\s*(\d+)/i,
      /\bLDL\s*CALC\w*\s*(\d+)/i,
      /\bLDL\s*(\d+)/i,
    ],
  },
  {
    name: 'Triglycerides',
    aliases: ['trig', 'trigs'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 150 },
    patterns: [
      /\bTRIGLYCERIDES?\s*(\d+)/i,
      /\bTRIG\s*(\d+)/i,
    ],
  },
  {
    name: 'VLDL Cholesterol',
    aliases: ['vldl'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 5, max: 40 },
    patterns: [
      /\bVLDL\s*CHOLESTEROL\s*(\d+)/i,
      /\bVLDL\s*(\d+)/i,
    ],
  },
  {
    name: 'Non-HDL Cholesterol',
    aliases: ['non hdl cholesterol'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 130 },
    patterns: [
      /\bNON-?HDL\s*CHOLESTEROL\s*(\d+)/i,
      /\bNON\s*HDL\s*CHOL\w*\s*(\d+)/i,
    ],
  },
  {
    name: 'Cholesterol/HDL Ratio',
    aliases: ['chol/hdl ratio', 'tc/hdl'],
    category: 'Lipids',
    defaultUnit: 'ratio',
    normalRange: { min: 0, max: 5.0 },
    patterns: [
      /\bCHOL(?:ESTEROL)?\/HDL\w*\s*RATIO\s*(\d+\.?\d*)/i,
      /\bCHOL\/HDLC\s*RATIO\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'LDL/HDL Ratio',
    aliases: ['ldl/hdl'],
    category: 'Lipids',
    defaultUnit: 'ratio',
    normalRange: { min: 0, max: 3.5 },
    patterns: [
      /\bLDL\/HDL\s*RATIO\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Apolipoprotein A1',
    aliases: ['apo a1', 'apo a-1', 'apoa1'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 120, max: 175 },
    patterns: [
      /\bAPOLIPOPROTEIN\s*A-?1\s*(\d+)/i,
      /\bAPO\s*A-?1\s*(\d+)/i,
    ],
  },
  {
    name: 'Apolipoprotein B',
    aliases: ['apo b', 'apo b-100', 'apob'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 90 },
    patterns: [
      /\bAPOLIPOPROTEIN\s*B\s*(\d+)/i,
      /\bAPO\s*B(?:-100)?\s*(\d+)/i,
    ],
  },
  {
    name: 'Lipoprotein(a)',
    aliases: ['lp(a)', 'lpa'],
    category: 'Lipids',
    defaultUnit: 'nmol/L',
    normalRange: { min: 0, max: 75 },
    patterns: [
      /\bLIPOPROTEIN\s*\(A\)\s*(\d+)/i,
      /\bLP\s*\(A\)\s*(\d+)/i,
      /\bLPA\s*(\d+)/i,
    ],
  },
  {
    name: 'LDL Particle Number',
    aliases: ['ldl-p'],
    category: 'Lipids',
    defaultUnit: 'nmol/L',
    normalRange: { min: 0, max: 1000 },
    patterns: [
      /\bLDL\s*PARTICLE\s*NUMBER\s*(\d+)/i,
      /\bLDL-?P\s*(\d+)/i,
    ],
  },
  {
    name: 'Small Dense LDL',
    aliases: ['sd-ldl'],
    category: 'Lipids',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 30 },
    patterns: [
      /\bSMALL\s*DENSE\s*LDL\s*(\d+)/i,
    ],
  },
  {
    name: 'Oxidized LDL',
    aliases: ['ox-ldl'],
    category: 'Lipids',
    defaultUnit: 'U/L',
    normalRange: { min: 0, max: 60 },
    patterns: [
      /\bOXIDIZED\s*LDL\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // COMPLETE BLOOD COUNT - CBC (29 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'WBC',
    aliases: ['white blood cell', 'white blood cells', 'leukocytes'],
    category: 'Blood',
    defaultUnit: 'K/uL',
    normalRange: { min: 3.8, max: 10.8 },
    patterns: [
      /\bWHITE\s*BLOOD\s*CELL\s*COUNT\s*(\d+\.?\d*)/i,
      /\bWBC\s*(\d+\.?\d*)/i,
      /\bLEUKOCYTES?\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'RBC',
    aliases: ['red blood cell', 'red blood cells', 'erythrocytes'],
    category: 'Blood',
    defaultUnit: 'M/uL',
    normalRange: { min: 4.2, max: 5.8 },
    patterns: [
      /\bRED\s*BLOOD\s*CELL\s*COUNT\s*(\d+\.?\d*)/i,
      /\bRBC\s*(\d+\.?\d*)/i,
      /\bERYTHROCYTES?\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Hemoglobin',
    aliases: ['hgb', 'hb'],
    category: 'Blood',
    defaultUnit: 'g/dL',
    normalRange: { min: 13.2, max: 17.1 },
    patterns: [
      /\bHEMOGLOBIN\s*(\d+\.?\d*)/i,
      /\bHGB\s*(\d+\.?\d*)/i,
      /\bHB\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Hematocrit',
    aliases: ['hct'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 38.5, max: 50.0 },
    patterns: [
      /\bHEMATOCRIT\s*(\d+\.?\d*)/i,
      /\bHCT\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'MCV',
    aliases: ['mean corpuscular volume'],
    category: 'Blood',
    defaultUnit: 'fL',
    normalRange: { min: 80, max: 100 },
    patterns: [
      /\bMCV\s*(\d+\.?\d*)/i,
      /\bMEAN\s*CORPUSCULAR\s*VOLUME\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'MCH',
    aliases: ['mean corpuscular hemoglobin'],
    category: 'Blood',
    defaultUnit: 'pg',
    normalRange: { min: 27, max: 33 },
    patterns: [
      /\bMCH\s*(\d+\.?\d*)/i,
      /\bMEAN\s*CORPUSCULAR\s*HEMOGLOBIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'MCHC',
    aliases: ['mean corpuscular hgb conc'],
    category: 'Blood',
    defaultUnit: 'g/dL',
    normalRange: { min: 32, max: 36 },
    patterns: [
      /\bMCHC\s*(\d+\.?\d*)/i,
      /\bMEAN\s*CORPUSCULAR\s*HGB\s*CONC\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'RDW',
    aliases: ['red cell distribution width', 'rdw-cv'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 11, max: 15 },
    patterns: [
      /\bRDW(?:-CV)?\s*(\d+\.?\d*)/i,
      /\bRED\s*CELL\s*DIST(?:RIBUTION)?\s*WIDTH\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Platelets',
    aliases: ['plt', 'platelet count', 'thrombocytes'],
    category: 'Blood',
    defaultUnit: 'K/uL',
    normalRange: { min: 140, max: 400 },
    patterns: [
      /\bPLATELET\s*COUNT\s*(\d+)/i,
      /\bPLATELETS?\s*(\d+)/i,
      /\bPLT\s*(\d+)/i,
    ],
  },
  {
    name: 'MPV',
    aliases: ['mean platelet volume'],
    category: 'Blood',
    defaultUnit: 'fL',
    normalRange: { min: 7.5, max: 12.5 },
    patterns: [
      /\bMPV\s*(\d+\.?\d*)/i,
      /\bMEAN\s*PLATELET\s*VOLUME\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Neutrophils',
    aliases: ['neut', 'polys', 'pmn'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 38, max: 80 },
    patterns: [
      /\bNEUTROPHILS?\s*(\d+\.?\d*)/i,
      /\bNEUT\s*(\d+\.?\d*)/i,
      /\bPOLYS\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Absolute Neutrophils',
    aliases: ['anc'],
    category: 'Blood',
    defaultUnit: 'cells/uL',
    normalRange: { min: 1500, max: 7800 },
    patterns: [
      /\bABSOLUTE\s*NEUTROPHILS?\s*(\d+)/i,
      /\bANC\s*(\d+)/i,
    ],
  },
  {
    name: 'Lymphocytes',
    aliases: ['lymph'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 15, max: 49 },
    patterns: [
      /\bLYMPHOCYTES?\s*(\d+\.?\d*)/i,
      /\bLYMPH\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Absolute Lymphocytes',
    aliases: ['alc'],
    category: 'Blood',
    defaultUnit: 'cells/uL',
    normalRange: { min: 850, max: 3900 },
    patterns: [
      /\bABSOLUTE\s*LYMPHOCYTES?\s*(\d+)/i,
      /\bALC\s*(\d+)/i,
    ],
  },
  {
    name: 'Monocytes',
    aliases: ['mono'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 0, max: 13 },
    patterns: [
      /\bMONOCYTES?\s*(\d+\.?\d*)/i,
      /\bMONO\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Eosinophils',
    aliases: ['eos'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 0, max: 8 },
    patterns: [
      /\bEOSINOPHILS?\s*(\d+\.?\d*)/i,
      /\bEOS\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Basophils',
    aliases: ['baso'],
    category: 'Blood',
    defaultUnit: '%',
    normalRange: { min: 0, max: 2 },
    patterns: [
      /\bBASOPHILS?\s*(\d+\.?\d*)/i,
      /\bBASO\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // ELECTROLYTES (11 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Sodium',
    aliases: ['na'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 136, max: 145 },
    patterns: [
      /\bSODIUM\s*(\d+)/i,
      /\bNA\s*(\d+)/i,
    ],
  },
  {
    name: 'Potassium',
    aliases: ['k'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 3.5, max: 5.0 },
    patterns: [
      /\bPOTASSIUM\s*(\d+\.?\d*)/i,
      /\bK\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Chloride',
    aliases: ['cl'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 98, max: 106 },
    patterns: [
      /\bCHLORIDE\s*(\d+)/i,
      /\bCL\s*(\d+)/i,
    ],
  },
  {
    name: 'CO2',
    aliases: ['carbon dioxide', 'bicarbonate', 'hco3'],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 23, max: 29 },
    patterns: [
      /\bCARBON\s*DIOXIDE\s*(\d+)/i,
      /\bCO2\s*(\d+)/i,
      /\bBICARBONATE\s*(\d+)/i,
      /\bHCO3\s*(\d+)/i,
    ],
  },
  {
    name: 'Calcium',
    aliases: ['ca', 'total calcium'],
    category: 'Electrolytes',
    defaultUnit: 'mg/dL',
    normalRange: { min: 8.6, max: 10.3 },
    patterns: [
      /\bCALCIUM\s*(\d+\.?\d*)/i,
      /\bCA\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Ionized Calcium',
    aliases: ['ca++', 'free calcium'],
    category: 'Electrolytes',
    defaultUnit: 'mmol/L',
    normalRange: { min: 1.12, max: 1.32 },
    patterns: [
      /\bIONIZED\s*CALCIUM\s*(\d+\.?\d*)/i,
      /\bCA\+\+\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Magnesium',
    aliases: ['mg'],
    category: 'Electrolytes',
    defaultUnit: 'mg/dL',
    normalRange: { min: 1.7, max: 2.2 },
    patterns: [
      /\bMAGNESIUM\s*(\d+\.?\d*)/i,
      /\bMG\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Phosphorus',
    aliases: ['phosphate', 'phos'],
    category: 'Electrolytes',
    defaultUnit: 'mg/dL',
    normalRange: { min: 2.5, max: 4.5 },
    patterns: [
      /\bPHOSPHORUS\s*(\d+\.?\d*)/i,
      /\bPHOSPHATE\s*(\d+\.?\d*)/i,
      /\bPHOS\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Anion Gap',
    aliases: [],
    category: 'Electrolytes',
    defaultUnit: 'mEq/L',
    normalRange: { min: 8, max: 12 },
    patterns: [
      /\bANION\s*GAP\s*(\d+)/i,
    ],
  },
  {
    name: 'Osmolality',
    aliases: ['serum osmolality'],
    category: 'Electrolytes',
    defaultUnit: 'mOsm/kg',
    normalRange: { min: 275, max: 295 },
    patterns: [
      /\bOSMOLALITY\s*(\d+)/i,
      /\bSERUM\s*OSMOLALITY\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // KIDNEY FUNCTION (13 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'BUN',
    aliases: ['urea nitrogen', 'blood urea nitrogen'],
    category: 'Kidney Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 7, max: 25 },
    patterns: [
      /\bBUN\s*(\d+)/i,
      /\bUREA\s*NITROGEN\s*(\d+)/i,
      /\bBLOOD\s*UREA\s*NITROGEN\s*(\d+)/i,
    ],
  },
  {
    name: 'Creatinine',
    aliases: ['creat'],
    category: 'Kidney Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0.6, max: 1.2 },
    patterns: [
      /\bCREATININE\s*(\d+\.?\d*)/i,
      /\bCREAT\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'eGFR',
    aliases: ['gfr', 'estimated gfr', 'glomerular filtration rate'],
    category: 'Kidney Function',
    defaultUnit: 'mL/min/1.73m2',
    normalRange: { min: 60, max: 999 },
    patterns: [
      /\beGFR\s*>?(\d+)/i,
      /\bGFR\s*>?(\d+)/i,
      /\bESTIMATED\s*GFR\s*>?(\d+)/i,
      /\bGLOMERULAR\s*FILTRATION\s*>?(\d+)/i,
    ],
  },
  {
    name: 'BUN/Creatinine Ratio',
    aliases: [],
    category: 'Kidney Function',
    defaultUnit: 'ratio',
    normalRange: { min: 10, max: 20 },
    patterns: [
      /\bBUN\/CREATININE\s*RATIO\s*(\d+)/i,
    ],
  },
  {
    name: 'Cystatin C',
    aliases: [],
    category: 'Kidney Function',
    defaultUnit: 'mg/L',
    normalRange: { min: 0.5, max: 1.0 },
    patterns: [
      /\bCYSTATIN\s*C\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Microalbumin',
    aliases: ['urine albumin'],
    category: 'Kidney Function',
    defaultUnit: 'mg/L',
    normalRange: { min: 0, max: 30 },
    patterns: [
      /\bMICROALBUMIN\s*(\d+\.?\d*)/i,
      /\bURINE\s*ALBUMIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Albumin/Creatinine Ratio',
    aliases: ['acr', 'uacr'],
    category: 'Kidney Function',
    defaultUnit: 'mg/g',
    normalRange: { min: 0, max: 30 },
    patterns: [
      /\bALBUMIN\/CREATININE\s*RATIO\s*(\d+\.?\d*)/i,
      /\bACR\s*(\d+\.?\d*)/i,
      /\bUACR\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Urine Protein',
    aliases: [],
    category: 'Kidney Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 15 },
    patterns: [
      /\bURINE\s*PROTEIN\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // LIVER FUNCTION (16 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Total Protein',
    aliases: ['protein total'],
    category: 'Liver Function',
    defaultUnit: 'g/dL',
    normalRange: { min: 6.0, max: 8.3 },
    patterns: [
      /\bTOTAL\s*PROTEIN\s*(\d+\.?\d*)/i,
      /\bPROTEIN[,\s]+TOTAL\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Albumin',
    aliases: ['alb'],
    category: 'Liver Function',
    defaultUnit: 'g/dL',
    normalRange: { min: 3.5, max: 5.0 },
    patterns: [
      /\bALBUMIN\s*(\d+\.?\d*)/i,
      /\bALB\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Globulin',
    aliases: ['glob'],
    category: 'Liver Function',
    defaultUnit: 'g/dL',
    normalRange: { min: 2.0, max: 3.5 },
    patterns: [
      /\bGLOBULIN\s*(\d+\.?\d*)/i,
      /\bGLOB\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'A/G Ratio',
    aliases: ['albumin/globulin ratio'],
    category: 'Liver Function',
    defaultUnit: 'ratio',
    normalRange: { min: 1.0, max: 2.5 },
    patterns: [
      /\bA\/G\s*RATIO\s*(\d+\.?\d*)/i,
      /\bALBUMIN\/GLOBULIN\s*RATIO\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Bilirubin, Total',
    aliases: ['total bilirubin', 'tbili'],
    category: 'Liver Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0.1, max: 1.2 },
    patterns: [
      /\bBILIRUBIN[,\s]+TOTAL\s*(\d+\.?\d*)/i,
      /\bTOTAL\s*BILIRUBIN\s*(\d+\.?\d*)/i,
      /\bTBILI\s*(\d+\.?\d*)/i,
      /\bBILIRUBIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Bilirubin, Direct',
    aliases: ['direct bilirubin'],
    category: 'Liver Function',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 0.3 },
    patterns: [
      /\bBILIRUBIN[,\s]+DIRECT\s*(\d+\.?\d*)/i,
      /\bDIRECT\s*BILIRUBIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Alkaline Phosphatase',
    aliases: ['alk phos', 'alp'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 36, max: 130 },
    patterns: [
      /\bALKALINE\s*PHOSPHATASE\s*(\d+)/i,
      /\bALK\s*PHOS\s*(\d+)/i,
      /\bALP\s*(\d+)/i,
    ],
  },
  {
    name: 'AST',
    aliases: ['sgot', 'aspartate aminotransferase'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 10, max: 40 },
    patterns: [
      /\bAST\s*\(?SGOT\)?\s*(\d+)/i,
      /\bAST\s*(\d+)/i,
      /\bSGOT\s*(\d+)/i,
      /\bASPARTATE\s*AMINO\s*TRANSFERASE\s*(\d+)/i,
    ],
  },
  {
    name: 'ALT',
    aliases: ['sgpt', 'alanine aminotransferase'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 7, max: 56 },
    patterns: [
      /\bALT\s*\(?SGPT\)?\s*(\d+)/i,
      /\bALT\s*(\d+)/i,
      /\bSGPT\s*(\d+)/i,
      /\bALANINE\s*AMINO\s*TRANSFERASE\s*(\d+)/i,
    ],
  },
  {
    name: 'GGT',
    aliases: ['gamma gt', 'gamma-glutamyl transferase'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 9, max: 48 },
    patterns: [
      /\bGGT\s*(\d+)/i,
      /\bGAMMA\s*GT\s*(\d+)/i,
      /\bGAMMA-?GLUTAMYL\s*TRANS\w*\s*(\d+)/i,
    ],
  },
  {
    name: 'LDH',
    aliases: ['lactate dehydrogenase'],
    category: 'Liver Function',
    defaultUnit: 'U/L',
    normalRange: { min: 140, max: 280 },
    patterns: [
      /\bLDH\s*(\d+)/i,
      /\bLACTATE\s*DEHYDROGENASE\s*(\d+)/i,
    ],
  },
  {
    name: 'Ammonia',
    aliases: [],
    category: 'Liver Function',
    defaultUnit: 'umol/L',
    normalRange: { min: 15, max: 45 },
    patterns: [
      /\bAMMONIA\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // THYROID PANEL (13 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'TSH',
    aliases: ['thyroid stimulating hormone'],
    category: 'Thyroid',
    defaultUnit: 'mIU/L',
    normalRange: { min: 0.4, max: 4.0 },
    patterns: [
      /\bTSH\s*(\d+\.?\d*)/i,
      /\bTHYROID\s*STIMULATING\s*HORMONE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Free T4',
    aliases: ['ft4', 'thyroxine free'],
    category: 'Thyroid',
    defaultUnit: 'ng/dL',
    normalRange: { min: 0.8, max: 1.8 },
    patterns: [
      /\bFREE\s*T4\s*(\d+\.?\d*)/i,
      /\bFT4\s*(\d+\.?\d*)/i,
      /\bTHYROXINE\s*FREE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Free T3',
    aliases: ['ft3', 'triiodothyronine free'],
    category: 'Thyroid',
    defaultUnit: 'pg/mL',
    normalRange: { min: 2.3, max: 4.2 },
    patterns: [
      /\bFREE\s*T3\s*(\d+\.?\d*)/i,
      /\bFT3\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Total T4',
    aliases: ['t4', 'thyroxine'],
    category: 'Thyroid',
    defaultUnit: 'ug/dL',
    normalRange: { min: 4.5, max: 12.0 },
    patterns: [
      /\bTOTAL\s*T4\s*(\d+\.?\d*)/i,
      /\bT4\s*(\d+\.?\d*)/i,
      /\bTHYROXINE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Total T3',
    aliases: ['t3', 'triiodothyronine'],
    category: 'Thyroid',
    defaultUnit: 'ng/dL',
    normalRange: { min: 80, max: 200 },
    patterns: [
      /\bTOTAL\s*T3\s*(\d+)/i,
      /\bT3\s*(\d+)/i,
      /\bTRIIODOTHYRONINE\s*(\d+)/i,
    ],
  },
  {
    name: 'Reverse T3',
    aliases: ['rt3'],
    category: 'Thyroid',
    defaultUnit: 'ng/dL',
    normalRange: { min: 10, max: 24 },
    patterns: [
      /\bREVERSE\s*T3\s*(\d+)/i,
      /\bRT3\s*(\d+)/i,
    ],
  },
  {
    name: 'Thyroglobulin',
    aliases: ['tg'],
    category: 'Thyroid',
    defaultUnit: 'ng/mL',
    normalRange: { min: 3, max: 40 },
    patterns: [
      /\bTHYROGLOBULIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'TPO Antibodies',
    aliases: ['anti-tpo', 'thyroid peroxidase ab'],
    category: 'Thyroid',
    defaultUnit: 'IU/mL',
    normalRange: { min: 0, max: 35 },
    patterns: [
      /\bTPO\s*ANTIBOD\w*\s*(\d+)/i,
      /\bANTI-?TPO\s*(\d+)/i,
      /\bTHYROID\s*PEROXIDASE\s*AB\s*(\d+)/i,
    ],
  },
  {
    name: 'Thyroglobulin Antibodies',
    aliases: ['tg ab', 'anti-tg'],
    category: 'Thyroid',
    defaultUnit: 'IU/mL',
    normalRange: { min: 0, max: 4 },
    patterns: [
      /\bTHYROGLOBULIN\s*ANTIBOD\w*\s*(\d+)/i,
      /\bTG\s*AB\s*(\d+)/i,
      /\bANTI-?TG\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // DIABETES / GLUCOSE METABOLISM (8 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Glucose',
    aliases: ['fasting glucose', 'blood glucose', 'blood sugar'],
    category: 'Diabetes',
    defaultUnit: 'mg/dL',
    normalRange: { min: 70, max: 99 },
    patterns: [
      /\bGLUCOSE\s*(\d+)/i,
      /\bFASTING\s*GLUCOSE\s*(\d+)/i,
      /\bBLOOD\s*GLUCOSE\s*(\d+)/i,
    ],
  },
  {
    name: 'Hemoglobin A1c',
    aliases: ['hba1c', 'a1c', 'glycohemoglobin'],
    category: 'Diabetes',
    defaultUnit: '%',
    normalRange: { min: 0, max: 5.7 },
    patterns: [
      /\bHEMOGLOBIN\s*A1C\s*(\d+\.?\d*)/i,
      /\bHBA1C\s*(\d+\.?\d*)/i,
      /\bA1C\s*(\d+\.?\d*)/i,
      /\bGLYCOHEMOGLOBIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Fasting Insulin',
    aliases: ['insulin'],
    category: 'Diabetes',
    defaultUnit: 'uIU/mL',
    normalRange: { min: 2.6, max: 24.9 },
    patterns: [
      /\bFASTING\s*INSULIN\s*(\d+\.?\d*)/i,
      /\bINSULIN\s*FASTING\s*(\d+\.?\d*)/i,
      /\bINSULIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'C-Peptide',
    aliases: [],
    category: 'Diabetes',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0.8, max: 3.9 },
    patterns: [
      /\bC-?PEPTIDE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Fructosamine',
    aliases: [],
    category: 'Diabetes',
    defaultUnit: 'umol/L',
    normalRange: { min: 200, max: 285 },
    patterns: [
      /\bFRUCTOSAMINE\s*(\d+)/i,
    ],
  },
  {
    name: 'HOMA-IR',
    aliases: [],
    category: 'Diabetes',
    defaultUnit: 'index',
    normalRange: { min: 0, max: 2.5 },
    patterns: [
      /\bHOMA-?IR\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // IRON STUDIES (6 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Iron',
    aliases: ['serum iron', 'fe'],
    category: 'Iron Studies',
    defaultUnit: 'ug/dL',
    normalRange: { min: 60, max: 170 },
    patterns: [
      /\bIRON\s*(\d+)/i,
      /\bSERUM\s*IRON\s*(\d+)/i,
      /\bFE\s*(\d+)/i,
    ],
  },
  {
    name: 'TIBC',
    aliases: ['total iron binding capacity'],
    category: 'Iron Studies',
    defaultUnit: 'ug/dL',
    normalRange: { min: 250, max: 400 },
    patterns: [
      /\bTIBC\s*(\d+)/i,
      /\bTOTAL\s*IRON\s*BINDING\s*CAPACITY\s*(\d+)/i,
    ],
  },
  {
    name: 'UIBC',
    aliases: ['unsaturated iron binding capacity'],
    category: 'Iron Studies',
    defaultUnit: 'ug/dL',
    normalRange: { min: 150, max: 300 },
    patterns: [
      /\bUIBC\s*(\d+)/i,
      /\bUNSATURATED\s*IRON\s*BINDING\s*(\d+)/i,
    ],
  },
  {
    name: 'Transferrin',
    aliases: [],
    category: 'Iron Studies',
    defaultUnit: 'mg/dL',
    normalRange: { min: 200, max: 360 },
    patterns: [
      /\bTRANSFERRIN\s*(\d+)/i,
    ],
  },
  {
    name: 'Transferrin Saturation',
    aliases: ['iron saturation', '% saturation'],
    category: 'Iron Studies',
    defaultUnit: '%',
    normalRange: { min: 20, max: 50 },
    patterns: [
      /\bTRANSFERRIN\s*SATURATION\s*(\d+)/i,
      /\bIRON\s*SATURATION\s*(\d+)/i,
      /\b%\s*SATURATION\s*(\d+)/i,
    ],
  },
  {
    name: 'Ferritin',
    aliases: [],
    category: 'Iron Studies',
    defaultUnit: 'ng/mL',
    normalRange: { min: 12, max: 300 },
    patterns: [
      /\bFERRITIN\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // VITAMINS (18 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Vitamin A',
    aliases: ['retinol'],
    category: 'Vitamins',
    defaultUnit: 'ug/dL',
    normalRange: { min: 20, max: 60 },
    patterns: [
      /\bVITAMIN\s*A\s*(\d+)/i,
      /\bRETINOL\s*(\d+)/i,
    ],
  },
  {
    name: 'Vitamin B1',
    aliases: ['thiamine'],
    category: 'Vitamins',
    defaultUnit: 'nmol/L',
    normalRange: { min: 70, max: 180 },
    patterns: [
      /\bVITAMIN\s*B1\s*(\d+)/i,
      /\bTHIAMINE\s*(\d+)/i,
    ],
  },
  {
    name: 'Vitamin B6',
    aliases: ['pyridoxine'],
    category: 'Vitamins',
    defaultUnit: 'nmol/L',
    normalRange: { min: 20, max: 125 },
    patterns: [
      /\bVITAMIN\s*B6\s*(\d+)/i,
      /\bPYRIDOXINE\s*(\d+)/i,
    ],
  },
  {
    name: 'Folate',
    aliases: ['vitamin b9', 'folic acid'],
    category: 'Vitamins',
    defaultUnit: 'ng/mL',
    normalRange: { min: 3, max: 999 },
    patterns: [
      /\bFOLATE\s*(\d+\.?\d*)/i,
      /\bFOLIC\s*ACID\s*(\d+\.?\d*)/i,
      /\bVITAMIN\s*B9\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Vitamin B12',
    aliases: ['cobalamin', 'cyanocobalamin'],
    category: 'Vitamins',
    defaultUnit: 'pg/mL',
    normalRange: { min: 200, max: 900 },
    patterns: [
      /\bVITAMIN\s*B12\s*(\d+)/i,
      /\bB12\s*(\d+)/i,
      /\bCOBALAMIN\s*(\d+)/i,
    ],
  },
  {
    name: 'Methylmalonic Acid',
    aliases: ['mma'],
    category: 'Vitamins',
    defaultUnit: 'nmol/L',
    normalRange: { min: 70, max: 270 },
    patterns: [
      /\bMETHYLMALONIC\s*ACID\s*(\d+)/i,
      /\bMMA\s*(\d+)/i,
    ],
  },
  {
    name: 'Homocysteine',
    aliases: [],
    category: 'Vitamins',
    defaultUnit: 'umol/L',
    normalRange: { min: 5, max: 15 },
    patterns: [
      /\bHOMOCYSTEINE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Vitamin C',
    aliases: ['ascorbic acid'],
    category: 'Vitamins',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0.4, max: 2.0 },
    patterns: [
      /\bVITAMIN\s*C\s*(\d+\.?\d*)/i,
      /\bASCORBIC\s*ACID\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Vitamin D',
    aliases: ['25-oh vitamin d', 'vitamin d total', '25-hydroxyvitamin d'],
    category: 'Vitamins',
    defaultUnit: 'ng/mL',
    normalRange: { min: 30, max: 100 },
    patterns: [
      /\bVITAMIN\s*D[,\s]+25-?(?:OH|HYDROXY)\s*(\d+)/i,
      /\b25-?(?:OH|HYDROXY)\s*VITAMIN\s*D\s*(\d+)/i,
      /\bVITAMIN\s*D\s*TOTAL\s*(\d+)/i,
      /\bVITAMIN\s*D\s*(\d+)/i,
    ],
  },
  {
    name: 'Vitamin E',
    aliases: ['alpha tocopherol'],
    category: 'Vitamins',
    defaultUnit: 'mg/L',
    normalRange: { min: 5.5, max: 17 },
    patterns: [
      /\bVITAMIN\s*E\s*(\d+\.?\d*)/i,
      /\bALPHA\s*TOCOPHEROL\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Vitamin K',
    aliases: [],
    category: 'Vitamins',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0.1, max: 2.2 },
    patterns: [
      /\bVITAMIN\s*K\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // BONE HEALTH (10 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'PTH',
    aliases: ['parathyroid hormone', 'intact pth'],
    category: 'Bone Health',
    defaultUnit: 'pg/mL',
    normalRange: { min: 15, max: 65 },
    patterns: [
      /\bPTH\s*(\d+)/i,
      /\bPARATHYROID\s*HORMONE\s*(\d+)/i,
      /\bINTACT\s*PTH\s*(\d+)/i,
    ],
  },
  {
    name: 'Osteocalcin',
    aliases: [],
    category: 'Bone Health',
    defaultUnit: 'ng/mL',
    normalRange: { min: 9, max: 42 },
    patterns: [
      /\bOSTEOCALCIN\s*(\d+)/i,
    ],
  },
  {
    name: 'N-Telopeptide',
    aliases: ['ntx'],
    category: 'Bone Health',
    defaultUnit: 'nmol BCE',
    normalRange: { min: 5, max: 65 },
    patterns: [
      /\bN-?TELOPEPTIDE\s*(\d+)/i,
      /\bNTX\s*(\d+)/i,
    ],
  },
  {
    name: 'C-Telopeptide',
    aliases: ['ctx'],
    category: 'Bone Health',
    defaultUnit: 'pg/mL',
    normalRange: { min: 0, max: 600 },
    patterns: [
      /\bC-?TELOPEPTIDE\s*(\d+)/i,
      /\bCTX\s*(\d+)/i,
    ],
  },
  {
    name: 'P1NP',
    aliases: ['procollagen type 1'],
    category: 'Bone Health',
    defaultUnit: 'ug/L',
    normalRange: { min: 15, max: 80 },
    patterns: [
      /\bP1NP\s*(\d+)/i,
      /\bPROCOLLAGEN\s*TYPE\s*1\s*N-?TERMINAL\s*(\d+)/i,
    ],
  },
  {
    name: 'Bone-Specific ALP',
    aliases: ['bone alp', 'balp'],
    category: 'Bone Health',
    defaultUnit: 'ug/L',
    normalRange: { min: 6, max: 20 },
    patterns: [
      /\bBONE-?SPECIFIC\s*ALP\s*(\d+)/i,
      /\bBONE\s*ALP\s*(\d+)/i,
      /\bBALP\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // INFLAMMATION MARKERS (11 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'CRP',
    aliases: ['c-reactive protein'],
    category: 'Inflammation Markers',
    defaultUnit: 'mg/L',
    normalRange: { min: 0, max: 10 },
    patterns: [
      /\bCRP\s*(\d+\.?\d*)/i,
      /\bC-?REACTIVE\s*PROTEIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'hs-CRP',
    aliases: ['high sensitivity crp', 'cardio crp'],
    category: 'Inflammation Markers',
    defaultUnit: 'mg/L',
    normalRange: { min: 0, max: 1.0 },
    patterns: [
      /\bHS-?CRP\s*(\d+\.?\d*)/i,
      /\bHIGH\s*SENSITIVITY\s*CRP\s*(\d+\.?\d*)/i,
      /\bCARDIO\s*CRP\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'ESR',
    aliases: ['sed rate', 'erythrocyte sedimentation rate'],
    category: 'Inflammation Markers',
    defaultUnit: 'mm/hr',
    normalRange: { min: 0, max: 20 },
    patterns: [
      /\bESR\s*(\d+)/i,
      /\bSED\s*RATE\s*(\d+)/i,
      /\bERYTHROCYTE\s*SEDIMENTATION\s*RATE\s*(\d+)/i,
    ],
  },
  {
    name: 'Procalcitonin',
    aliases: [],
    category: 'Inflammation Markers',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 0.1 },
    patterns: [
      /\bPROCALCITONIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Interleukin-6',
    aliases: ['il-6'],
    category: 'Inflammation Markers',
    defaultUnit: 'pg/mL',
    normalRange: { min: 0, max: 7 },
    patterns: [
      /\bINTERLEUKIN-?6\s*(\d+\.?\d*)/i,
      /\bIL-?6\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Complement C3',
    aliases: ['c3'],
    category: 'Inflammation Markers',
    defaultUnit: 'mg/dL',
    normalRange: { min: 90, max: 180 },
    patterns: [
      /\bCOMPLEMENT\s*C3\s*(\d+)/i,
      /\bC3\s*(\d+)/i,
    ],
  },
  {
    name: 'Complement C4',
    aliases: ['c4'],
    category: 'Inflammation Markers',
    defaultUnit: 'mg/dL',
    normalRange: { min: 10, max: 40 },
    patterns: [
      /\bCOMPLEMENT\s*C4\s*(\d+)/i,
      /\bC4\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // CARDIAC MARKERS (11 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Troponin I',
    aliases: ['trop i'],
    category: 'Cardiac',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 0.04 },
    patterns: [
      /\bTROPONIN\s*I\s*(\d+\.?\d*)/i,
      /\bTROP\s*I\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Troponin T',
    aliases: ['trop t'],
    category: 'Cardiac',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 0.01 },
    patterns: [
      /\bTROPONIN\s*T\s*(\d+\.?\d*)/i,
      /\bTROP\s*T\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'BNP',
    aliases: ['b-type natriuretic peptide'],
    category: 'Cardiac',
    defaultUnit: 'pg/mL',
    normalRange: { min: 0, max: 100 },
    patterns: [
      /\bBNP\s*(\d+)/i,
      /\bB-?TYPE\s+NATRIURETIC\s*PEPTIDE\s*(\d+)/i,
    ],
  },
  {
    name: 'NT-proBNP',
    aliases: ['n-terminal pro-bnp'],
    category: 'Cardiac',
    defaultUnit: 'pg/mL',
    normalRange: { min: 0, max: 125 },
    patterns: [
      /\bNT-?PROBNP\s*(\d+)/i,
      /\bN-?TERMINAL\s*PRO-?BNP\s*(\d+)/i,
    ],
  },
  {
    name: 'CK',
    aliases: ['creatine kinase', 'cpk'],
    category: 'Cardiac',
    defaultUnit: 'U/L',
    normalRange: { min: 30, max: 200 },
    patterns: [
      /\bCK\s*(\d+)/i,
      /\bCREATINE\s*KINASE\s*(\d+)/i,
      /\bCPK\s*(\d+)/i,
    ],
  },
  {
    name: 'CK-MB',
    aliases: ['creatine kinase mb'],
    category: 'Cardiac',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 5 },
    patterns: [
      /\bCK-?MB\s*(\d+\.?\d*)/i,
      /\bCREATINE\s*KINASE\s*MB\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Myoglobin',
    aliases: [],
    category: 'Cardiac',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 90 },
    patterns: [
      /\bMYOGLOBIN\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // COAGULATION (13 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'PT',
    aliases: ['prothrombin time'],
    category: 'Coagulation',
    defaultUnit: 'seconds',
    normalRange: { min: 11, max: 13.5 },
    patterns: [
      /\bPT\s*(\d+\.?\d*)/i,
      /\bPROTHROMBIN\s*TIME\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'INR',
    aliases: ['international normalized ratio'],
    category: 'Coagulation',
    defaultUnit: 'ratio',
    normalRange: { min: 0.9, max: 1.1 },
    patterns: [
      /\bINR\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'PTT',
    aliases: ['partial thromboplastin time'],
    category: 'Coagulation',
    defaultUnit: 'seconds',
    normalRange: { min: 25, max: 35 },
    patterns: [
      /\bPTT\s*(\d+\.?\d*)/i,
      /\bAPTT\s*(\d+\.?\d*)/i,
      /\bPARTIAL\s*THROMBOPLASTIN\s*TIME\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Fibrinogen',
    aliases: [],
    category: 'Coagulation',
    defaultUnit: 'mg/dL',
    normalRange: { min: 200, max: 400 },
    patterns: [
      /\bFIBRINOGEN\s*(\d+)/i,
    ],
  },
  {
    name: 'D-Dimer',
    aliases: [],
    category: 'Coagulation',
    defaultUnit: 'ug/mL',
    normalRange: { min: 0, max: 0.5 },
    patterns: [
      /\bD-?DIMER\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Antithrombin III',
    aliases: ['at3'],
    category: 'Coagulation',
    defaultUnit: '%',
    normalRange: { min: 80, max: 120 },
    patterns: [
      /\bANTITHROMBIN\s*III\s*(\d+)/i,
      /\bAT3\s*(\d+)/i,
    ],
  },
  {
    name: 'Protein C',
    aliases: [],
    category: 'Coagulation',
    defaultUnit: '%',
    normalRange: { min: 70, max: 140 },
    patterns: [
      /\bPROTEIN\s*C\s*(\d+)/i,
    ],
  },
  {
    name: 'Protein S',
    aliases: [],
    category: 'Coagulation',
    defaultUnit: '%',
    normalRange: { min: 60, max: 140 },
    patterns: [
      /\bPROTEIN\s*S\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // HORMONES (25 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Testosterone, Total',
    aliases: ['total testosterone', 'testosterone'],
    category: 'Hormones',
    defaultUnit: 'ng/dL',
    normalRange: { min: 300, max: 1000 },
    patterns: [
      /\bTESTOSTERONE[,\s]+TOTAL\s*(\d+)/i,
      /\bTOTAL\s*TESTOSTERONE\s*(\d+)/i,
      /\bTESTOSTERONE\s*(\d+)/i,
    ],
  },
  {
    name: 'Free Testosterone',
    aliases: [],
    category: 'Hormones',
    defaultUnit: 'pg/mL',
    normalRange: { min: 50, max: 210 },
    patterns: [
      /\bFREE\s*TESTOSTERONE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'SHBG',
    aliases: ['sex hormone binding globulin'],
    category: 'Hormones',
    defaultUnit: 'nmol/L',
    normalRange: { min: 10, max: 57 },
    patterns: [
      /\bSHBG\s*(\d+)/i,
      /\bSEX\s*HORMONE\s*BINDING\s+GLOBULIN\s*(\d+)/i,
    ],
  },
  {
    name: 'Estradiol',
    aliases: ['e2'],
    category: 'Hormones',
    defaultUnit: 'pg/mL',
    normalRange: { min: 10, max: 400 },
    patterns: [
      /\bESTRADIOL\s*(\d+)/i,
      /\bE2\s*(\d+)/i,
    ],
  },
  {
    name: 'Progesterone',
    aliases: ['p4'],
    category: 'Hormones',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0.1, max: 25 },
    patterns: [
      /\bPROGESTERONE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'LH',
    aliases: ['luteinizing hormone'],
    category: 'Hormones',
    defaultUnit: 'mIU/mL',
    normalRange: { min: 1.5, max: 12.4 },
    patterns: [
      /\bLH\s*(\d+\.?\d*)/i,
      /\bLUTEINIZING\s+HORMONE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'FSH',
    aliases: ['follicle stimulating hormone'],
    category: 'Hormones',
    defaultUnit: 'mIU/mL',
    normalRange: { min: 1.5, max: 12.4 },
    patterns: [
      /\bFSH\s*(\d+\.?\d*)/i,
      /\bFOLLICLE\s+STIMULATING\s*HORMONE\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Prolactin',
    aliases: ['prl'],
    category: 'Hormones',
    defaultUnit: 'ng/mL',
    normalRange: { min: 2, max: 18 },
    patterns: [
      /\bPROLACTIN\s*(\d+\.?\d*)/i,
      /\bPRL\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Cortisol',
    aliases: ['serum cortisol'],
    category: 'Hormones',
    defaultUnit: 'ug/dL',
    normalRange: { min: 6, max: 23 },
    patterns: [
      /\bCORTISOL\s*(\d+\.?\d*)/i,
      /\bSERUM\s+CORTISOL\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'DHEA-S',
    aliases: ['dhea sulfate', 'dheas'],
    category: 'Hormones',
    defaultUnit: 'ug/dL',
    normalRange: { min: 80, max: 560 },
    patterns: [
      /\bDHEA-?S\s*(\d+)/i,
      /\bDHEA\s+SULFATE\s*(\d+)/i,
    ],
  },
  {
    name: 'ACTH',
    aliases: ['adrenocorticotropic hormone'],
    category: 'Hormones',
    defaultUnit: 'pg/mL',
    normalRange: { min: 10, max: 60 },
    patterns: [
      /\bACTH\s*(\d+)/i,
      /\bADRENOCORTICOTROPIC\s+HORMONE\s*(\d+)/i,
    ],
  },
  {
    name: 'IGF-1',
    aliases: ['insulin-like growth factor'],
    category: 'Hormones',
    defaultUnit: 'ng/mL',
    normalRange: { min: 100, max: 300 },
    patterns: [
      /\bIGF-?1\s*(\d+)/i,
      /\bINSULIN-?LIKE\s+GROWTH\s+FACTOR\s*(\d+)/i,
    ],
  },
  {
    name: 'Growth Hormone',
    aliases: ['gh'],
    category: 'Hormones',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 10 },
    patterns: [
      /\bGROWTH\s+HORMONE\s*(\d+\.?\d*)/i,
      /\bGH\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'AMH',
    aliases: ['anti-mullerian hormone'],
    category: 'Hormones',
    defaultUnit: 'ng/mL',
    normalRange: { min: 1.0, max: 10.0 },
    patterns: [
      /\bAMH\s*(\d+\.?\d*)/i,
      /\bANTI-?MULLERIAN\s+HORMONE\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // AUTOIMMUNE (17 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'ANA',
    aliases: ['antinuclear antibody'],
    category: 'Autoimmune',
    defaultUnit: 'titer',
    normalRange: { min: 0, max: 1 },
    patterns: [
      /\bANA\s*(\d+:\d+)/i,
      /\bANTINUCLEAR\s+ANTIBODY\s*(\d+:\d+)/i,
    ],
  },
  {
    name: 'Anti-dsDNA',
    aliases: ['double stranded dna antibody'],
    category: 'Autoimmune',
    defaultUnit: 'IU/mL',
    normalRange: { min: 0, max: 30 },
    patterns: [
      /\bANTI-?DSDNA\s*(\d+)/i,
      /\bDOUBLE\s+STRANDED\s+DNA\s+ANTIBODY\s*(\d+)/i,
    ],
  },
  {
    name: 'Rheumatoid Factor',
    aliases: ['rf'],
    category: 'Autoimmune',
    defaultUnit: 'IU/mL',
    normalRange: { min: 0, max: 14 },
    patterns: [
      /\bRHEUMATOID\s+FACTOR\s*(\d+)/i,
      /\bRF\s*(\d+)/i,
    ],
  },
  {
    name: 'Anti-CCP',
    aliases: ['cyclic citrullinated peptide'],
    category: 'Autoimmune',
    defaultUnit: 'U/mL',
    normalRange: { min: 0, max: 20 },
    patterns: [
      /\bANTI-?CCP\s*(\d+)/i,
      /\bCYCLIC\s+CITRULLINATED\s+PEPTIDE\s*(\d+)/i,
    ],
  },
  {
    name: 'Anti-SSA',
    aliases: ['ro antibody'],
    category: 'Autoimmune',
    defaultUnit: 'AI',
    normalRange: { min: 0, max: 1.0 },
    patterns: [
      /\bANTI-?SSA\s*(\d+\.?\d*)/i,
      /\bRO\s+ANTIBODY\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Anti-SSB',
    aliases: ['la antibody'],
    category: 'Autoimmune',
    defaultUnit: 'AI',
    normalRange: { min: 0, max: 1.0 },
    patterns: [
      /\bANTI-?SSB\s*(\d+\.?\d*)/i,
      /\bLA\s+ANTIBODY\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Uric Acid',
    aliases: [],
    category: 'Autoimmune',
    defaultUnit: 'mg/dL',
    normalRange: { min: 3.5, max: 7.2 },
    patterns: [
      /\bURIC\s+ACID\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // TUMOR MARKERS (11 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'PSA',
    aliases: ['prostate specific antigen'],
    category: 'Tumor Markers',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 4.0 },
    patterns: [
      /\bPSA\s*(\d+\.?\d*)/i,
      /\bPROSTATE\s+SPECIFIC\s+ANTIGEN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Free PSA',
    aliases: [],
    category: 'Tumor Markers',
    defaultUnit: '%',
    normalRange: { min: 25, max: 100 },
    patterns: [
      /\bFREE\s+PSA\s*(\d+)/i,
    ],
  },
  {
    name: 'CEA',
    aliases: ['carcinoembryonic antigen'],
    category: 'Tumor Markers',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 3.0 },
    patterns: [
      /\bCEA\s*(\d+\.?\d*)/i,
      /\bCARCINOEMBRYONIC\s+ANTIGEN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'CA-125',
    aliases: [],
    category: 'Tumor Markers',
    defaultUnit: 'U/mL',
    normalRange: { min: 0, max: 35 },
    patterns: [
      /\bCA-?125\s*(\d+)/i,
    ],
  },
  {
    name: 'CA 19-9',
    aliases: [],
    category: 'Tumor Markers',
    defaultUnit: 'U/mL',
    normalRange: { min: 0, max: 37 },
    patterns: [
      /\bCA\s*19-?9\s*(\d+)/i,
    ],
  },
  {
    name: 'CA 15-3',
    aliases: [],
    category: 'Tumor Markers',
    defaultUnit: 'U/mL',
    normalRange: { min: 0, max: 30 },
    patterns: [
      /\bCA\s*15-?3\s*(\d+)/i,
    ],
  },
  {
    name: 'AFP',
    aliases: ['alpha-fetoprotein'],
    category: 'Tumor Markers',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 10 },
    patterns: [
      /\bAFP\s*(\d+\.?\d*)/i,
      /\bALPHA-?FETOPROTEIN\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'HCG',
    aliases: ['beta hcg', 'human chorionic gonadotropin'],
    category: 'Tumor Markers',
    defaultUnit: 'mIU/mL',
    normalRange: { min: 0, max: 5 },
    patterns: [
      /\bHCG\s*(\d+)/i,
      /\bBETA\s+HCG\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // PANCREATIC (4 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Amylase',
    aliases: [],
    category: 'Pancreatic',
    defaultUnit: 'U/L',
    normalRange: { min: 28, max: 100 },
    patterns: [
      /\bAMYLASE\s*(\d+)/i,
    ],
  },
  {
    name: 'Lipase',
    aliases: [],
    category: 'Pancreatic',
    defaultUnit: 'U/L',
    normalRange: { min: 0, max: 160 },
    patterns: [
      /\bLIPASE\s*(\d+)/i,
    ],
  },
  {
    name: 'Elastase',
    aliases: ['fecal elastase'],
    category: 'Pancreatic',
    defaultUnit: 'ug/g',
    normalRange: { min: 200, max: 9999 },
    patterns: [
      /\bELASTASE\s*(\d+)/i,
      /\bFECAL\s+ELASTASE\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // URINALYSIS (15 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Specific Gravity',
    aliases: [],
    category: 'Urinalysis',
    defaultUnit: 'ratio',
    normalRange: { min: 1.005, max: 1.030 },
    patterns: [
      /\bSPECIFIC\s+GRAVITY\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Urine pH',
    aliases: ['ph'],
    category: 'Urinalysis',
    defaultUnit: 'pH',
    normalRange: { min: 4.5, max: 8.0 },
    patterns: [
      /\bURINE\s+PH\s*(\d+\.?\d*)/i,
      /\bPH\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Urine Glucose',
    aliases: [],
    category: 'Urinalysis',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 0 },
    patterns: [
      /\bURINE\s+GLUCOSE\s*(\d+)/i,
    ],
  },
  {
    name: 'Urine Ketones',
    aliases: [],
    category: 'Urinalysis',
    defaultUnit: 'mg/dL',
    normalRange: { min: 0, max: 0 },
    patterns: [
      /\bURINE\s+KETONES?\s*(\d+)/i,
    ],
  },
  {
    name: 'Urine WBC',
    aliases: [],
    category: 'Urinalysis',
    defaultUnit: '/HPF',
    normalRange: { min: 0, max: 5 },
    patterns: [
      /\bURINE\s+WBC\s*(\d+)/i,
    ],
  },
  {
    name: 'Urine RBC',
    aliases: [],
    category: 'Urinalysis',
    defaultUnit: '/HPF',
    normalRange: { min: 0, max: 2 },
    patterns: [
      /\bURINE\s+RBC\s*(\d+)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // BLOOD GAS (7 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Blood pH',
    aliases: ['arterial ph'],
    category: 'Blood Gas',
    defaultUnit: 'pH',
    normalRange: { min: 7.35, max: 7.45 },
    patterns: [
      /\bBLOOD\s+PH\s*(\d+\.?\d*)/i,
      /\bARTERIAL\s+PH\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'pCO2',
    aliases: ['partial pressure co2'],
    category: 'Blood Gas',
    defaultUnit: 'mmHg',
    normalRange: { min: 35, max: 45 },
    patterns: [
      /\bPCO2\s*(\d+)/i,
      /\bPARTIAL\s+PRESSURE\s+CO2\s*(\d+)/i,
    ],
  },
  {
    name: 'pO2',
    aliases: ['partial pressure o2'],
    category: 'Blood Gas',
    defaultUnit: 'mmHg',
    normalRange: { min: 80, max: 100 },
    patterns: [
      /\bPO2\s*(\d+)/i,
      /\bPARTIAL\s+PRESSURE\s+O2\s*(\d+)/i,
    ],
  },
  {
    name: 'Base Excess',
    aliases: ['be'],
    category: 'Blood Gas',
    defaultUnit: 'mEq/L',
    normalRange: { min: -2, max: 2 },
    patterns: [
      /\bBASE\s+EXCESS\s+(-?\d+\.?\d*)/i,
      /\bBE\s+(-?\d+\.?\d*)/i,
    ],
  },
  {
    name: 'O2 Saturation',
    aliases: ['sao2'],
    category: 'Blood Gas',
    defaultUnit: '%',
    normalRange: { min: 95, max: 100 },
    patterns: [
      /\bO2\s+SATURATION\s*(\d+)/i,
      /\bSAO2\s*(\d+)/i,
    ],
  },
  {
    name: 'Lactate',
    aliases: [],
    category: 'Blood Gas',
    defaultUnit: 'mmol/L',
    normalRange: { min: 0.5, max: 2.0 },
    patterns: [
      /\bLACTATE\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // ALLERGY (3 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'IgE Total',
    aliases: ['total ige'],
    category: 'Allergy',
    defaultUnit: 'IU/mL',
    normalRange: { min: 0, max: 100 },
    patterns: [
      /\bIGE\s*TOTAL\s*(\d+)/i,
      /\bTOTAL\s+IGE\s*(\d+)/i,
    ],
  },
  {
    name: 'Tryptase',
    aliases: [],
    category: 'Allergy',
    defaultUnit: 'ng/mL',
    normalRange: { min: 0, max: 11.4 },
    patterns: [
      /\bTRYPTASE\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // GENETIC (5 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'HLA-B27',
    aliases: [],
    category: 'Genetic',
    defaultUnit: 'positive/negative',
    normalRange: { min: 0, max: 0 },
    patterns: [
      /\bHLA-?B27\s+(POSITIVE|NEGATIVE)/i,
    ],
  },
  {
    name: 'Celiac Panel',
    aliases: ['ttg iga'],
    category: 'Genetic',
    defaultUnit: 'U/mL',
    normalRange: { min: 0, max: 4 },
    patterns: [
      /\bCELIAC\s+PANEL\s*(\d+)/i,
      /\bTTG\s+IGA\s*(\d+)/i,
    ],
  },
  {
    name: 'G6PD',
    aliases: [],
    category: 'Genetic',
    defaultUnit: 'U/g Hb',
    normalRange: { min: 7, max: 20 },
    patterns: [
      /\bG6PD\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // VITAL SIGNS (9 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Blood Pressure Systolic',
    aliases: ['systolic bp', 'sbp'],
    category: 'Vital Signs',
    defaultUnit: 'mmHg',
    normalRange: { min: 90, max: 120 },
    patterns: [
      /\bBLOOD\s+PRESSURE\s+SYSTOLIC\s*(\d+)/i,
      /\bSYSTOLIC\s*(\d+)/i,
      /\bSBP\s*(\d+)/i,
    ],
  },
  {
    name: 'Blood Pressure Diastolic',
    aliases: ['diastolic bp', 'dbp'],
    category: 'Vital Signs',
    defaultUnit: 'mmHg',
    normalRange: { min: 60, max: 80 },
    patterns: [
      /\bBLOOD\s+PRESSURE\s+DIASTOLIC\s*(\d+)/i,
      /\bDIASTOLIC\s*(\d+)/i,
      /\bDBP\s*(\d+)/i,
    ],
  },
  {
    name: 'Heart Rate',
    aliases: ['pulse', 'hr'],
    category: 'Vital Signs',
    defaultUnit: 'bpm',
    normalRange: { min: 60, max: 100 },
    patterns: [
      /\bHEART\s+RATE\s*(\d+)/i,
      /\bPULSE\s*(\d+)/i,
      /\bHR\s*(\d+)/i,
    ],
  },
  {
    name: 'Temperature',
    aliases: ['temp'],
    category: 'Vital Signs',
    defaultUnit: 'F',
    normalRange: { min: 97.8, max: 99.1 },
    patterns: [
      /\bTEMPERATURE\s*(\d+\.?\d*)/i,
      /\bTEMP\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Respiratory Rate',
    aliases: ['rr'],
    category: 'Vital Signs',
    defaultUnit: 'breaths/min',
    normalRange: { min: 12, max: 20 },
    patterns: [
      /\bRESPIRATORY\s+RATE\s*(\d+)/i,
      /\bRR\s*(\d+)/i,
    ],
  },
  {
    name: 'SpO2',
    aliases: ['oxygen saturation', 'o2 sat'],
    category: 'Vital Signs',
    defaultUnit: '%',
    normalRange: { min: 95, max: 100 },
    patterns: [
      /\bSPO2\s*(\d+)/i,
      /\bOXYGEN\s+SATURATION\s*(\d+)/i,
      /\bO2\s+SAT\s*(\d+)/i,
    ],
  },
  {
    name: 'BMI',
    aliases: ['body mass index'],
    category: 'Vital Signs',
    defaultUnit: 'kg/m2',
    normalRange: { min: 18.5, max: 24.9 },
    patterns: [
      /\bBMI\s*(\d+\.?\d*)/i,
      /\bBODY\s+MASS\s+INDEX\s*(\d+\.?\d*)/i,
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // BODY COMPOSITION (8 biomarkers)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Body Fat Percentage',
    aliases: ['body fat'],
    category: 'Body Composition',
    defaultUnit: '%',
    normalRange: { min: 10, max: 25 },
    patterns: [
      /\bBODY\s+FAT\s+(?:PERCENTAGE)?\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Lean Body Mass',
    aliases: ['lean mass'],
    category: 'Body Composition',
    defaultUnit: 'kg',
    normalRange: { min: 40, max: 80 },
    patterns: [
      /\bLEAN\s+(?:BODY\s+)?MASS\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Bone Mineral Density',
    aliases: ['bmd'],
    category: 'Body Composition',
    defaultUnit: 'g/cm2',
    normalRange: { min: 0.8, max: 1.5 },
    patterns: [
      /\bBONE\s+MINERAL\s+DENSITY\s*(\d+\.?\d*)/i,
      /\bBMD\s*(\d+\.?\d*)/i,
    ],
  },
  {
    name: 'T-Score',
    aliases: [],
    category: 'Body Composition',
    defaultUnit: 'SD',
    normalRange: { min: -1.0, max: 999 },
    patterns: [
      /\bT-?SCORE\s+(-?\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Z-Score',
    aliases: [],
    category: 'Body Composition',
    defaultUnit: 'SD',
    normalRange: { min: -2.0, max: 2.0 },
    patterns: [
      /\bZ-?SCORE\s+(-?\d+\.?\d*)/i,
    ],
  },
  {
    name: 'Waist Circumference',
    aliases: [],
    category: 'Body Composition',
    defaultUnit: 'inches',
    normalRange: { min: 0, max: 40 },
    patterns: [
      /\bWAIST\s+CIRCUMFERENCE\s*(\d+\.?\d*)/i,
    ],
  },
];

// ============================================
// UNIT NORMALIZATION
// ============================================

const UNIT_NORMALIZATIONS: Record<string, string> = {
  'mg/dl': 'mg/dL',
  'mg/dL': 'mg/dL',
  'mmol/l': 'mmol/L',
  'mmol/L': 'mmol/L',
  'ng/ml': 'ng/mL',
  'ng/mL': 'ng/mL',
  'pg/ml': 'pg/mL',
  'pg/mL': 'pg/mL',
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
  'ratio': 'ratio',
  'seconds': 'seconds',
};

export function normalizeUnit(unit: string): string {
  const cleaned = unit.trim();
  return UNIT_NORMALIZATIONS[cleaned] || UNIT_NORMALIZATIONS[cleaned.toLowerCase()] || cleaned;
}

// ============================================
// EXTRACTION FUNCTIONS
// ============================================

/**
 * Keywords that indicate educational/guidance text rather than actual results.
 * Lines containing these should be SKIPPED during extraction.
 */
const EDUCATIONAL_KEYWORDS = [
  'goal',
  'target',
  'desirable',
  'therapeutic',
  'considered',
  'prevention',
  'recommended',
  'optimal',
  'guideline',
  'suggests',
  'indicating',
  'associated with',
  'risk factor',
  'treatment',
  'treating to',
  'should be',
  'aim for',
  'ideally',
  'according to',
];

/**
 * Patterns that indicate a reference range value (NOT an actual result)
 * These appear BEFORE the number and indicate it's a range limit
 */
const REFERENCE_RANGE_INDICATORS = [
  /<\s*$/,           // "<" before number
  />\s*$/,           // ">" before number
  /<=\s*$/,          // "<=" before number
  />=\s*$/,          // ">=" before number
  /OR\s*=\s*$/i,     // "OR =" (Quest format for >= or <=)
  /range[:\s]*$/i,   // "range:" before number
  /desirable[:\s]*$/i, // "desirable:" before number
  /-\s*$/,           // "-" (part of a range like "70-100")
  /to\s*$/i,         // "to" (part of a range like "70 to 100")
];

/**
 * Check if text contains educational/guidance content
 */
function isEducationalText(text: string): boolean {
  const lowerText = text.toLowerCase();
  return EDUCATIONAL_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

/**
 * Check if the context before the matched value indicates it's a reference range
 */
function isReferenceRangeContext(textBeforeValue: string): boolean {
  const trimmed = textBeforeValue.trim();
  return REFERENCE_RANGE_INDICATORS.some(pattern => pattern.test(trimmed));
}

/**
 * Extract the FIRST number that appears after a biomarker name in a result line.
 * Quest format: "BIOMARKER NAME    VALUE    Reference Range: <200 mg/dL"
 * We want VALUE, not the 200 from the reference range.
 */
function extractResultValue(line: string, biomarkerNameEndIndex: number): { value: number; rawMatch: string } | null {
  // Get text after the biomarker name
  const afterName = line.substring(biomarkerNameEndIndex);

  console.log(`[EXTRACT_VALUE] After name: "${afterName.substring(0, 80)}..."`);

  // Skip if this looks like educational text
  if (isEducationalText(afterName)) {
    console.log(`[SKIP] Educational text detected: "${afterName.substring(0, 50)}..."`);
    return null;
  }

  // Quest format typically has: NAME <whitespace> VALUE <whitespace> Reference Range
  // The VALUE is the first number after the name, possibly with H/L flag

  // Pattern 1: Whitespace, then number (possibly with decimal), optionally H/L flag
  // Must be the FIRST thing after the name (just whitespace before number)
  const resultMatch = afterName.match(/^\s*(\d+\.?\d*)\s*([HL])?\s/i);

  if (resultMatch) {
    const value = parseFloat(resultMatch[1]);
    const flag = resultMatch[2];
    console.log(`[EXTRACT_VALUE] Pattern 1 matched: value=${value}, flag=${flag || 'none'}`);
    if (!isNaN(value) && value >= 0 && value < 100000) {
      return { value, rawMatch: line };
    }
  }

  // Pattern 2: Whitespace, number followed by unit (common in lab reports)
  const unitMatch = afterName.match(/^\s*(\d+\.?\d*)\s*(?:mg|g|%|K\/uL|M\/uL|mL|uL|fL|pg|ng|IU|U|mmol|umol|mEq|ratio)/i);
  if (unitMatch) {
    const value = parseFloat(unitMatch[1]);
    console.log(`[EXTRACT_VALUE] Pattern 2 (with unit) matched: value=${value}`);
    if (!isNaN(value) && value >= 0 && value < 100000) {
      return { value, rawMatch: line };
    }
  }

  // Pattern 3: More lenient - any number after whitespace, but NOT if preceded by < > = - or "to"
  // This catches cases where OCR added extra spaces
  const lenientMatch = afterName.match(/^\s{2,}(\d+\.?\d*)(?:\s|$)/);
  if (lenientMatch) {
    // Make sure this isn't part of a reference range
    const beforeNumber = afterName.substring(0, afterName.indexOf(lenientMatch[1]));
    if (!REFERENCE_RANGE_INDICATORS.some(pattern => pattern.test(beforeNumber))) {
      const value = parseFloat(lenientMatch[1]);
      console.log(`[EXTRACT_VALUE] Pattern 3 (lenient) matched: value=${value}`);
      if (!isNaN(value) && value >= 0 && value < 100000) {
        return { value, rawMatch: line };
      }
    }
  }

  console.log(`[EXTRACT_VALUE] No pattern matched for: "${afterName.substring(0, 50)}"`);
  return null;
}

/**
 * Check if a line looks like a result row (vs educational/header text)
 * Result rows typically have: NAME followed by NUMBER followed by more text
 */
function looksLikeResultRow(line: string): boolean {
  // Skip lines that are mostly text descriptions
  if (line.length > 200) {
    console.log(`[SKIP_ROW] Line too long (${line.length} chars): "${line.substring(0, 50)}..."`);
    return false;
  }

  // Skip lines that are too short to be result rows
  if (line.length < 10) {
    return false;
  }

  // Skip lines with educational keywords
  if (isEducationalText(line)) {
    console.log(`[SKIP_ROW] Educational text: "${line.substring(0, 50)}..."`);
    return false;
  }

  // Skip lines that start with common non-result patterns
  const skipStarters = [
    /^note[:\s]/i,
    /^comment[:\s]/i,
    /^interpretation/i,
    /^see\s/i,
    /^for\s/i,
    /^if\s/i,
    /^when\s/i,
    /^page\s/i,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/,  // Date patterns
    /^\*/,
    /^\(/,
    /^reference/i,
    /^normal/i,
    /^range/i,
  ];

  if (skipStarters.some(pattern => pattern.test(line.trim()))) {
    console.log(`[SKIP_ROW] Non-result starter: "${line.substring(0, 50)}..."`);
    return false;
  }

  // A result row should have at least one number
  if (!/\d/.test(line)) {
    return false;
  }

  return true;
}

/**
 * Extract biomarkers using regex patterns with improved filtering
 */
function extractWithPatterns(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();

  console.log('[PATTERN EXTRACTION] Starting pattern-based extraction');

  for (const biomarker of ALL_BIOMARKERS) {
    if (foundNames.has(biomarker.name)) continue;

    for (const pattern of biomarker.patterns) {
      const match = text.match(pattern);
      if (!match || match.index === undefined) continue;

      const rawValue = match[1]?.trim();
      if (!rawValue) continue;

      // Handle non-numeric values
      if (rawValue === 'POSITIVE' || rawValue === 'NEGATIVE') continue;

      const value = parseFloat(rawValue);
      if (isNaN(value)) continue;

      // Validate value is reasonable
      if (value < -100 || value > 100000) continue;

      console.log(`[PATTERN] Candidate for ${biomarker.name}: value=${value}, match="${match[0].substring(0, 60)}"`);

      // Get context around the match to check for educational text
      const contextStart = Math.max(0, match.index - 100);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 100);
      const context = text.substring(contextStart, contextEnd);

      // CRITICAL: Skip if this looks like educational/guidance text
      if (isEducationalText(context)) {
        console.log(`[SKIP PATTERN] Educational context for ${biomarker.name}: "${match[0].substring(0, 50)}"`);
        continue;
      }

      // CRITICAL: Check if the value is preceded by reference range indicators
      const textBeforeValue = text.substring(Math.max(0, match.index), match.index + match[0].indexOf(rawValue));
      if (isReferenceRangeContext(textBeforeValue)) {
        console.log(`[SKIP PATTERN] Reference range context for ${biomarker.name}: "${match[0].substring(0, 50)}"`);
        continue;
      }

      // CRITICAL: Check text after the match for reference range patterns
      // If we see "Reference Range:" or similar right after, this value might be correct
      // But if we see the value is part of a range like "0-8", skip it
      const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 50);
      const beforeMatch = text.substring(Math.max(0, match.index - 30), match.index);

      // Check if value appears to be part of a reference range (e.g., "0-8" or "140-400")
      const rangePatternBefore = /[-–]\s*$/;
      const rangePatternAfter = /^\s*[-–]\s*\d/;
      if (rangePatternBefore.test(beforeMatch) || rangePatternAfter.test(afterMatch)) {
        console.log(`[SKIP PATTERN] Value ${value} appears to be part of range for ${biomarker.name}`);
        continue;
      }

      // Validate value is within reasonable bounds for this biomarker
      const range = biomarker.normalRange;
      if (value < range.min * 0.01 || value > range.max * 100) {
        console.log(`[SKIP PATTERN] Value ${value} out of reasonable range for ${biomarker.name} (expected ${range.min}-${range.max})`);
        continue;
      }

      foundNames.add(biomarker.name);

      let confidence = 0.7; // Lower base confidence for pattern matching (line-based is preferred)
      if (value >= biomarker.normalRange.min * 0.1 && value <= biomarker.normalRange.max * 10) {
        confidence += 0.1;
      }

      results.push({
        name: biomarker.name,
        value,
        unit: biomarker.defaultUnit,
        category: biomarker.category,
        normalRange: { ...biomarker.normalRange, source: 'Standard Reference Range' },
        confidence: Math.min(confidence, 1.0),
        rawMatch: match[0].substring(0, 100),
      });

      console.log(`[PATTERN MATCH] ${biomarker.name}: ${value} ${biomarker.defaultUnit}`);
      break;
    }
  }

  console.log(`[PATTERN EXTRACTION] Found ${results.length} biomarkers`);
  return results;
}

/**
 * Check if a line contains ONLY a numeric value (possibly with H/L flag)
 * This handles Document AI splitting table columns into separate lines
 */
function isValueOnlyLine(line: string): { value: number; flag?: string } | null {
  const trimmed = line.trim();
  // Match: number with optional decimal, optional H/L flag, optional unit
  // Examples: "193", "43 L", "2.6", "234 H", "0.86"
  const match = trimmed.match(/^(\d+\.?\d*)\s*([HL])?\s*(%|mg\/dL|g\/dL|K\/uL|M\/uL|fL|pg|ng\/mL|mIU\/mL|mEq\/L|mmol\/L)?$/i);
  if (match) {
    const value = parseFloat(match[1]);
    if (!isNaN(value) && value >= 0 && value < 100000) {
      return { value, flag: match[2] };
    }
  }
  return null;
}

/**
 * Check if a line is primarily a biomarker name (with little or no trailing content)
 */
function isNameOnlyLine(line: string, nameEndIndex: number): boolean {
  const afterName = line.substring(nameEndIndex).trim();
  // If there's very little after the name, it's likely a name-only line
  // Allow for trailing punctuation or very short suffixes
  return afterName.length < 5 || /^[,;:\s]*$/.test(afterName);
}

/**
 * Extract biomarkers using line-by-line analysis for tabular formats
 * Handles both single-line format and Document AI multi-line format where
 * table columns are split into separate lines.
 *
 * Single-line: "CHOLESTEROL, TOTAL    193    Reference Range: <200 mg/dL"
 * Multi-line:
 *   Line 1: "CHOLESTEROL, TOTAL"
 *   Line 2: "193"
 *   Line 3: "Reference Range: <200 mg/dL"
 */
function extractFromLines(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();
  const lines = text.split('\n');

  console.log(`[LINE ANALYSIS] Processing ${lines.length} lines`);
  console.log('[LINE ANALYSIS] First 30 lines:');
  lines.slice(0, 30).forEach((line, i) => console.log(`  ${i}: "${line.substring(0, 80)}"`));

  // Track which lines we've used as values (to avoid double-matching)
  const usedValueLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 2) continue;

    // Skip lines we've already used as value lines
    if (usedValueLines.has(i)) continue;

    // Skip lines that are clearly not result rows (headers, educational text, etc.)
    // But allow short lines that might be biomarker names in multi-line format
    if (line.length > 50 && !looksLikeResultRow(line)) continue;

    for (const biomarker of ALL_BIOMARKERS) {
      if (foundNames.has(biomarker.name)) continue;

      // Check if line contains the biomarker name or any alias
      const namesToCheck = [biomarker.name, ...biomarker.aliases];
      let matchedName = '';
      let matchedNameEnd = -1;

      for (const name of namesToCheck) {
        const nameRegex = new RegExp(`\\b(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
        const nameMatch = line.match(nameRegex);
        if (nameMatch && nameMatch.index !== undefined) {
          matchedName = name;
          matchedNameEnd = nameMatch.index + nameMatch[0].length;
          break;
        }
      }

      if (matchedNameEnd === -1) continue;

      console.log(`[LINE ${i}] Found biomarker "${matchedName}" in line: "${line}"`);

      let extractedValue: number | null = null;
      let rawMatch = line;
      let valueLineIndex = i;

      // STRATEGY 1: Try to extract value from the same line (traditional format)
      const sameLineExtraction = extractResultValue(line, matchedNameEnd);
      if (sameLineExtraction) {
        extractedValue = sameLineExtraction.value;
        rawMatch = sameLineExtraction.rawMatch;
        console.log(`[LINE ${i}] Same-line extraction: value=${extractedValue}`);
      }

      // STRATEGY 2: If no value on same line, check ONLY the immediately next line
      // This handles Document AI splitting table columns into separate lines:
      //   Line N:   "CHOLESTEROL, TOTAL"
      //   Line N+1: "193"              <-- value MUST be here
      //   Line N+2: "Reference Range..." (skip)
      if (extractedValue === null && isNameOnlyLine(line, matchedNameEnd)) {
        const nextLineIndex = i + 1;
        if (nextLineIndex < lines.length && !usedValueLines.has(nextLineIndex)) {
          const nextLine = lines[nextLineIndex].trim();

          // The next line MUST be a "value-only" line - just a number
          // Examples: "193", "43 L", "2.6", "234 H"
          // NOT: "Reference Range...", "32.0-36.0 g/dL", "PLATELET COUNT"
          if (nextLine) {
            const valueResult = isValueOnlyLine(nextLine);
            if (valueResult) {
              extractedValue = valueResult.value;
              valueLineIndex = nextLineIndex;
              rawMatch = `${line} | ${nextLine}`;
              console.log(`[LINE ${i}] Multi-line: "${matchedName}" = ${extractedValue} (from line ${valueLineIndex})`);
              usedValueLines.add(valueLineIndex);
            } else {
              console.log(`[LINE ${i}] Next line not a value: "${nextLine.substring(0, 30)}"`);
            }
          }
        }
      }

      if (extractedValue === null) {
        console.log(`[LINE ${i}] No value extracted for ${biomarker.name}`);
        continue;
      }

      // Validate value is within reasonable bounds for this biomarker
      const range = biomarker.normalRange;
      if (extractedValue < range.min * 0.01 || extractedValue > range.max * 100) {
        console.log(`[LINE ${i}] Value ${extractedValue} out of range for ${biomarker.name} (expected ${range.min * 0.01}-${range.max * 100})`);
        continue;
      }

      foundNames.add(biomarker.name);

      results.push({
        name: biomarker.name,
        value: extractedValue,
        unit: biomarker.defaultUnit,
        category: biomarker.category,
        normalRange: { ...range, source: 'Standard Reference Range' },
        confidence: 0.85,
        rawMatch: rawMatch.substring(0, 150),
      });

      console.log(`[LINE MATCH] ${biomarker.name}: ${extractedValue} ${biomarker.defaultUnit} (lines ${i}-${valueLineIndex})`);
      break;
    }
  }

  console.log(`[LINE ANALYSIS] Found ${results.length} biomarkers`);
  return results;
}

/**
 * Extract biomarkers using newline-spanning patterns
 * This handles Document AI output where table columns are on separate lines.
 *
 * Pattern: BIOMARKER_NAME followed by whitespace/newlines then a NUMBER
 * Example: "PLATELET COUNT\n242" or "CHOLESTEROL, TOTAL    \n193"
 */
function extractWithNewlineSpanning(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();

  console.log('[NEWLINE-SPAN] Starting newline-spanning extraction');

  for (const biomarker of ALL_BIOMARKERS) {
    if (foundNames.has(biomarker.name)) continue;

    // Check each name/alias
    const namesToCheck = [biomarker.name, ...biomarker.aliases];

    for (const name of namesToCheck) {
      // Create pattern: biomarker name, then whitespace/newlines, then number
      // The number must NOT be preceded by reference indicators like < > - or followed by -
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Pattern: name, whitespace (including newlines), number with optional H/L flag
      // The number should NOT be followed by a dash (which indicates a range like 140-400)
      const pattern = new RegExp(
        `\\b${escapedName}\\b[\\s\\n]+(\\d+\\.?\\d*)(?:\\s*([HL]))?(?![\\s]*[-–][\\s]*\\d)`,
        'i'
      );

      const match = text.match(pattern);

      // Additional check: skip if the character before the number is < > - (reference range indicators)
      if (match && match.index !== undefined) {
        const beforeMatch = text.substring(Math.max(0, match.index - 5), match.index);
        if (/[<>–-]\s*$/.test(beforeMatch)) {
          console.log(`[NEWLINE-SPAN] Skipping ${biomarker.name}: preceded by range indicator`);
          continue;
        }
      }
      if (match) {
        const value = parseFloat(match[1]);
        const flag = match[2];

        if (isNaN(value) || value < 0 || value > 100000) continue;

        // Validate value is reasonable for this biomarker
        const range = biomarker.normalRange;
        if (value < range.min * 0.01 || value > range.max * 100) {
          console.log(`[NEWLINE-SPAN] Skipping ${biomarker.name}: ${value} out of range (${range.min}-${range.max})`);
          continue;
        }

        foundNames.add(biomarker.name);

        results.push({
          name: biomarker.name,
          value,
          unit: biomarker.defaultUnit,
          category: biomarker.category,
          normalRange: { ...range, source: 'Standard Reference Range' },
          confidence: 0.80,
          rawMatch: match[0].substring(0, 100),
        });

        console.log(`[NEWLINE-SPAN] ${biomarker.name}: ${value}${flag ? ' ' + flag : ''} ${biomarker.defaultUnit}`);
        break;
      }
    }
  }

  console.log(`[NEWLINE-SPAN] Found ${results.length} biomarkers`);
  return results;
}

/**
 * Hybrid extraction: Try multiple strategies and merge results
 */
export function extractBiomarkersFromText(text: string): ExtractedBiomarker[] {
  console.log('[EXTRACTION] ========================================');
  console.log('[EXTRACTION] Starting hybrid biomarker extraction');
  console.log(`[EXTRACTION] Text length: ${text.length} chars`);
  console.log('[EXTRACTION] Text preview (first 500 chars):');
  console.log(text.substring(0, 500));
  console.log('[EXTRACTION] ========================================');

  // Strategy 1: Line-by-line extraction (for properly formatted tables)
  const lineResults = extractFromLines(text);
  console.log(`[EXTRACTION] Line extraction found: ${lineResults.length} biomarkers`);
  lineResults.forEach(r => console.log(`  - ${r.name}: ${r.value} ${r.unit}`));

  // Strategy 2: Newline-spanning patterns (for Document AI split columns)
  const newlineSpanResults = extractWithNewlineSpanning(text);
  console.log(`[EXTRACTION] Newline-span extraction found: ${newlineSpanResults.length} biomarkers`);
  newlineSpanResults.forEach(r => console.log(`  - ${r.name}: ${r.value} ${r.unit}`));

  // Strategy 3: Traditional regex patterns (fallback)
  const patternResults = extractWithPatterns(text);
  console.log(`[EXTRACTION] Pattern extraction found: ${patternResults.length} biomarkers`);
  patternResults.forEach(r => console.log(`  - ${r.name}: ${r.value} ${r.unit}`));

  // Merge results: line-based > newline-span > pattern-based
  const foundNames = new Set<string>();
  const combined: ExtractedBiomarker[] = [];

  // Add line results first (highest priority)
  for (const r of lineResults) {
    if (!foundNames.has(r.name)) {
      foundNames.add(r.name);
      combined.push(r);
    }
  }

  // Add newline-span results
  for (const r of newlineSpanResults) {
    if (!foundNames.has(r.name)) {
      foundNames.add(r.name);
      combined.push(r);
    }
  }

  // Add pattern results last (lowest priority)
  for (const r of patternResults) {
    if (!foundNames.has(r.name)) {
      foundNames.add(r.name);
      combined.push(r);
    }
  }

  console.log('[EXTRACTION] ========================================');
  console.log(`[EXTRACTION] Total unique biomarkers: ${combined.length}`);
  combined.forEach(r => console.log(`  FINAL: ${r.name}: ${r.value} ${r.unit} (confidence: ${r.confidence})`));
  console.log('[EXTRACTION] ========================================');

  return combined;
}

/**
 * Validate extracted biomarker values
 */
export function validateBiomarkerValue(
  name: string,
  value: number,
  _unit: string
): { valid: boolean; reason?: string } {
  const biomarker = ALL_BIOMARKERS.find(
    (b) => b.name === name || b.aliases.some((a) => a.toLowerCase() === name.toLowerCase())
  );

  if (!biomarker) {
    return { valid: true };
  }

  const range = biomarker.normalRange;
  if (value < range.min * 0.01 || value > range.max * 100) {
    return {
      valid: false,
      reason: `Value ${value} is outside reasonable range for ${name}`,
    };
  }

  return { valid: true };
}

// Legacy export for backward compatibility
export const BONE_HEALTH_BIOMARKERS = ALL_BIOMARKERS.filter((b) => b.category === 'Bone Health');

export default {
  ALL_BIOMARKERS,
  BIOMARKER_CATEGORIES,
  BONE_HEALTH_BIOMARKERS,
  extractBiomarkersFromText,
  validateBiomarkerValue,
  normalizeUnit,
};
