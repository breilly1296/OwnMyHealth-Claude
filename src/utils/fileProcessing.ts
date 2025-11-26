import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';
import type { ExtractedData, ProcessingResult, Biomarker } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Biomarker patterns for different file types
const BIOMARKER_PATTERNS = {
  DEXA: {
    'Bone Mineral Density': /bone\s+mineral\s+density[:\s]+([0-9.]+)\s*(g\/cm²|g\/cm2)/gi,
    'T-Score': /t-score[:\s]+(-?[0-9.]+)/gi,
    'Z-Score': /z-score[:\s]+(-?[0-9.]+)/gi,
    'Body Fat Percentage': /body\s+fat[:\s]+([0-9.]+)\s*%/gi,
    'Lean Mass': /lean\s+mass[:\s]+([0-9.]+)\s*(kg|lbs)/gi,
    'Bone Mass': /bone\s+mass[:\s]+([0-9.]+)\s*(kg|lbs)/gi,
    'Visceral Fat': /visceral\s+fat[:\s]+([0-9.]+)\s*(cm²|cm2)/gi
  },
  EKG: {
    'Heart Rate': /heart\s+rate[:\s]+([0-9]+)\s*(bpm|beats)/gi,
    'QT Interval': /qt\s+interval[:\s]+([0-9]+)\s*ms/gi,
    'PR Interval': /pr\s+interval[:\s]+([0-9]+)\s*ms/gi,
    'QRS Duration': /qrs\s+duration[:\s]+([0-9]+)\s*ms/gi,
    'RR Interval': /rr\s+interval[:\s]+([0-9]+)\s*ms/gi
  },
  '23andMe': {
    'APOE': /apoe[:\s]+([a-z0-9\/]+)/gi,
    'MTHFR': /mthfr[:\s]+([a-z0-9\/]+)/gi,
    'COMT': /comt[:\s]+([a-z0-9\/]+)/gi
  },
  LabReport: {
    'Glucose': /glucose[:\s]+([0-9.]+)\s*(mg\/dl|mmol\/l)/gi,
    'Cholesterol': /cholesterol[:\s]+([0-9.]+)\s*(mg\/dl|mmol\/l)/gi,
    'HDL': /hdl[:\s]+([0-9.]+)\s*(mg\/dl|mmol\/l)/gi,
    'LDL': /ldl[:\s]+([0-9.]+)\s*(mg\/dl|mmol\/l)/gi,
    'Triglycerides': /triglycerides[:\s]+([0-9.]+)\s*(mg\/dl|mmol\/l)/gi,
    'Hemoglobin': /hemoglobin[:\s]+([0-9.]+)\s*(g\/dl|g\/l)/gi,
    'Hematocrit': /hematocrit[:\s]+([0-9.]+)\s*%/gi,
    'White Blood Cells': /wbc|white\s+blood\s+cells[:\s]+([0-9.]+)\s*(k\/ul|10\^3\/ul)/gi,
    'Platelets': /platelets[:\s]+([0-9.]+)\s*(k\/ul|10\^3\/ul)/gi,
    'Creatinine': /creatinine[:\s]+([0-9.]+)\s*(mg\/dl|umol\/l)/gi,
    'BUN': /bun|urea[:\s]+([0-9.]+)\s*(mg\/dl|mmol\/l)/gi,
    'ALT': /alt|alanine[:\s]+([0-9.]+)\s*(u\/l|iu\/l)/gi,
    'AST': /ast|aspartate[:\s]+([0-9.]+)\s*(u\/l|iu\/l)/gi,
    'TSH': /tsh[:\s]+([0-9.]+)\s*(miu\/l|mu\/l)/gi,
    'Vitamin D': /vitamin\s+d[:\s]+([0-9.]+)\s*(ng\/ml|nmol\/l)/gi,
    'Vitamin B12': /vitamin\s+b12|b12[:\s]+([0-9.]+)\s*(pg\/ml|pmol\/l)/gi,
    'Testosterone': /testosterone[:\s]+([0-9.]+)\s*(ng\/dl|nmol\/l)/gi,
    'Cortisol': /cortisol[:\s]+([0-9.]+)\s*(ug\/dl|nmol\/l)/gi
  }
};

