/**
 * Biomarker Definitions
 *
 * Comprehensive definitions for lab biomarkers including names, aliases,
 * categories, units, and normal reference ranges.
 */

export interface BiomarkerDefinition {
  names: string[]; // Alternative names/aliases
  displayName: string;
  category: string;
  defaultUnit: string;
  alternativeUnits?: string[];
  normalRange: { min: number; max: number };
  // Some biomarkers need unit-specific ranges
  unitRanges?: Record<string, { min: number; max: number }>;
}

export const BIOMARKER_DEFINITIONS: BiomarkerDefinition[] = [
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
