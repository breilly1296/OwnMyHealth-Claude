/**
 * Lab Report Parser - OCR-based extraction of biomarkers from lab reports
 *
 * Uses Tesseract.js for OCR and pdf.js for PDF text extraction.
 * Includes comprehensive mapping of common lab test names to biomarker categories.
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker, Worker } from 'tesseract.js';
import type { Biomarker, NormalRange } from '../../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ============================================
// Types
// ============================================

export interface LabReportParseResult {
  success: boolean;
  biomarkers: Partial<Biomarker>[];
  rawText: string;
  confidence: number;
  processingTime: number;
  errors?: string[];
  warnings?: string[];
  labName?: string;
  reportDate?: string;
  patientInfo?: {
    name?: string;
    dob?: string;
    id?: string;
  };
}

export interface ExtractedBiomarkerData {
  name: string;
  value: number;
  unit: string;
  referenceRange?: { min: number; max: number };
  flag?: 'H' | 'L' | 'N' | 'A';
  rawText: string;
  confidence: number;
}

type BiomarkerCategory = Biomarker['category'];

interface BiomarkerMapping {
  category: BiomarkerCategory;
  standardName: string;
  unit: string;
  normalRange: NormalRange;
  aliases: string[];
}

// ============================================
// Comprehensive Lab Test to Biomarker Mapping
// ============================================

const LAB_TEST_MAPPINGS: Record<string, BiomarkerMapping> = {
  // === Blood Count / Hematology ===
  'wbc': {
    category: 'Blood',
    standardName: 'White Blood Cell Count',
    unit: 'K/uL',
    normalRange: { min: 4.5, max: 11.0, source: 'Standard Reference' },
    aliases: ['white blood cells', 'white blood cell count', 'leukocytes', 'wbc count']
  },
  'rbc': {
    category: 'Blood',
    standardName: 'Red Blood Cell Count',
    unit: 'M/uL',
    normalRange: { min: 4.5, max: 5.5, source: 'Standard Reference' },
    aliases: ['red blood cells', 'red blood cell count', 'erythrocytes', 'rbc count']
  },
  'hemoglobin': {
    category: 'Blood',
    standardName: 'Hemoglobin',
    unit: 'g/dL',
    normalRange: { min: 12.0, max: 17.5, source: 'Standard Reference' },
    aliases: ['hgb', 'hb', 'haemoglobin']
  },
  'hematocrit': {
    category: 'Blood',
    standardName: 'Hematocrit',
    unit: '%',
    normalRange: { min: 36, max: 50, source: 'Standard Reference' },
    aliases: ['hct', 'packed cell volume', 'pcv']
  },
  'platelets': {
    category: 'Blood',
    standardName: 'Platelet Count',
    unit: 'K/uL',
    normalRange: { min: 150, max: 400, source: 'Standard Reference' },
    aliases: ['plt', 'platelet count', 'thrombocytes']
  },
  'mcv': {
    category: 'Blood',
    standardName: 'Mean Corpuscular Volume',
    unit: 'fL',
    normalRange: { min: 80, max: 100, source: 'Standard Reference' },
    aliases: ['mean corpuscular volume', 'mean cell volume']
  },
  'mch': {
    category: 'Blood',
    standardName: 'Mean Corpuscular Hemoglobin',
    unit: 'pg',
    normalRange: { min: 27, max: 33, source: 'Standard Reference' },
    aliases: ['mean corpuscular hemoglobin', 'mean cell hemoglobin']
  },
  'mchc': {
    category: 'Blood',
    standardName: 'Mean Corpuscular Hemoglobin Concentration',
    unit: 'g/dL',
    normalRange: { min: 32, max: 36, source: 'Standard Reference' },
    aliases: ['mean corpuscular hemoglobin concentration']
  },
  'rdw': {
    category: 'Blood',
    standardName: 'Red Cell Distribution Width',
    unit: '%',
    normalRange: { min: 11.5, max: 14.5, source: 'Standard Reference' },
    aliases: ['red cell distribution width', 'rdw-cv']
  },

  // === Lipid Panel ===
  'total_cholesterol': {
    category: 'Lipids',
    standardName: 'Total Cholesterol',
    unit: 'mg/dL',
    normalRange: { min: 0, max: 200, source: 'Standard Reference' },
    aliases: ['cholesterol', 'total chol', 'chol']
  },
  'ldl': {
    category: 'Lipids',
    standardName: 'LDL Cholesterol',
    unit: 'mg/dL',
    normalRange: { min: 0, max: 100, source: 'Standard Reference' },
    aliases: ['ldl cholesterol', 'ldl-c', 'low density lipoprotein', 'bad cholesterol']
  },
  'hdl': {
    category: 'Lipids',
    standardName: 'HDL Cholesterol',
    unit: 'mg/dL',
    normalRange: { min: 40, max: 200, source: 'Standard Reference' },
    aliases: ['hdl cholesterol', 'hdl-c', 'high density lipoprotein', 'good cholesterol']
  },
  'triglycerides': {
    category: 'Lipids',
    standardName: 'Triglycerides',
    unit: 'mg/dL',
    normalRange: { min: 0, max: 150, source: 'Standard Reference' },
    aliases: ['trig', 'trigs', 'tg']
  },
  'vldl': {
    category: 'Lipids',
    standardName: 'VLDL Cholesterol',
    unit: 'mg/dL',
    normalRange: { min: 5, max: 40, source: 'Standard Reference' },
    aliases: ['vldl cholesterol', 'very low density lipoprotein']
  },

  // === Comprehensive Metabolic Panel ===
  'glucose': {
    category: 'Blood',
    standardName: 'Glucose (Fasting)',
    unit: 'mg/dL',
    normalRange: { min: 70, max: 100, source: 'Standard Reference' },
    aliases: ['blood glucose', 'fasting glucose', 'blood sugar', 'fbs', 'fasting blood sugar']
  },
  'bun': {
    category: 'Kidney Function',
    standardName: 'Blood Urea Nitrogen',
    unit: 'mg/dL',
    normalRange: { min: 7, max: 20, source: 'Standard Reference' },
    aliases: ['blood urea nitrogen', 'urea nitrogen']
  },
  'creatinine': {
    category: 'Kidney Function',
    standardName: 'Creatinine',
    unit: 'mg/dL',
    normalRange: { min: 0.7, max: 1.3, source: 'Standard Reference' },
    aliases: ['creat', 'serum creatinine']
  },
  'egfr': {
    category: 'Kidney Function',
    standardName: 'Estimated GFR',
    unit: 'mL/min/1.73m²',
    normalRange: { min: 90, max: 120, source: 'Standard Reference' },
    aliases: ['estimated gfr', 'glomerular filtration rate', 'gfr']
  },
  'bun_creatinine_ratio': {
    category: 'Kidney Function',
    standardName: 'BUN/Creatinine Ratio',
    unit: 'ratio',
    normalRange: { min: 10, max: 20, source: 'Standard Reference' },
    aliases: ['bun/creat ratio', 'bun creatinine ratio']
  },

  // === Electrolytes ===
  'sodium': {
    category: 'Electrolytes',
    standardName: 'Sodium',
    unit: 'mEq/L',
    normalRange: { min: 136, max: 145, source: 'Standard Reference' },
    aliases: ['na', 'serum sodium', 'na+']
  },
  'potassium': {
    category: 'Electrolytes',
    standardName: 'Potassium',
    unit: 'mEq/L',
    normalRange: { min: 3.5, max: 5.0, source: 'Standard Reference' },
    aliases: ['k', 'serum potassium', 'k+']
  },
  'chloride': {
    category: 'Electrolytes',
    standardName: 'Chloride',
    unit: 'mEq/L',
    normalRange: { min: 98, max: 106, source: 'Standard Reference' },
    aliases: ['cl', 'serum chloride', 'cl-']
  },
  'co2': {
    category: 'Electrolytes',
    standardName: 'Carbon Dioxide',
    unit: 'mEq/L',
    normalRange: { min: 23, max: 29, source: 'Standard Reference' },
    aliases: ['carbon dioxide', 'bicarbonate', 'hco3', 'total co2']
  },
  'calcium': {
    category: 'Electrolytes',
    standardName: 'Calcium',
    unit: 'mg/dL',
    normalRange: { min: 8.5, max: 10.5, source: 'Standard Reference' },
    aliases: ['ca', 'serum calcium', 'total calcium']
  },
  'magnesium': {
    category: 'Electrolytes',
    standardName: 'Magnesium',
    unit: 'mg/dL',
    normalRange: { min: 1.7, max: 2.2, source: 'Standard Reference' },
    aliases: ['mg', 'serum magnesium']
  },
  'phosphorus': {
    category: 'Electrolytes',
    standardName: 'Phosphorus',
    unit: 'mg/dL',
    normalRange: { min: 2.5, max: 4.5, source: 'Standard Reference' },
    aliases: ['phos', 'phosphate', 'serum phosphorus']
  },

  // === Liver Function ===
  'alt': {
    category: 'Liver Function',
    standardName: 'ALT (Alanine Aminotransferase)',
    unit: 'U/L',
    normalRange: { min: 7, max: 56, source: 'Standard Reference' },
    aliases: ['alanine aminotransferase', 'sgpt', 'alanine transaminase']
  },
  'ast': {
    category: 'Liver Function',
    standardName: 'AST (Aspartate Aminotransferase)',
    unit: 'U/L',
    normalRange: { min: 10, max: 40, source: 'Standard Reference' },
    aliases: ['aspartate aminotransferase', 'sgot', 'aspartate transaminase']
  },
  'alp': {
    category: 'Liver Function',
    standardName: 'Alkaline Phosphatase',
    unit: 'U/L',
    normalRange: { min: 44, max: 147, source: 'Standard Reference' },
    aliases: ['alkaline phosphatase', 'alk phos', 'alkp']
  },
  'total_bilirubin': {
    category: 'Liver Function',
    standardName: 'Total Bilirubin',
    unit: 'mg/dL',
    normalRange: { min: 0.1, max: 1.2, source: 'Standard Reference' },
    aliases: ['bilirubin', 'total bili', 'tbili']
  },
  'direct_bilirubin': {
    category: 'Liver Function',
    standardName: 'Direct Bilirubin',
    unit: 'mg/dL',
    normalRange: { min: 0, max: 0.3, source: 'Standard Reference' },
    aliases: ['conjugated bilirubin', 'direct bili', 'dbili']
  },
  'ggt': {
    category: 'Liver Function',
    standardName: 'Gamma-Glutamyl Transferase',
    unit: 'U/L',
    normalRange: { min: 9, max: 48, source: 'Standard Reference' },
    aliases: ['gamma-glutamyl transferase', 'gamma gt', 'ggtp']
  },
  'albumin': {
    category: 'Liver Function',
    standardName: 'Albumin',
    unit: 'g/dL',
    normalRange: { min: 3.5, max: 5.5, source: 'Standard Reference' },
    aliases: ['serum albumin', 'alb']
  },
  'total_protein': {
    category: 'Liver Function',
    standardName: 'Total Protein',
    unit: 'g/dL',
    normalRange: { min: 6.0, max: 8.3, source: 'Standard Reference' },
    aliases: ['protein total', 'tp', 'serum protein']
  },

  // === Thyroid Panel ===
  'tsh': {
    category: 'Hormones',
    standardName: 'TSH (Thyroid Stimulating Hormone)',
    unit: 'mIU/L',
    normalRange: { min: 0.4, max: 4.0, source: 'Standard Reference' },
    aliases: ['thyroid stimulating hormone', 'thyrotropin']
  },
  't4_free': {
    category: 'Hormones',
    standardName: 'Free T4',
    unit: 'ng/dL',
    normalRange: { min: 0.8, max: 1.8, source: 'Standard Reference' },
    aliases: ['free thyroxine', 'ft4', 'free t4']
  },
  't3_free': {
    category: 'Hormones',
    standardName: 'Free T3',
    unit: 'pg/mL',
    normalRange: { min: 2.3, max: 4.2, source: 'Standard Reference' },
    aliases: ['free triiodothyronine', 'ft3', 'free t3']
  },
  't4_total': {
    category: 'Hormones',
    standardName: 'Total T4',
    unit: 'μg/dL',
    normalRange: { min: 4.5, max: 12.5, source: 'Standard Reference' },
    aliases: ['total thyroxine', 'thyroxine']
  },
  't3_total': {
    category: 'Hormones',
    standardName: 'Total T3',
    unit: 'ng/dL',
    normalRange: { min: 80, max: 200, source: 'Standard Reference' },
    aliases: ['total triiodothyronine', 'triiodothyronine']
  },

  // === Vitamins ===
  'vitamin_d': {
    category: 'Vitamins',
    standardName: 'Vitamin D (25-Hydroxy)',
    unit: 'ng/mL',
    normalRange: { min: 30, max: 100, source: 'Standard Reference' },
    aliases: ['25-oh vitamin d', '25-hydroxy vitamin d', 'vitamin d 25-oh', 'vit d', '25-hydroxyvitamin d']
  },
  'vitamin_b12': {
    category: 'Vitamins',
    standardName: 'Vitamin B12',
    unit: 'pg/mL',
    normalRange: { min: 200, max: 900, source: 'Standard Reference' },
    aliases: ['cobalamin', 'b12', 'vit b12', 'cyanocobalamin']
  },
  'folate': {
    category: 'Vitamins',
    standardName: 'Folate',
    unit: 'ng/mL',
    normalRange: { min: 3, max: 20, source: 'Standard Reference' },
    aliases: ['folic acid', 'vitamin b9', 'serum folate']
  },
  'vitamin_a': {
    category: 'Vitamins',
    standardName: 'Vitamin A',
    unit: 'μg/dL',
    normalRange: { min: 30, max: 65, source: 'Standard Reference' },
    aliases: ['retinol', 'vit a']
  },
  'vitamin_e': {
    category: 'Vitamins',
    standardName: 'Vitamin E',
    unit: 'mg/L',
    normalRange: { min: 5.5, max: 17, source: 'Standard Reference' },
    aliases: ['tocopherol', 'alpha-tocopherol', 'vit e']
  },

  // === Iron Studies ===
  'iron': {
    category: 'Blood',
    standardName: 'Iron',
    unit: 'μg/dL',
    normalRange: { min: 60, max: 170, source: 'Standard Reference' },
    aliases: ['serum iron', 'fe']
  },
  'ferritin': {
    category: 'Blood',
    standardName: 'Ferritin',
    unit: 'ng/mL',
    normalRange: { min: 12, max: 300, source: 'Standard Reference' },
    aliases: ['serum ferritin']
  },
  'tibc': {
    category: 'Blood',
    standardName: 'Total Iron Binding Capacity',
    unit: 'μg/dL',
    normalRange: { min: 250, max: 400, source: 'Standard Reference' },
    aliases: ['total iron binding capacity', 'iron binding capacity']
  },
  'transferrin_saturation': {
    category: 'Blood',
    standardName: 'Transferrin Saturation',
    unit: '%',
    normalRange: { min: 20, max: 50, source: 'Standard Reference' },
    aliases: ['tsat', 'iron saturation', 'transferrin sat']
  },

  // === Inflammation Markers ===
  'crp': {
    category: 'Inflammation Markers',
    standardName: 'C-Reactive Protein',
    unit: 'mg/L',
    normalRange: { min: 0, max: 3, source: 'Standard Reference' },
    aliases: ['c-reactive protein', 'c reactive protein']
  },
  'hs_crp': {
    category: 'Inflammation Markers',
    standardName: 'High-Sensitivity CRP',
    unit: 'mg/L',
    normalRange: { min: 0, max: 1, source: 'Standard Reference' },
    aliases: ['high sensitivity crp', 'hs-crp', 'cardiac crp']
  },
  'esr': {
    category: 'Inflammation Markers',
    standardName: 'Erythrocyte Sedimentation Rate',
    unit: 'mm/hr',
    normalRange: { min: 0, max: 20, source: 'Standard Reference' },
    aliases: ['erythrocyte sedimentation rate', 'sed rate', 'sedimentation rate']
  },
  'homocysteine': {
    category: 'Inflammation Markers',
    standardName: 'Homocysteine',
    unit: 'μmol/L',
    normalRange: { min: 5, max: 15, source: 'Standard Reference' },
    aliases: ['hcy', 'plasma homocysteine']
  },

  // === Diabetes Markers ===
  'hba1c': {
    category: 'Blood',
    standardName: 'Hemoglobin A1c',
    unit: '%',
    normalRange: { min: 4, max: 5.7, source: 'Standard Reference' },
    aliases: ['hemoglobin a1c', 'glycated hemoglobin', 'glycosylated hemoglobin', 'a1c', 'hgba1c']
  },
  'insulin': {
    category: 'Hormones',
    standardName: 'Insulin (Fasting)',
    unit: 'μIU/mL',
    normalRange: { min: 2.6, max: 24.9, source: 'Standard Reference' },
    aliases: ['fasting insulin', 'serum insulin']
  },

  // === Hormones ===
  'testosterone_total': {
    category: 'Hormones',
    standardName: 'Testosterone (Total)',
    unit: 'ng/dL',
    normalRange: { min: 300, max: 1000, source: 'Standard Reference (Male)' },
    aliases: ['total testosterone', 'testosterone']
  },
  'testosterone_free': {
    category: 'Hormones',
    standardName: 'Testosterone (Free)',
    unit: 'pg/mL',
    normalRange: { min: 50, max: 210, source: 'Standard Reference (Male)' },
    aliases: ['free testosterone', 'free test']
  },
  'estradiol': {
    category: 'Hormones',
    standardName: 'Estradiol',
    unit: 'pg/mL',
    normalRange: { min: 10, max: 400, source: 'Standard Reference' },
    aliases: ['e2', 'estrogen']
  },
  'cortisol': {
    category: 'Hormones',
    standardName: 'Cortisol',
    unit: 'μg/dL',
    normalRange: { min: 6, max: 23, source: 'Standard Reference (AM)' },
    aliases: ['serum cortisol', 'am cortisol']
  },
  'dhea_s': {
    category: 'Hormones',
    standardName: 'DHEA-Sulfate',
    unit: 'μg/dL',
    normalRange: { min: 100, max: 400, source: 'Standard Reference' },
    aliases: ['dhea-s', 'dheas', 'dehydroepiandrosterone sulfate']
  },
  'psa': {
    category: 'Hormones',
    standardName: 'PSA (Prostate-Specific Antigen)',
    unit: 'ng/mL',
    normalRange: { min: 0, max: 4, source: 'Standard Reference' },
    aliases: ['prostate specific antigen', 'prostate-specific antigen']
  },

  // === Uric Acid ===
  'uric_acid': {
    category: 'Kidney Function',
    standardName: 'Uric Acid',
    unit: 'mg/dL',
    normalRange: { min: 2.4, max: 7.0, source: 'Standard Reference' },
    aliases: ['serum uric acid', 'urate']
  },

  // === Vital Signs (when included in labs) ===
  'blood_pressure_systolic': {
    category: 'Vital Signs',
    standardName: 'Blood Pressure (Systolic)',
    unit: 'mmHg',
    normalRange: { min: 90, max: 120, source: 'Standard Reference' },
    aliases: ['systolic bp', 'systolic blood pressure', 'sbp']
  },
  'blood_pressure_diastolic': {
    category: 'Vital Signs',
    standardName: 'Blood Pressure (Diastolic)',
    unit: 'mmHg',
    normalRange: { min: 60, max: 80, source: 'Standard Reference' },
    aliases: ['diastolic bp', 'diastolic blood pressure', 'dbp']
  },
  'heart_rate': {
    category: 'Vital Signs',
    standardName: 'Heart Rate',
    unit: 'bpm',
    normalRange: { min: 60, max: 100, source: 'Standard Reference' },
    aliases: ['pulse', 'hr', 'pulse rate']
  },

  // === Body Composition ===
  'bmi': {
    category: 'Body Composition',
    standardName: 'Body Mass Index',
    unit: 'kg/m²',
    normalRange: { min: 18.5, max: 24.9, source: 'Standard Reference' },
    aliases: ['body mass index']
  },
  'weight': {
    category: 'Body Composition',
    standardName: 'Weight',
    unit: 'kg',
    normalRange: { min: 0, max: 999, source: 'Individual Specific' },
    aliases: ['body weight']
  },
};

// ============================================
// Pattern Matching for Lab Values
// ============================================

// Patterns to extract lab values with different formats
const LAB_VALUE_PATTERNS = [
  // Pattern: "Test Name: 123.4 mg/dL"
  /([a-zA-Z][a-zA-Z0-9\s\-/()]+?)[\s:]+([0-9]+\.?[0-9]*)\s*([a-zA-Z%/μµ²³]+(?:\/[a-zA-Z]+)?)/gi,

  // Pattern: "Test Name 123.4 H" (with flag)
  /([a-zA-Z][a-zA-Z0-9\s\-/()]+?)\s+([0-9]+\.?[0-9]*)\s*([a-zA-Z%/μµ²³]+(?:\/[a-zA-Z]+)?)\s*([HLN])?/gi,

  // Pattern: "Test Name: 123.4 (70-100)"
  /([a-zA-Z][a-zA-Z0-9\s\-/()]+?)[\s:]+([0-9]+\.?[0-9]*)\s*\(?([0-9]+\.?[0-9]*)\s*[-–]\s*([0-9]+\.?[0-9]*)\)?/gi,

  // Pattern for table format: "Test Name | 123.4 | mg/dL | 70-100"
  /([a-zA-Z][a-zA-Z0-9\s\-/()]+?)\s*[|\t]\s*([0-9]+\.?[0-9]*)\s*[|\t]\s*([a-zA-Z%/μµ²³]+)/gi,
];

// Reference range patterns
const REFERENCE_RANGE_PATTERNS = [
  /\(?([0-9]+\.?[0-9]*)\s*[-–]\s*([0-9]+\.?[0-9]*)\)?/,
  /ref(?:erence)?[:\s]+([0-9]+\.?[0-9]*)\s*[-–]\s*([0-9]+\.?[0-9]*)/i,
  /normal[:\s]+([0-9]+\.?[0-9]*)\s*[-–]\s*([0-9]+\.?[0-9]*)/i,
];

// Lab report header patterns
const LAB_HEADER_PATTERNS = {
  labName: /(?:laboratory|lab|clinic|hospital|medical center)[:\s]+([^\n\r]+)/i,
  reportDate: /(?:collection|collected|report|specimen)\s*date[:\s]+([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
  patientName: /(?:patient|name)[:\s]+([^\n\r,]+)/i,
  patientDOB: /(?:dob|date of birth|birth date)[:\s]+([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
  patientId: /(?:patient id|mrn|medical record)[:\s#]+([A-Z0-9-]+)/i,
};

// ============================================
// Text Extraction Functions
// ============================================

/**
 * Extract text from PDF file
 */
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