const NORMAL_RANGES = {
  'Bone Mineral Density': { min: 1.0, max: 1.4, unit: 'g/cm²', source: 'WHO' },
  'T-Score': { min: -1.0, max: 1.0, unit: '', source: 'WHO' },
  'Z-Score': { min: -2.0, max: 2.0, unit: '', source: 'WHO' },
  'Body Fat Percentage': { min: 10, max: 25, unit: '%', source: 'ACE' },
  'Lean Mass': { min: 45, max: 80, unit: 'kg', source: 'DEXA Standards' },
  'Bone Mass': { min: 2.5, max: 4.0, unit: 'kg', source: 'DEXA Standards' },
  'Visceral Fat': { min: 0, max: 100, unit: 'cm²', source: 'DEXA Standards' },
  'Heart Rate': { min: 60, max: 100, unit: 'bpm', source: 'Mayo Clinic' },
  'QT Interval': { min: 350, max: 440, unit: 'ms', source: 'Mayo Clinic' },
  'PR Interval': { min: 120, max: 200, unit: 'ms', source: 'Mayo Clinic' },
  'QRS Duration': { min: 60, max: 100, unit: 'ms', source: 'Mayo Clinic' },
  'RR Interval': { min: 600, max: 1000, unit: 'ms', source: 'Mayo Clinic' },
  'Glucose': { min: 70, max: 100, unit: 'mg/dL', source: 'Mayo Clinic' },
  'Cholesterol': { min: 125, max: 200, unit: 'mg/dL', source: 'Mayo Clinic' },
  'HDL': { min: 40, max: 60, unit: 'mg/dL', source: 'Mayo Clinic' },
  'LDL': { min: 0, max: 130, unit: 'mg/dL', source: 'Mayo Clinic' },
  'Triglycerides': { min: 0, max: 150, unit: 'mg/dL', source: 'Mayo Clinic' },
  'Hemoglobin': { min: 13.5, max: 17.5, unit: 'g/dL', source: 'Mayo Clinic' },
  'Hematocrit': { min: 38.8, max: 50, unit: '%', source: 'Mayo Clinic' },
  'White Blood Cells': { min: 3.5, max: 10.5, unit: 'K/μL', source: 'Mayo Clinic' },
  'Platelets': { min: 150, max: 450, unit: 'K/μL', source: 'Mayo Clinic' },
  'Creatinine': { min: 0.7, max: 1.3, unit: 'mg/dL', source: 'Mayo Clinic' },
  'BUN': { min: 7, max: 20, unit: 'mg/dL', source: 'Mayo Clinic' },
  'ALT': { min: 7, max: 55, unit: 'U/L', source: 'Mayo Clinic' },
  'AST': { min: 8, max: 48, unit: 'U/L', source: 'Mayo Clinic' },
  'TSH': { min: 0.4, max: 4.0, unit: 'mIU/L', source: 'Mayo Clinic' },
  'Vitamin D': { min: 30, max: 100, unit: 'ng/mL', source: 'Mayo Clinic' },
  'Vitamin B12': { min: 200, max: 900, unit: 'pg/mL', source: 'Mayo Clinic' },
  'Testosterone': { min: 300, max: 1000, unit: 'ng/dL', source: 'Mayo Clinic' },
  'Cortisol': { min: 10, max: 20, unit: 'μg/dL', source: 'Mayo Clinic' }
};

const CATEGORY_MAPPING = {
  'Bone Mineral Density': 'Body Composition',
  'T-Score': 'Body Composition',
  'Z-Score': 'Body Composition',
  'Body Fat Percentage': 'Body Composition',
  'Lean Mass': 'Body Composition',
  'Bone Mass': 'Body Composition',
  'Visceral Fat': 'Body Composition',
  'Heart Rate': 'Vital Signs',
  'QT Interval': 'EKG',
  'PR Interval': 'EKG',
  'QRS Duration': 'EKG',
  'RR Interval': 'EKG',
  'Glucose': 'Blood',
  'Cholesterol': 'Lipids',
  'HDL': 'Lipids',
  'LDL': 'Lipids',
  'Triglycerides': 'Lipids',
  'Hemoglobin': 'Blood',
  'Hematocrit': 'Blood',
  'White Blood Cells': 'Blood',
  'Platelets': 'Blood',
  'Creatinine': 'Kidney Function',
  'BUN': 'Kidney Function',
  'ALT': 'Liver Function',
  'AST': 'Liver Function',
  'TSH': 'Hormones',
  'Vitamin D': 'Vitamins',
  'Vitamin B12': 'Vitamins',
  'Testosterone': 'Hormones',
  'Cortisol': 'Hormones'
};

export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

