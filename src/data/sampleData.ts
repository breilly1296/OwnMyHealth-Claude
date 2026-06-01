import type { Biomarker, BiomarkerCategory, NavGroup } from '../types';

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

// Navigation groups for sidebar organization
export const navGroups: NavGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'LayoutDashboard', collapsible: false },
  { id: 'care', label: 'Care Team', icon: 'Users', collapsible: true },
  { id: 'admin', label: 'Admin', icon: 'ShieldCheck', collapsible: true },
  { id: 'files', label: 'My Reports', icon: 'FolderOpen', collapsible: false },
  { id: 'insurance', label: 'Insurance & Coverage', icon: 'Shield', collapsible: true },
  { id: 'biomarkers', label: 'Biomarkers', icon: 'Activity', collapsible: true },
];

// Dashboard categories configuration
export const categories: BiomarkerCategory[] = [
  // Overview - Always visible
  { name: 'Dashboard', description: 'Track your biomarkers and health data', icon: 'BarChart3', group: 'overview' },
  { name: 'Health Guide', description: 'Ask anything about your health data', icon: 'Sparkles', group: 'overview' },
  { name: 'Trends', description: 'View biomarker trends over time', icon: 'TrendingUp', group: 'overview' },
  { name: 'Goals', description: 'Set and track personalized health goals', icon: 'Target', group: 'overview' },
  { name: 'Needs', description: 'Conditions, follow-ups, and recommended services', icon: 'ActivitySquare', group: 'overview' },

  // Care Team - consent-gated provider collaboration
  { name: 'Care Team', description: 'Manage who can access your health data', icon: 'Users', group: 'care' },
  { name: 'My Patients', description: 'Patients who have shared data with you', icon: 'Stethoscope', group: 'care', roles: ['PROVIDER', 'ADMIN'] },

  // My Reports - File repository
  { name: 'Files', description: 'View and manage uploaded lab reports', icon: 'FileText', group: 'files' },

  // Insurance & Coverage
  { name: 'Insurance', description: 'Manage plans, track costs, and learn', icon: 'Shield', group: 'insurance' },
  { name: 'Knowledge Base', description: 'Intelligent insurance plan analysis and comparison', icon: 'Database', group: 'insurance' },

  // Biomarkers - Existing categories
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

  // Biomarkers - Specialized panels
  { name: 'Thyroid', description: 'Thyroid function and hormone levels', icon: 'Waves', group: 'biomarkers' },
  { name: 'Diabetes', description: 'Blood sugar and diabetes markers', icon: 'Candy', group: 'biomarkers' },
  { name: 'Cardiac', description: 'Heart health and cardiac markers', icon: 'Heart', group: 'biomarkers' },
  { name: 'Iron Studies', description: 'Iron levels and related markers', icon: 'CircleDot', group: 'biomarkers' },
  { name: 'Bone Health', description: 'Bone density and metabolism markers', icon: 'Bone', group: 'biomarkers' },
  { name: 'Coagulation', description: 'Blood clotting and coagulation factors', icon: 'Timer', group: 'biomarkers' },
  { name: 'Autoimmune', description: 'Autoimmune markers and antibodies', icon: 'ShieldAlert', group: 'biomarkers' },

  // Biomarkers - Diagnostic categories
  { name: 'Tumor Markers', description: 'Cancer screening and monitoring markers', icon: 'Target', group: 'biomarkers' },
  { name: 'Pancreatic', description: 'Pancreatic enzyme and function tests', icon: 'Cherry', group: 'biomarkers' },
  { name: 'Urinalysis', description: 'Urine analysis and kidney screening', icon: 'TestTube', group: 'biomarkers' },
  { name: 'Infectious Disease', description: 'Viral, bacterial, and pathogen testing', icon: 'Bug', group: 'biomarkers' },
  { name: 'Blood Gas', description: 'Arterial blood gas and acid-base balance', icon: 'Wind', group: 'biomarkers' },
  { name: 'Allergy', description: 'Allergy and immunoglobulin testing', icon: 'Flower2', group: 'biomarkers' },
  { name: 'Genetic', description: 'Genetic markers and mutations', icon: 'Dna', group: 'biomarkers' },
];
