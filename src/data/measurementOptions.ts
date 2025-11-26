import { MeasurementOption } from '../types';

export const measurementOptions: Record<string, MeasurementOption[]> = {
  'Body Composition': [
    {
      name: 'Body Fat Percentage',
      unit: '%',
      normalRange: { min: 10, max: 25, source: 'American Council on Exercise' },
      description: 'Total body fat percentage from DEXA scan or bioimpedance'
    },
    {
      name: 'Lean Mass',
      unit: 'kg',
      normalRange: { min: 45, max: 80, source: 'DEXA Standards' },
      description: 'Total lean body mass'
    },
    {
      name: 'Bone Mass',
      unit: 'kg',
      normalRange: { min: 2.5, max: 4, source: 'DEXA Standards' },
      description: 'Total bone mass from DEXA scan'
    },
    {
      name: 'BMI',
      unit: 'kg/m²',
      normalRange: { min: 18.5, max: 24.9, source: 'WHO' },
      description: 'Body Mass Index'
    }
  ],
  'Vital Signs': [
    {
      name: 'Blood Pressure (Systolic)',
      unit: 'mmHg',
      normalRange: { min: 90, max: 120, source: 'American Heart Association' },
      description: 'Upper number of blood pressure reading'
    },
    {
      name: 'Blood Pressure (Diastolic)',
      unit: 'mmHg',
      normalRange: { min: 60, max: 80, source: 'American Heart Association' },
      description: 'Lower number of blood pressure reading'
    },
    {
      name: 'Heart Rate',
      unit: 'bpm',
      normalRange: { min: 60, max: 100, source: 'Mayo Clinic' },
      description: 'Resting heart rate'
    },
    {
      name: 'Body Temperature',
      unit: '°F',
      normalRange: { min: 97.8, max: 99.1, source: 'Mayo Clinic' },
      description: 'Body temperature'
    },
    {
      name: 'Respiratory Rate',
      unit: 'breaths/min',
      normalRange: { min: 12, max: 20, source: 'Mayo Clinic' },
      description: 'Breathing rate at rest'
    }
  ],
  'Lipids': [
    {
      name: 'Total Cholesterol',
      unit: 'mg/dL',
      normalRange: { min: 125, max: 200, source: 'Mayo Clinic' },
      description: 'Total cholesterol level'
    },
    {
      name: 'HDL Cholesterol',
      unit: 'mg/dL',
      normalRange: { min: 40, max: 60, source: 'Mayo Clinic' },
      description: 'High-density lipoprotein cholesterol'
    },
    {
      name: 'LDL Cholesterol',
      unit: 'mg/dL',
      normalRange: { min: 0, max: 130, source: 'Mayo Clinic' },
      description: 'Low-density lipoprotein cholesterol'
    },
    {
      name: 'Triglycerides',
      unit: 'mg/dL',
      normalRange: { min: 0, max: 150, source: 'Mayo Clinic' },
      description: 'Blood triglyceride level'
    }
  ],
  'Kidney Function': [
    {
      name: 'Creatinine',
      unit: 'mg/dL',
      normalRange: { min: 0.7, max: 1.3, source: 'Mayo Clinic' },
      description: 'Kidney function marker'
    },
    {
      name: 'BUN',
      unit: 'mg/dL',
      normalRange: { min: 7, max: 20, source: 'Mayo Clinic' },
      description: 'Blood Urea Nitrogen'
    },
    {
      name: 'eGFR',
      unit: 'mL/min/1.73m²',
      normalRange: { min: 90, max: 120, source: 'National Kidney Foundation' },
      description: 'Estimated Glomerular Filtration Rate'
    },
    {
      name: 'Uric Acid',
      unit: 'mg/dL',
      normalRange: { min: 3.5, max: 7.2, source: 'Mayo Clinic' },
      description: 'Uric acid level'
    }
  ],
  'Liver Function': [
    {
      name: 'ALT',
      unit: 'U/L',
      normalRange: { min: 7, max: 55, source: 'Mayo Clinic' },
      description: 'Alanine aminotransferase'
    },
    {
      name: 'AST',
      unit: 'U/L',
      normalRange: { min: 8, max: 48, source: 'Mayo Clinic' },
      description: 'Aspartate aminotransferase'
    },
    {
      name: 'Alkaline Phosphatase',
      unit: 'U/L',
      normalRange: { min: 45, max: 115, source: 'Mayo Clinic' },
      description: 'ALP enzyme level'
    },
    {
      name: 'Total Bilirubin',
      unit: 'mg/dL',
      normalRange: { min: 0.1, max: 1.2, source: 'Mayo Clinic' },
      description: 'Bilirubin level'
    },
    {
      name: 'Albumin',
      unit: 'g/dL',
      normalRange: { min: 3.4, max: 5.4, source: 'Mayo Clinic' },
      description: 'Protein produced by liver'
    }
  ],
  'Inflammation Markers': [
    {
      name: 'CRP',
      unit: 'mg/L',
      normalRange: { min: 0, max: 3, source: 'Mayo Clinic' },
      description: 'C-Reactive Protein'
    },
    {
      name: 'ESR',
      unit: 'mm/hr',
      normalRange: { min: 0, max: 22, source: 'Mayo Clinic' },
      description: 'Erythrocyte Sedimentation Rate'
    },
    {
      name: 'Ferritin',
      unit: 'ng/mL',
      normalRange: { min: 20, max: 250, source: 'Mayo Clinic' },
      description: 'Iron storage protein'
    },
    {
      name: 'Homocysteine',
      unit: 'μmol/L',
      normalRange: { min: 4, max: 15, source: 'Mayo Clinic' },
      description: 'Amino acid level'
    }
  ],
  'Electrolytes': [
    {
      name: 'Sodium',
      unit: 'mEq/L',
      normalRange: { min: 135, max: 145, source: 'Mayo Clinic' },
      description: 'Sodium level'
    },
    {
      name: 'Potassium',
      unit: 'mEq/L',
      normalRange: { min: 3.5, max: 5.0, source: 'Mayo Clinic' },
      description: 'Potassium level'
    },
    {
      name: 'Chloride',
      unit: 'mEq/L',
      normalRange: { min: 96, max: 106, source: 'Mayo Clinic' },
      description: 'Chloride level'
    },
    {
      name: 'Calcium',
      unit: 'mg/dL',
      normalRange: { min: 8.5, max: 10.5, source: 'Mayo Clinic' },
      description: 'Calcium level'
    },
    {
      name: 'Magnesium',
      unit: 'mg/dL',
      normalRange: { min: 1.7, max: 2.2, source: 'Mayo Clinic' },
      description: 'Magnesium level'
    },
    {
      name: 'Phosphate',
      unit: 'mg/dL',
      normalRange: { min: 2.5, max: 4.5, source: 'Mayo Clinic' },
      description: 'Phosphate level'
    }
  ],
  'Blood': [
    {
      name: 'Glucose (Fasting)',
      unit: 'mg/dL',
      normalRange: { min: 70, max: 100, source: 'Mayo Clinic' },
      description: 'Fasting blood glucose level'
    },
    {
      name: 'Hemoglobin',
      unit: 'g/dL',
      normalRange: { min: 13.5, max: 17.5, source: 'Mayo Clinic' },
      description: 'Hemoglobin level'
    },
    {
      name: 'Hematocrit',
      unit: '%',
      normalRange: { min: 38.8, max: 50, source: 'Mayo Clinic' },
      description: 'Percentage of red blood cells'
    },
    {
      name: 'Platelets',
      unit: 'K/μL',
      normalRange: { min: 150, max: 450, source: 'Mayo Clinic' },
      description: 'Platelet count'
    },
    {
      name: 'White Blood Cells',
      unit: 'K/μL',
      normalRange: { min: 3.5, max: 10.5, source: 'Mayo Clinic' },
      description: 'White blood cell count'
    }
  ],
  'Hormones': [
    {
      name: 'Testosterone (Total)',
      unit: 'ng/dL',
      normalRange: { min: 300, max: 1000, source: 'Mayo Clinic' },
      description: 'Total testosterone level'
    },
    {
      name: 'Cortisol (Morning)',
      unit: 'μg/dL',
      normalRange: { min: 10, max: 20, source: 'Mayo Clinic' },
      description: 'Morning cortisol level'
    },
    {
      name: 'TSH',
      unit: 'mIU/L',
      normalRange: { min: 0.4, max: 4.0, source: 'Mayo Clinic' },
      description: 'Thyroid Stimulating Hormone'
    },
    {
      name: 'Free T4',
      unit: 'ng/dL',
      normalRange: { min: 0.7, max: 1.9, source: 'Mayo Clinic' },
      description: 'Free Thyroxine'
    }
  ],
  'Vitamins': [
    {
      name: 'Vitamin D',
      unit: 'ng/mL',
      normalRange: { min: 30, max: 100, source: 'Mayo Clinic' },
      description: '25-hydroxy vitamin D level'
    },
    {
      name: 'Vitamin B12',
      unit: 'pg/mL',
      normalRange: { min: 200, max: 900, source: 'Mayo Clinic' },
      description: 'Vitamin B12 (Cobalamin) level'
    },
    {
      name: 'Folate',
      unit: 'ng/mL',
      normalRange: { min: 2, max: 20, source: 'Mayo Clinic' },
      description: 'Serum folate level'
    },
    {
      name: 'Iron',
      unit: 'μg/dL',
      normalRange: { min: 60, max: 170, source: 'Mayo Clinic' },
      description: 'Serum iron level'
    }
  ],
  'Calcium CT': [
    {
      name: 'Total Calcium Score',
      unit: 'AU',
      normalRange: { min: 0, max: 100, source: 'Mayo Clinic' },
      description: 'Agatston score from coronary calcium CT scan'
    },
    {
      name: 'LAD Score',
      unit: 'AU',
      normalRange: { min: 0, max: 50, source: 'Mayo Clinic' },
      description: 'Left Anterior Descending artery calcium score'
    },
    {
      name: 'LCX Score',
      unit: 'AU',
      normalRange: { min: 0, max: 50, source: 'Mayo Clinic' },
      description: 'Left Circumflex artery calcium score'
    },
    {
      name: 'RCA Score',
      unit: 'AU',
      normalRange: { min: 0, max: 50, source: 'Mayo Clinic' },
      description: 'Right Coronary Artery calcium score'
    }
  ],
  'EKG': [
    {
      name: 'QT Interval',
      unit: 'ms',
      normalRange: { min: 350, max: 440, source: 'Mayo Clinic' },
      description: 'Time between Q wave and T wave'
    },
    {
      name: 'PR Interval',
      unit: 'ms',
      normalRange: { min: 120, max: 200, source: 'Mayo Clinic' },
      description: 'Time between P wave and QRS complex'
    },
    {
      name: 'QRS Duration',
      unit: 'ms',
      normalRange: { min: 60, max: 100, source: 'Mayo Clinic' },
      description: 'Duration of the QRS complex'
    },
    {
      name: 'RR Interval',
      unit: 'ms',
      normalRange: { min: 1200, max: 1600, source: 'Mayo Clinic' },
      description: 'Time between consecutive R waves'
    },
    {
      name: 'ST Segment',
      unit: 'mm',
      normalRange: { min: -0.5, max: 0.5, source: 'Mayo Clinic' },
      description: 'ST segment elevation or depression'
    },
    {
      name: 'T Wave Amplitude',
      unit: 'mV',
      normalRange: { min: 0.1, max: 1.0, source: 'Mayo Clinic' },
      description: 'Height of the T wave'
    }
  ]
};

export const normalRangeSources = [
  'Mayo Clinic',
  'Quest Diagnostics',
  'LabCorp',
  'WHO',
  'DEXA Standards',
  'American Council on Exercise',
  'American Heart Association',
  'National Kidney Foundation',
  'Custom'
];