/**
 * Convert PDF pages to images for OCR
 */
async function pdfToImages(file: File): Promise<ImageData[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: ImageData[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    images.push(imageData);
  }

  return images;
}

/**
 * Perform OCR on image file
 */
async function performOCR(
  input: File | ImageData,
  worker: Worker,
  onProgress?: (progress: number) => void
): Promise<string> {
  const result = await worker.recognize(input, {
    // Progress callback if provided
  }, {
    text: true
  });

  if (onProgress) {
    onProgress(100);
  }

  return result.data.text;
}

/**
 * Extract text from document (PDF or image)
 */
export async function extractTextFromLabReport(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  const worker = await createWorker('eng');

  try {
    let fullText = '';

    if (file.type === 'application/pdf') {
      // First try direct text extraction from PDF
      const directText = await extractTextFromPDF(file);

      // Check if we got meaningful text
      if (directText.trim().length > 100) {
        fullText = directText;
        onProgress?.(100);
      } else {
        // Fall back to OCR for scanned PDFs
        const images = await pdfToImages(file);
        const totalPages = images.length;

        for (let i = 0; i < images.length; i++) {
          const pageText = await performOCR(images[i], worker);
          fullText += pageText + '\n';
          onProgress?.(Math.round(((i + 1) / totalPages) * 100));
        }
      }
    } else if (file.type.startsWith('image/')) {
      // Direct OCR for images
      fullText = await performOCR(file, worker, onProgress);
    } else {
      throw new Error('Unsupported file type. Please upload a PDF or image file.');
    }

    return fullText;
  } finally {
    await worker.terminate();
  }
}

