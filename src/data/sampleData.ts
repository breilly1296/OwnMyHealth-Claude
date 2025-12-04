import type { Biomarker, BiomarkerCategory, NavGroup } from '../types';
import type { DNAVariant, DNAFileInfo } from '../types/dna';

// Sample biomarker data for each category with history for trend analysis
export const initialBiomarkers: Biomarker[] = [
  // Body Composition
  {
    id: crypto.randomUUID(),
    name: 'Body Fat Percentage',
    value: 18,
    unit: '%',
    date: new Date().toISOString().split('T')[0],
    category: 'Body Composition',
    normalRange: { min: 10, max: 25, source: 'American Council on Exercise' },
    description: 'Total body fat percentage from DEXA scan',
    history: [
      { date: '2024-01-15', value: 20 },
      { date: '2024-02-15', value: 19.5 },
      { date: '2024-03-15', value: 18.8 }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: 'Lean Mass',
    value: 65,
    unit: 'kg',
    date: new Date().toISOString().split('T')[0],
    category: 'Body Composition',
    normalRange: { min: 45, max: 80, source: 'DEXA Standards' },
    description: 'Total lean body mass',
    history: [
      { date: '2024-01-15', value: 63 },
      { date: '2024-02-15', value: 64 },
      { date: '2024-03-15', value: 64.5 }
    ]
  },
  // Blood - High glucose for risk demonstration
  {
    id: crypto.randomUUID(),
    name: 'Glucose (Fasting)',
    value: 115, // Prediabetic range
    unit: 'mg/dL',
    date: new Date().toISOString().split('T')[0],
    category: 'Blood',
    normalRange: { min: 70, max: 100, source: 'Mayo Clinic' },
    description: 'Fasting blood glucose level',
    history: [
      { date: '2024-01-15', value: 95 },
      { date: '2024-02-15', value: 105 },
      { date: '2024-03-15', value: 110 }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: 'Hemoglobin',
    value: 15.5,
    unit: 'g/dL',
    date: new Date().toISOString().split('T')[0],
    category: 'Blood',
    normalRange: { min: 13.5, max: 17.5, source: 'Mayo Clinic' },
    description: 'Hemoglobin level',
    history: [
      { date: '2024-01-15', value: 15.2 },
      { date: '2024-02-15', value: 15.3 },
      { date: '2024-03-15', value: 15.4 }
    ]
  },
  // Hormones - High testosterone for PCOS demonstration
  {
    id: crypto.randomUUID(),
    name: 'Testosterone (Total)',
    value: 85, // High for women, suggesting PCOS
    unit: 'ng/dL',
    date: new Date().toISOString().split('T')[0],
    category: 'Hormones',
    normalRange: { min: 15, max: 70, source: 'Mayo Clinic' },
    description: 'Total testosterone level',
    history: [
      { date: '2024-01-15', value: 75 },
      { date: '2024-02-15', value: 80 },
      { date: '2024-03-15', value: 82 }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: 'TSH',
    value: 2.5,
    unit: 'mIU/L',
    date: new Date().toISOString().split('T')[0],
    category: 'Hormones',
    normalRange: { min: 0.4, max: 4.0, source: 'Mayo Clinic' },
    description: 'Thyroid Stimulating Hormone',
    history: [
      { date: '2024-01-15', value: 2.8 },
      { date: '2024-02-15', value: 2.7 },
      { date: '2024-03-15', value: 2.6 }
    ]
  },
  // Vitamins - Low Vitamin D for risk demonstration
  {
    id: crypto.randomUUID(),
    name: 'Vitamin D',
    value: 25, // Insufficient range
    unit: 'ng/mL',
    date: new Date().toISOString().split('T')[0],
    category: 'Vitamins',
    normalRange: { min: 30, max: 100, source: 'Mayo Clinic' },
    description: '25-hydroxy vitamin D level',
    history: [
      { date: '2024-01-15', value: 22 },
      { date: '2024-02-15', value: 23 },
      { date: '2024-03-15', value: 24 }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: 'Vitamin B12',
    value: 550,
    unit: 'pg/mL',
    date: new Date().toISOString().split('T')[0],
    category: 'Vitamins',
    normalRange: { min: 200, max: 900, source: 'Mayo Clinic' },
    description: 'Vitamin B12 (Cobalamin) level',
    history: [
      { date: '2024-01-15', value: 520 },
      { date: '2024-02-15', value: 535 },
      { date: '2024-03-15', value: 545 }
    ]
  },
  // Vital Signs - High blood pressure for risk demonstration
  {
    id: crypto.randomUUID(),
    name: 'Blood Pressure (Systolic)',
    value: 145, // Stage 2 hypertension
    unit: 'mmHg',
    date: new Date().toISOString().split('T')[0],
    category: 'Vital Signs',
    normalRange: { min: 90, max: 120, source: 'American Heart Association' },
    description: 'Upper number of blood pressure reading',
    history: [
      { date: '2024-01-15', value: 135 },
      { date: '2024-02-15', value: 140 },
      { date: '2024-03-15', value: 142 }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: 'Heart Rate',
    value: 68,
    unit: 'bpm',
    date: new Date().toISOString().split('T')[0],
    category: 'Vital Signs',
    normalRange: { min: 60, max: 100, source: 'Mayo Clinic' },
    description: 'Resting heart rate',
    history: [
      { date: '2024-01-15', value: 70 },
      { date: '2024-02-15', value: 69 },
      { date: '2024-03-15', value: 68.5 }
    ]
  },
  // Lipids - High cholesterol for risk demonstration
  {
    id: crypto.randomUUID(),
    name: 'Total Cholesterol',
    value: 245, // High range
    unit: 'mg/dL',
    date: new Date().toISOString().split('T')[0],
    category: 'Lipids',
    normalRange: { min: 125, max: 200, source: 'Mayo Clinic' },
    description: 'Total cholesterol level',
    history: [
      { date: '2024-01-15', value: 220 },
      { date: '2024-02-15', value: 235 },
      { date: '2024-03-15', value: 240 }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: 'HDL Cholesterol',
    value: 35, // Low range
    unit: 'mg/dL',
    date: new Date().toISOString().split('T')[0],
    category: 'Lipids',
    normalRange: { min: 40, max: 60, source: 'Mayo Clinic' },
    description: 'High-density lipoprotein cholesterol',
    history: [
      { date: '2024-01-15', value: 38 },
      { date: '2024-02-15', value: 37 },
      { date: '2024-03-15', value: 36 }
    ]
  },
  // Inflammation - High CRP for risk demonstration
  {
    id: crypto.randomUUID(),
    name: 'CRP',
    value: 4.5, // High inflammation
    unit: 'mg/L',
    date: new Date().toISOString().split('T')[0],
    category: 'Inflammation Markers',
    normalRange: { min: 0, max: 3, source: 'Mayo Clinic' },
    description: 'C-Reactive Protein',
    history: [
      { date: '2024-01-15', value: 3.2 },
      { date: '2024-02-15', value: 3.8 },
      { date: '2024-03-15', value: 4.2 }
    ]
  }
];

// Sample DNA data for demonstration
export const sampleDNAVariants: DNAVariant[] = [
  {
    id: crypto.randomUUID(),
    rsid: 'rs429358',
    chromosome: '19',
    position: 45411941,
    genotype: 'CT',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.98
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs7412',
    chromosome: '19',
    position: 45412079,
    genotype: 'CC',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.99
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs1801133',
    chromosome: '1',
    position: 11856378,
    genotype: 'CT',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.97
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs4680',
    chromosome: '22',
    position: 19951271,
    genotype: 'AG',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.98
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs1800497',
    chromosome: '11',
    position: 113270828,
    genotype: 'AG',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.96
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs53576',
    chromosome: '3',
    position: 8762685,
    genotype: 'AA',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.97
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs6265',
    chromosome: '11',
    position: 27679916,
    genotype: 'CT',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.98
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs1800955',
    chromosome: '11',
    position: 113346252,
    genotype: 'CT',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.95
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs4633',
    chromosome: '22',
    position: 19950235,
    genotype: 'CT',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.99
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs1801131',
    chromosome: '1',
    position: 11854476,
    genotype: 'AC',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.97
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs1544410',
    chromosome: '12',
    position: 48239835,
    genotype: 'AG',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.98
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs2282679',
    chromosome: '4',
    position: 72618334,
    genotype: 'AC',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.96
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs4149056',
    chromosome: '12',
    position: 21331549,
    genotype: 'TC',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.97
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs9939609',
    chromosome: '16',
    position: 53820527,
    genotype: 'AT',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.98
  },
  {
    id: crypto.randomUUID(),
    rsid: 'rs1800562',
    chromosome: '6',
    position: 26093141,
    genotype: 'GG',
    sourceFile: 'sample_data.txt',
    uploadDate: new Date().toISOString(),
    confidence: 0.99
  }
];

// Sample DNA file info
export const sampleDNAFileInfo: DNAFileInfo = {
  id: crypto.randomUUID(),
  fileName: 'sample_dna_data.txt',
  fileSize: 15482367,
  source: '23andMe',
  uploadDate: new Date().toISOString(),
  processingStatus: 'completed',
  totalVariants: 635287,
  validVariants: 630145,
  errors: [],
  warnings: ['Some variants could not be validated against reference genome']
};

// Navigation groups for sidebar organization
export const navGroups: NavGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'LayoutDashboard', collapsible: false },
  { id: 'insights', label: 'Health Insights', icon: 'Sparkles', collapsible: true },
  { id: 'insurance', label: 'Insurance & Coverage', icon: 'Shield', collapsible: true },
  { id: 'biomarkers', label: 'Biomarkers', icon: 'Activity', collapsible: true },
];

// Dashboard categories configuration
export const categories: BiomarkerCategory[] = [
  // Overview - Always visible
  { name: 'Dashboard', description: 'Overall health analysis and AI insights', icon: 'BarChart3', group: 'overview' },

  // Health Insights
  { name: 'Health Needs', description: 'Personalized health needs based on your data', icon: 'Heart', group: 'insights' },
  { name: 'Health Analytics', description: 'Trends, correlations, and predictive insights', icon: 'TrendingUp', group: 'insights' },
  { name: 'Genetics', description: 'DNA analysis and genetic health insights', icon: 'Dna', group: 'insights' },

  // Insurance & Coverage
  { name: 'Insurance', description: 'Manage plans, track costs, and learn', icon: 'Shield', group: 'insurance' },
  { name: 'Knowledge Base', description: 'Intelligent insurance plan analysis and comparison', icon: 'Database', group: 'insurance' },
  { name: 'Find Providers', description: 'Locate in-network doctors for your conditions', icon: 'Users', group: 'insurance' },

  // Biomarkers
  { name: 'Body Composition', description: 'Body composition measurements including body fat and lean mass', icon: 'Scale', group: 'biomarkers' },
  { name: 'Blood', description: 'Complete blood count and metabolic panel', icon: 'Droplets', group: 'biomarkers' },
  { name: 'Hormones', description: 'Hormone levels and endocrine function', icon: 'Activity', group: 'biomarkers' },
  { name: 'Vitamins', description: 'Vitamin and mineral levels', icon: 'Zap', group: 'biomarkers' },
  { name: 'Vital Signs', description: 'Basic vital measurements', icon: 'HeartPulse', group: 'biomarkers' },
  { name: 'Lipids', description: 'Cholesterol and triglyceride levels', icon: 'Droplet', group: 'biomarkers' },
  { name: 'Kidney Function', description: 'Kidney health markers', icon: 'Bean', group: 'biomarkers' },
  { name: 'Liver Function', description: 'Liver enzyme and function tests', icon: 'Pill', group: 'biomarkers' },
  { name: 'Inflammation Markers', description: 'Inflammation and immune response', icon: 'Flame', group: 'biomarkers' },
  { name: 'Electrolytes', description: 'Electrolyte balance', icon: 'Bolt', group: 'biomarkers' },
];