export async function performOCR(file: File): Promise<string> {
  const worker = await createWorker('eng');
  
  try {
    const { data: { text } } = await worker.recognize(file);
    return text;
  } finally {
    await worker.terminate();
  }
}

export function detectFileType(fileName: string, text: string): string {
  const lowerName = fileName.toLowerCase();
  const lowerText = text.toLowerCase();

  if (lowerName.includes('dexa') || lowerText.includes('bone mineral density') || lowerText.includes('t-score')) {
    return 'DEXA';
  }
  if (lowerName.includes('ekg') || lowerName.includes('ecg') || lowerText.includes('qt interval') || lowerText.includes('electrocardiogram')) {
    return 'EKG';
  }
  if (lowerName.includes('23andme') || lowerText.includes('23andme') || lowerText.includes('genetic')) {
    return '23andMe';
  }
  if (lowerText.includes('glucose') || lowerText.includes('cholesterol') || lowerText.includes('hemoglobin')) {
    return 'Lab Report';
  }
  
  return 'Other';
}

export function extractBiomarkers(text: string, fileType: string): ExtractedData[] {
  const patterns = BIOMARKER_PATTERNS[fileType as keyof typeof BIOMARKER_PATTERNS] || BIOMARKER_PATTERNS.LabReport;
  const extractedData: ExtractedData[] = [];

  Object.entries(patterns).forEach(([biomarkerName, pattern]) => {
    const matches = [...text.matchAll(pattern)];
    
    matches.forEach(match => {
      const value = parseFloat(match[1]);
      const unit = match[2] || '';
      
      if (!isNaN(value)) {
        const normalRange = NORMAL_RANGES[biomarkerName as keyof typeof NORMAL_RANGES];
        const category = CATEGORY_MAPPING[biomarkerName as keyof typeof CATEGORY_MAPPING] || 'Other';
        
        extractedData.push({
          biomarkerName,
          value,
          unit: unit || (normalRange?.unit || ''),
          confidence: calculateConfidence(match[0], biomarkerName),
          rawText: match[0],
          category,
          normalRange: normalRange ? {
            min: normalRange.min,
            max: normalRange.max,
            source: normalRange.source
          } : undefined
        });
      }
    });
  });

  return extractedData;
}

function calculateConfidence(matchText: string, biomarkerName: string): number {
  let confidence = 0.7; // Base confidence
  
  // Increase confidence if the match contains the exact biomarker name
  if (matchText.toLowerCase().includes(biomarkerName.toLowerCase())) {
    confidence += 0.2;
  }
  
  // Increase confidence if there are clear numerical patterns
  if (/\d+\.?\d*\s*(mg\/dl|g\/dl|%|bpm|ms)/i.test(matchText)) {
    confidence += 0.1;
  }
  
  return Math.min(confidence, 1.0);
}

export async function processClinicalFile(file: File): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    let text = '';
    
    // Extract text based on file type
    if (file.type === 'application/pdf') {
      text = await extractTextFromPDF(file);
    } else if (file.type.startsWith('image/')) {
      text = await performOCR(file);
    } else {
      throw new Error('Unsupported file type');
    }

    // Detect file type
    const fileType = detectFileType(file.name, text);
    
    // Extract biomarkers
    const extractedData = extractBiomarkers(text, fileType);
    
    // Convert to biomarker format
    const extractedBiomarkers: Partial<Biomarker>[] = extractedData.map(data => ({
      id: crypto.randomUUID(),
      name: data.biomarkerName,
      value: data.value,
      unit: data.unit,
      date: new Date().toISOString().split('T')[0],
      category: data.category as Biomarker['category'],
      normalRange: data.normalRange || { min: 0, max: 100, source: 'Unknown' },
      description: `Extracted from ${fileType} file: ${file.name}`,
      sourceFile: file.name,
      extractionConfidence: data.confidence,
      history: []
    }));

    const processingTime = Date.now() - startTime;
    const averageConfidence = extractedData.length > 0 
      ? extractedData.reduce((sum, item) => sum + item.confidence, 0) / extractedData.length 
      : 0;

    return {
      success: true,
      extractedBiomarkers,
      processingTime,
      confidence: averageConfidence
    };
    
  } catch (error) {
    return {
      success: false,
      extractedBiomarkers: [],
      errors: [error instanceof Error ? error.message : 'Unknown error occurred'],
      processingTime: Date.now() - startTime,
      confidence: 0
    };
  }
}