// ============================================
// Biomarker Identification Functions
// ============================================

/**
 * Find matching biomarker mapping for a test name
 */
function findBiomarkerMapping(testName: string): BiomarkerMapping | null {
  const normalizedName = testName.toLowerCase().trim();

  // Direct key match
  for (const [key, mapping] of Object.entries(LAB_TEST_MAPPINGS)) {
    if (normalizedName === key || normalizedName.includes(key.replace(/_/g, ' '))) {
      return mapping;
    }

    // Check aliases
    for (const alias of mapping.aliases) {
      if (normalizedName === alias || normalizedName.includes(alias)) {
        return mapping;
      }
    }
  }

  return null;
}

/**
 * Parse reference range from text
 */
function parseReferenceRange(text: string): { min: number; max: number } | null {
  for (const pattern of REFERENCE_RANGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const min = parseFloat(match[1]);
      const max = parseFloat(match[2]);
      if (!isNaN(min) && !isNaN(max) && min < max) {
        return { min, max };
      }
    }
  }
  return null;
}

/**
 * Normalize unit string
 */
function normalizeUnit(unit: string): string {
  const unitMappings: Record<string, string> = {
    'mg/dl': 'mg/dL',
    'mg/l': 'mg/L',
    'ng/ml': 'ng/mL',
    'pg/ml': 'pg/mL',
    'ug/dl': 'μg/dL',
    'miu/l': 'mIU/L',
    'uiu/ml': 'μIU/mL',
    'k/ul': 'K/uL',
    'm/ul': 'M/uL',
    'meq/l': 'mEq/L',
    'mmol/l': 'mmol/L',
    'u/l': 'U/L',
    'g/dl': 'g/dL',
    '%': '%',
    'fl': 'fL',
    'pg': 'pg',
    'mm/hr': 'mm/hr',
    'bpm': 'bpm',
    'mmhg': 'mmHg',
  };

  const normalized = unit.toLowerCase().replace(/\s+/g, '');
  return unitMappings[normalized] || unit;
}

/**
 * Extract biomarker data from raw text
 */
function extractBiomarkersFromText(text: string): ExtractedBiomarkerData[] {
  const extracted: ExtractedBiomarkerData[] = [];
  const processedNames = new Set<string>();

  // Split text into lines for better parsing
  const lines = text.split(/[\n\r]+/);

  for (const line of lines) {
    // Skip empty lines and headers
    if (line.trim().length < 5) continue;

    // Try each pattern
    for (const pattern of LAB_VALUE_PATTERNS) {
      // Reset pattern lastIndex for global patterns
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(line)) !== null) {
        const testName = match[1]?.trim();
        const value = parseFloat(match[2]);
        const unit = match[3]?.trim();

        if (!testName || isNaN(value) || !unit) continue;

        // Skip if already processed similar name
        const normalizedTestName = testName.toLowerCase();
        if (processedNames.has(normalizedTestName)) continue;

        // Find mapping for this test
        const mapping = findBiomarkerMapping(testName);

        if (mapping) {
          processedNames.add(normalizedTestName);

          // Try to extract reference range from the same line
          const refRange = parseReferenceRange(line);

          extracted.push({
            name: testName,
            value,
            unit: normalizeUnit(unit),
            referenceRange: refRange || undefined,
            rawText: line,
            confidence: calculateConfidence(testName, value, unit, mapping),
          });
        }
      }
    }
  }

  return extracted;
}

/**
 * Calculate confidence score for extracted biomarker
 */
function calculateConfidence(
  testName: string,
  value: number,
  unit: string,
  mapping: BiomarkerMapping
): number {
  let confidence = 0.5; // Base confidence

  // Check if unit matches expected
  const normalizedUnit = normalizeUnit(unit);
  if (normalizedUnit === mapping.unit) {
    confidence += 0.2;
  }

  // Check if value is in reasonable range
  const expectedRange = mapping.normalRange;
  const reasonableMin = expectedRange.min * 0.1;
  const reasonableMax = expectedRange.max * 10;
  if (value >= reasonableMin && value <= reasonableMax) {
    confidence += 0.2;
  }

  // Check name match quality
  const normalizedName = testName.toLowerCase();
  if (mapping.aliases.some(alias => normalizedName === alias)) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Extract lab report metadata
 */
function extractLabMetadata(text: string): {
  labName?: string;
  reportDate?: string;
  patientInfo?: { name?: string; dob?: string; id?: string };
} {
  const metadata: {
    labName?: string;
    reportDate?: string;
    patientInfo?: { name?: string; dob?: string; id?: string };
  } = {};

  const labNameMatch = text.match(LAB_HEADER_PATTERNS.labName);
  if (labNameMatch) {
    metadata.labName = labNameMatch[1].trim();
  }

  const reportDateMatch = text.match(LAB_HEADER_PATTERNS.reportDate);
  if (reportDateMatch) {
    metadata.reportDate = reportDateMatch[1];
  }

  const patientInfo: { name?: string; dob?: string; id?: string } = {};

  const patientNameMatch = text.match(LAB_HEADER_PATTERNS.patientName);
  if (patientNameMatch) {
    patientInfo.name = patientNameMatch[1].trim();
  }

  const patientDOBMatch = text.match(LAB_HEADER_PATTERNS.patientDOB);
  if (patientDOBMatch) {
    patientInfo.dob = patientDOBMatch[1];
  }

  const patientIdMatch = text.match(LAB_HEADER_PATTERNS.patientId);
  if (patientIdMatch) {
    patientInfo.id = patientIdMatch[1];
  }

  if (Object.keys(patientInfo).length > 0) {
    metadata.patientInfo = patientInfo;
  }

  return metadata;
}

/**
 * Convert extracted data to Biomarker format
 */
function convertToBiomarkers(
  extracted: ExtractedBiomarkerData[],
  reportDate?: string,
  sourceFile?: string
): Partial<Biomarker>[] {
  return extracted.map(data => {
    const mapping = findBiomarkerMapping(data.name);

    if (!mapping) {
      return {
        name: data.name,
        value: data.value,
        unit: data.unit,
        date: reportDate || new Date().toISOString().split('T')[0],
        category: 'Other' as BiomarkerCategory,
        normalRange: data.referenceRange
          ? { ...data.referenceRange, source: 'Lab Report' }
          : { min: 0, max: 0, source: 'Unknown' },
        sourceFile,
        extractionConfidence: data.confidence,
      };
    }

    return {
      name: mapping.standardName,
      value: data.value,
      unit: mapping.unit,
      date: reportDate || new Date().toISOString().split('T')[0],
      category: mapping.category,
      normalRange: data.referenceRange
        ? { ...data.referenceRange, source: 'Lab Report' }
        : mapping.normalRange,
      sourceFile,
      extractionConfidence: data.confidence,
    };
  });
}

// ============================================
// Main Parse Function
// ============================================

/**
 * Parse lab report file and extract biomarkers
 */
export async function parseLabReport(
  file: File,
  onProgress?: (progress: number) => void
): Promise<LabReportParseResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  try {
    // Update progress
    onProgress?.(10);

    // Extract text from document
    const rawText = await extractTextFromLabReport(file, (p) => {
      onProgress?.(10 + (p * 0.6)); // 10-70% for text extraction
    });

    onProgress?.(70);

    // Extract metadata
    const metadata = extractLabMetadata(rawText);

    onProgress?.(75);

    // Extract biomarker data
    const extractedData = extractBiomarkersFromText(rawText);

    onProgress?.(85);

    // Convert to Biomarker format
    const biomarkers = convertToBiomarkers(
      extractedData,
      metadata.reportDate,
      file.name
    );

    onProgress?.(95);

    // Calculate overall confidence
    const avgConfidence = biomarkers.length > 0
      ? biomarkers.reduce((sum, b) => sum + (b.extractionConfidence || 0), 0) / biomarkers.length
      : 0;

    // Add warnings
    if (biomarkers.length === 0) {
      warnings.push('No biomarkers could be extracted from this document. Please ensure it is a valid lab report.');
    }
    if (avgConfidence < 0.5) {
      warnings.push('Low confidence extraction. Results may need manual verification.');
    }
    if (!metadata.reportDate) {
      warnings.push('Report date could not be determined. Using today\'s date.');
    }

    onProgress?.(100);

    return {
      success: biomarkers.length > 0,
      biomarkers,
      rawText,
      confidence: avgConfidence,
      processingTime: Date.now() - startTime,
      warnings: warnings.length > 0 ? warnings : undefined,
      labName: metadata.labName,
      reportDate: metadata.reportDate,
      patientInfo: metadata.patientInfo,
    };

  } catch (error) {
    return {
      success: false,
      biomarkers: [],
      rawText: '',
      confidence: 0,
      processingTime: Date.now() - startTime,
      errors: [error instanceof Error ? error.message : 'Unknown error occurred'],
    };
  }
}

// Export the mappings for external use
export { LAB_TEST_MAPPINGS };
