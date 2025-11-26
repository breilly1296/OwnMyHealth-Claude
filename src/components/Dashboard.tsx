import React, { useState, useMemo } from 'react';
import { LineChart, Activity, Droplets, Zap, Plus, Scale, Dumbbell, X, AlertCircle, Download, FileUp, CheckCircle, XCircle, Heart, Thermometer, Droplet, LucideKey as Kidney, Clover as Liver, Flame, Zap as ZapIcon, Upload, Brain, FileText, BarChart3, Shield, BookOpen, Users, Database, Dna, Pill } from 'lucide-react';
import { Biomarker, BiomarkerCategory, InsurancePlan } from '../types';
import BiomarkerGraph from './BiomarkerGraph';
import BiomarkerSummary from './BiomarkerSummary';
import AIInsightsPanel from './AIInsightsPanel';
import PlainEnglishSummary from './PlainEnglishSummary';
import HealthNeedsPanel from './HealthNeedsPanel';
import InsuranceSBCUpload from './InsuranceSBCUpload';
import InsurancePlanViewer from './InsurancePlanViewer';
import InsuranceEducationPanel from './InsuranceEducationPanel';
import ProviderDirectoryPanel from './ProviderDirectoryPanel';
import EnhancedInsuranceUpload from './EnhancedInsuranceUpload';
import InsuranceKnowledgePanel from './InsuranceKnowledgePanel';
import InsuranceUtilizationTracker from './InsuranceUtilizationTracker';
import { exportToCSV, exportToPDF } from '../utils/export';
import { performAIAnalysis } from '../utils/aiEngine';
import { analyzeHealthNeeds } from '../utils/healthNeedsAnalyzer';
import { generatePersonalizedInsuranceGuide } from '../utils/insuranceEducation';
import PDFUploadModal from './PDFUploadModal';
import ClinicalFileUpload from './ClinicalFileUpload';
import TrendModal from './TrendModal';
import AddMeasurementModal from './AddMeasurementModal';
import { measurementOptions } from '../data/measurementOptions';
import BiomarkerActionPlan from './BiomarkerActionPlan';
import BiomarkerInsurancePanel from './BiomarkerInsurancePanel';
import BiomarkerDNAExplanation from './BiomarkerDNAExplanation';
import DNAUploadModal from './DNAUploadModal';
import DNAAnalysisPanel from './DNAAnalysisPanel';
import type { DNAVariant, DNAFileInfo } from '../types/dna';

// Sample data for each category with history for trend analysis
const initialBiomarkers: Biomarker[] = [
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
const sampleDNAVariants: DNAVariant[] = [
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
const sampleDNAFileInfo: DNAFileInfo = {
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

const categories: BiomarkerCategory[] = [
  { name: 'Dashboard', description: 'Overall health analysis and AI insights', icon: 'BarChart3' },
  { name: 'Health Needs', description: 'Personalized health needs based on your data', icon: 'Heart' },
  { name: 'Insurance', description: 'Insurance plan benefits and coverage details', icon: 'Shield' },
  { name: 'Insurance Guide', description: 'Learn insurance terms with your personal examples', icon: 'BookOpen' },
  { name: 'Knowledge Base', description: 'Intelligent insurance plan analysis and comparison', icon: 'Database' },
  { name: 'Find Providers', description: 'Locate in-network doctors for your conditions', icon: 'Users' },
  { name: 'Genetics', description: 'DNA analysis and genetic health insights', icon: 'Dna' },
  { name: 'Body Composition', description: 'Body composition measurements including body fat and lean mass', icon: 'Scale' },
  { name: 'Blood', description: 'Complete blood count and metabolic panel', icon: 'Droplets' },
  { name: 'Hormones', description: 'Hormone levels and endocrine function', icon: 'Activity' },
  { name: 'Vitamins', description: 'Vitamin and mineral levels', icon: 'Zap' },
  { name: 'Vital Signs', description: 'Basic vital measurements', icon: 'Heart' },
  { name: 'Lipids', description: 'Cholesterol and triglyceride levels', icon: 'Droplet' },
  { name: 'Kidney Function', description: 'Kidney health markers', icon: 'Kidney' },
  { name: 'Liver Function', description: 'Liver enzyme and function tests', icon: 'Liver' },
  { name: 'Inflammation Markers', description: 'Inflammation and immune response', icon: 'Flame' },
  { name: 'Electrolytes', description: 'Electrolyte balance', icon: 'ZapIcon' },
];

function getIcon(iconName: string) {
  const icons: Record<string, JSX.Element> = {
    BarChart3: <BarChart3 className="w-5 h-5" />,
    Heart: <Heart className="w-5 h-5" />,
    Shield: <Shield className="w-5 h-5" />,
    BookOpen: <BookOpen className="w-5 h-5" />,
    Database: <Database className="w-5 h-5" />,
    Users: <Users className="w-5 h-5" />,
    Scale: <Scale className="w-5 h-5" />,
    Droplets: <Droplets className="w-5 h-5" />,
    Activity: <Activity className="w-5 h-5" />,
    Zap: <Zap className="w-5 h-5" />,
    Droplet: <Droplet className="w-5 h-5" />,
    Kidney: <Kidney className="w-5 h-5" />,
    Liver: <Liver className="w-5 h-5" />,
    Flame: <Flame className="w-5 h-5" />,
    ZapIcon: <ZapIcon className="w-5 h-5" />,
    Dna: <Dna className="w-5 h-5" />,
  };
  return icons[iconName] || <Activity className="w-5 h-5" />;
}

function CategoryTab({ category, icon, isActive, onClick }: { 
  category: string; 
  icon: JSX.Element; 
  isActive: boolean; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center space-x-2 px-4 py-3 w-full transition-colors duration-200 ${
        isActive 
          ? 'bg-blue-100 text-blue-700 font-medium border-r-4 border-blue-700' 
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span>{category}</span>
    </button>
  );
}

function ExportButton({ biomarkers }: { biomarkers: Biomarker[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors duration-200"
      >
        <Download className="w-4 h-4 mr-2" />
        Export
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10">
          <button
            onClick={() => {
              exportToCSV(biomarkers);
              setIsOpen(false);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Export as CSV
          </button>
          <button
            onClick={() => {
              exportToPDF(biomarkers);
              setIsOpen(false);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Export as PDF
          </button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [selectedCategory, setSelectedCategory] = useState('Dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);
  const [isClinicalUploadOpen, setIsClinicalUploadOpen] = useState(false);
  const [isTrendModalOpen, setIsTrendModalOpen] = useState(false);
  const [isPlainEnglishOpen, setIsPlainEnglishOpen] = useState(false);
  const [isSBCUploadOpen, setIsSBCUploadOpen] = useState(false);
  const [isEnhancedUploadOpen, setIsEnhancedUploadOpen] = useState(false);
  const [isInsuranceViewerOpen, setIsInsuranceViewerOpen] = useState(false);
  const [isKnowledgeBaseOpen, setIsKnowledgeBaseOpen] = useState(false);
  const [isDNAUploadOpen, setIsDNAUploadOpen] = useState(false);
  const [selectedBiomarker, setSelectedBiomarker] = useState<Biomarker | null>(null);
  const [trendBiomarker, setTrendBiomarker] = useState<Biomarker | null>(null);
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>(initialBiomarkers);
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([]);
  const [selectedBiomarkerForInsurance, setSelectedBiomarkerForInsurance] = useState<Biomarker | null>(null);
  const [selectedBiomarkerForDNA, setSelectedBiomarkerForDNA] = useState<Biomarker | null>(null);
  const [dnaVariants, setDnaVariants] = useState<DNAVariant[]>(sampleDNAVariants);
  const [dnaFileInfo, setDnaFileInfo] = useState<DNAFileInfo | null>(sampleDNAFileInfo);

  const filteredBiomarkers = useMemo(() => {
    if (['Dashboard', 'Health Needs', 'Insurance', 'Insurance Guide', 'Knowledge Base', 'Find Providers', 'Genetics'].includes(selectedCategory)) return biomarkers;
    return biomarkers.filter(b => b.category === selectedCategory);
  }, [biomarkers, selectedCategory]);

  const aiAnalysis = useMemo(() => {
    return performAIAnalysis(biomarkers);
  }, [biomarkers]);

  const healthNeedsAnalysis = useMemo(() => {
    return analyzeHealthNeeds(biomarkers, aiAnalysis.riskAssessments, insurancePlans);
  }, [biomarkers, aiAnalysis.riskAssessments, insurancePlans]);

  const insuranceGuide = useMemo(() => {
    return generatePersonalizedInsuranceGuide(biomarkers, insurancePlans, healthNeedsAnalysis);
  }, [biomarkers, insurancePlans, healthNeedsAnalysis]);

  const handleAddMeasurement = (measurement: Partial<Biomarker>) => {
    const newBiomarker: Biomarker = {
      ...measurement,
      id: measurement.id || crypto.randomUUID(),
      history: [],
    } as Biomarker;

    setBiomarkers(prev => [...prev, newBiomarker]);
  };

  const handlePDFExtract = (extractedBiomarkers: Partial<Biomarker>[]) => {
    const newBiomarkers = extractedBiomarkers.map(b => ({
      ...b,
      id: crypto.randomUUID(),
      history: [],
    })) as Biomarker[];

    setBiomarkers(prev => [...prev, ...newBiomarkers]);
  };

  const handleClinicalFileExtract = (extractedBiomarkers: Partial<Biomarker>[]) => {
    const newBiomarkers = extractedBiomarkers.map(b => ({
      ...b,
      id: b.id || crypto.randomUUID(),
      history: [],
    })) as Biomarker[];

    setBiomarkers(prev => [...prev, ...newBiomarkers]);
  };

  const handleInsurancePlanExtracted = (plan: InsurancePlan) => {
    setInsurancePlans(prev => [...prev, plan]);
  };

  const handleTrendClick = (biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setTrendBiomarker(biomarker);
    setIsTrendModalOpen(true);
  };

  const handleDNAVariantsExtracted = (variants: DNAVariant[], fileInfo: DNAFileInfo) => {
    setDnaVariants(variants);
    setDnaFileInfo(fileInfo);
  };

  const handleInsuranceClick = (biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBiomarkerForInsurance(biomarker);
  };

  const handleDNAClick = (biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBiomarkerForDNA(biomarker);
  };

  const getValueStatus = (biomarker: Biomarker) => {
    const isLow = biomarker.value < biomarker.normalRange.min;
    const isHigh = biomarker.value > biomarker.normalRange.max;
    const isOutOfRange = isLow || isHigh;

    return {
      isOutOfRange,
      message: isLow
        ? `Value is below normal range (${biomarker.normalRange.min} ${biomarker.unit})`
        : isHigh
        ? `Value is above normal range (${biomarker.normalRange.max} ${biomarker.unit})`
        : 'Value is within normal range'
    };
  };

  // Check if biomarker has matching genetic variant
  const hasDNAMatch = (biomarker: Biomarker) => {
    if (dnaVariants.length === 0) return false;
    
    // Map of biomarkers to relevant SNPs
    const biomarkerSNPs: Record<string, string[]> = {
      'Glucose (Fasting)': ['rs7903146', 'rs1801282'], // TCF7L2, PPARG
      'Total Cholesterol': ['rs429358', 'rs4149056'], // APOE, SLCO1B1
      'LDL Cholesterol': ['rs429358'], // APOE
      'HDL Cholesterol': ['rs1800588'], // LIPC
      'Vitamin D': ['rs2282679', 'rs1544410'], // GC, VDR
      'CRP': ['rs1205', 'rs1800795'], // CRP, IL6
      'Homocysteine': ['rs1801133'] // MTHFR
    };
    
    const relevantSNPs = biomarkerSNPs[biomarker.name] || [];
    if (relevantSNPs.length === 0) return false;
    
    // Check if any relevant SNPs are in the user's DNA data
    return dnaVariants.some(variant => 
      relevantSNPs.includes(variant.rsid.toLowerCase()) || 
      relevantSNPs.includes(variant.rsid.toUpperCase())
    );
  };

  const renderDashboardContent = () => {
    return (
      <div className="space-y-8">
        {/* Insurance Utilization Tracker */}
        {insurancePlans.length > 0 && (
          <InsuranceUtilizationTracker 
            biomarkers={biomarkers} 
            insurancePlans={insurancePlans} 
          />
        )}

        {/* AI Insights Panel */}
        <AIInsightsPanel analysis={aiAnalysis} biomarkers={biomarkers} />

        {/* Overall Health Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-lg border-l-4 border-blue-500">
            <div className="flex items-center">
              <BarChart3 className="w-8 h-8 text-blue-500 mr-3" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Total Biomarkers</h3>
                <p className="text-3xl font-bold text-blue-600">{biomarkers.length}</p>
                <p className="text-sm text-gray-600">Tracked measurements</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-lg border-l-4 border-green-500">
            <div className="flex items-center">
              <CheckCircle className="w-8 h-8 text-green-500 mr-3" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">In Range</h3>
                <p className="text-3xl font-bold text-green-600">
                  {biomarkers.filter(b => b.value >= b.normalRange.min && b.value <= b.normalRange.max).length}
                </p>
                <p className="text-sm text-gray-600">Normal results</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-lg border-l-4 border-red-500">
            <div className="flex items-center">
              <AlertCircle className="w-8 h-8 text-red-500 mr-3" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Out of Range</h3>
                <p className="text-3xl font-bold text-red-600">
                  {biomarkers.filter(b => b.value < b.normalRange.min || b.value > b.normalRange.max).length}
                </p>
                <p className="text-sm text-gray-600">Need attention</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-lg border-l-4 border-purple-500">
            <div className="flex items-center">
              <Brain className="w-8 h-8 text-purple-500 mr-3" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Health Score</h3>
                <p className="text-3xl font-bold text-purple-600">{Math.round(aiAnalysis.overallHealthScore)}</p>
                <p className="text-sm text-gray-600">AI assessment</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Plans for Out-of-Range Biomarkers */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Recommended Action Plans</h3>
          {biomarkers
            .filter(b => b.value < b.normalRange.min || b.value > b.normalRange.max)
            .map(biomarker => (
              <BiomarkerActionPlan 
                key={biomarker.id} 
                biomarker={biomarker} 
                insurancePlans={insurancePlans} 
              />
            ))}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Measurements</h3>
          <div className="space-y-3">
            {biomarkers
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .slice(0, 5)
              .map((biomarker) => {
                const status = getValueStatus(biomarker);
                return (
                  <div key={biomarker.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center">
                      <div className={`w-3 h-3 rounded-full mr-3 ${
                        status.isOutOfRange ? 'bg-red-500' : 'bg-green-500'
                      }`} />
                      <div>
                        <p className="font-medium text-gray-900">{biomarker.name}</p>
                        <p className="text-sm text-gray-600">{biomarker.category}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{biomarker.value} {biomarker.unit}</p>
                      <p className="text-sm text-gray-600">{new Date(biomarker.date).toLocaleDateString()}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    );
  };

  const renderHealthNeedsContent = () => {
    return (
      <div className="space-y-6">
        <HealthNeedsPanel analysis={healthNeedsAnalysis} insurancePlans={insurancePlans} />
      </div>
    );
  };

  const renderInsuranceContent = () => {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Insurance Plans</h2>
            <p className="text-sm text-gray-500">
              Manage your insurance plan benefits and coverage details
            </p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => setIsKnowledgeBaseOpen(true)}
              className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors duration-200"
            >
              <Database className="w-4 h-4 mr-2" />
              Knowledge Base
            </button>
            <button
              onClick={() => setIsInsuranceViewerOpen(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
            >
              <Shield className="w-4 h-4 mr-2" />
              View Plans ({insurancePlans.length})
            </button>
            <button
              onClick={() => setIsEnhancedUploadOpen(true)}
              className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors duration-200"
            >
              <Brain className="w-4 h-4 mr-2" />
              Smart Upload
            </button>
            <button
              onClick={() => setIsSBCUploadOpen(true)}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload SBC
            </button>
          </div>
        </div>

        {/* Insurance Utilization Tracker */}
        {insurancePlans.length > 0 && (
          <InsuranceUtilizationTracker 
            biomarkers={biomarkers} 
            insurancePlans={insurancePlans} 
          />
        )}

        {insurancePlans.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <Shield className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Insurance Plans</h3>
            <p className="text-gray-600 mb-4">Upload your insurance documents to get started with intelligent parsing.</p>
            <div className="flex justify-center space-x-3">
              <button
                onClick={() => setIsEnhancedUploadOpen(true)}
                className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors duration-200"
              >
                <Brain className="w-4 h-4 mr-2" />
                Smart Upload (Recommended)
              </button>
              <button
                onClick={() => setIsSBCUploadOpen(true)}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
              >
                <Upload className="w-4 h-4 mr-2" />
                Basic Upload
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {insurancePlans.map((plan) => (
              <div key={plan.id} className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{plan.planName}</h3>
                    <p className="text-gray-600">{plan.insurerName}</p>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mt-2">
                      {plan.planType}
                    </span>
                  </div>
                  <button
                    onClick={() => setIsInsuranceViewerOpen(true)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <FileText className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Benefits:</span>
                    <span className="font-medium">{plan.benefits.length} covered services</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Costs:</span>
                    <span className="font-medium">{plan.costs.length} cost categories</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Effective Date:</span>
                    <span className="font-medium">{new Date(plan.effectiveDate).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Extraction Confidence:</span>
                    <span className="font-medium">{Math.round(plan.extractionConfidence * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderInsuranceGuideContent = () => {
    return (
      <div className="space-y-6">
        <InsuranceEducationPanel guide={insuranceGuide} />
      </div>
    );
  };

  const renderKnowledgeBaseContent = () => {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center mb-4">
            <Database className="w-6 h-6 text-purple-600 mr-3" />
            <h2 className="text-xl font-semibold text-gray-900">Insurance Knowledge Base</h2>
          </div>
          <p className="text-gray-600 mb-6">
            Access intelligent analysis, comparison, and insights from your normalized insurance data.
          </p>
          <button
            onClick={() => setIsKnowledgeBaseOpen(true)}
            className="px-6 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors duration-200 flex items-center"
          >
            <Database className="w-5 h-5 mr-2" />
            Open Knowledge Base
          </button>
        </div>
      </div>
    );
  };

  const renderProviderDirectoryContent = () => {
    return (
      <div className="space-y-6">
        <ProviderDirectoryPanel 
          healthNeeds={healthNeedsAnalysis} 
          insurancePlans={insurancePlans}
          biomarkers={biomarkers}
        />
      </div>
    );
  };

  const renderGeneticsContent = () => {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Genetic Analysis</h2>
            <p className="text-sm text-gray-500">
              Analyze your DNA data for health insights and personalized recommendations
            </p>
          </div>
          <button
            onClick={() => setIsDNAUploadOpen(true)}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload DNA Data
          </button>
        </div>

        {dnaVariants.length > 0 && dnaFileInfo ? (
          <DNAAnalysisPanel 
            variants={dnaVariants} 
            fileInfo={dnaFileInfo} 
            insurancePlans={insurancePlans}
          />
        ) : (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <Dna className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Genetic Data</h3>
            <p className="text-gray-600 mb-4">Upload your raw DNA data from services like 23andMe or AncestryDNA to get started.</p>
            <button
              onClick={() => setIsDNAUploadOpen(true)}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload DNA Data
            </button>
          </div>
        )}

        {/* Genetic Risk Summary */}
        {dnaVariants.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Dna className="w-5 h-5 text-purple-600 mr-2" />
              Genetic Risk Summary
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <div className="flex items-center">
                  <AlertCircle className="w-6 h-6 text-red-600 mr-2" />
                  <div>
                    <p className="text-sm text-red-600">High Risk Variants</p>
                    <p className="text-2xl font-bold text-red-700">3</p>
                    <p className="text-xs text-red-500">Require attention</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                <div className="flex items-center">
                  <AlertCircle className="w-6 h-6 text-orange-600 mr-2" />
                  <div>
                    <p className="text-sm text-orange-600">Moderate Risk Variants</p>
                    <p className="text-2xl font-bold text-orange-700">5</p>
                    <p className="text-xs text-orange-500">Worth monitoring</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <div className="flex items-center">
                  <CheckCircle className="w-6 h-6 text-green-600 mr-2" />
                  <div>
                    <p className="text-sm text-green-600">Protective Variants</p>
                    <p className="text-2xl font-bold text-green-700">4</p>
                    <p className="text-xs text-green-500">Beneficial factors</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-center">
                  <Dna className="w-6 h-6 text-blue-600 mr-2" />
                  <div>
                    <p className="text-sm text-blue-600">Total Analyzed</p>
                    <p className="text-2xl font-bold text-blue-700">{dnaVariants.length}</p>
                    <p className="text-xs text-blue-500">From {dnaFileInfo.source}</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Key Genetic Findings */}
            <div className="mb-6">
              <h4 className="font-medium text-gray-900 mb-3">Key Genetic Findings</h4>
              <div className="space-y-3">
                <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                  <div className="flex items-start">
                    <div className="p-2 rounded-full bg-red-100 text-red-600 mr-3 mt-1">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-medium text-gray-900">APOE E3/E4 Genotype (rs429358)</h5>
                      <p className="text-sm text-gray-700 mt-1">
                        Associated with a moderately increased risk for Alzheimer's disease (about 3x higher than average) and may affect cholesterol levels.
                      </p>
                      <div className="mt-2 flex items-center text-sm text-red-700">
                        <Shield className="w-4 h-4 mr-1" />
                        Recommendation: Regular cognitive assessments and cardiovascular monitoring
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="border border-orange-200 bg-orange-50 rounded-lg p-4">
                  <div className="flex items-start">
                    <div className="p-2 rounded-full bg-orange-100 text-orange-600 mr-3 mt-1">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-medium text-gray-900">MTHFR C677T Heterozygous Variant (rs1801133)</h5>
                      <p className="text-sm text-gray-700 mt-1">
                        Your MTHFR CT genotype results in approximately 30% reduced enzyme activity, which may slightly affect your body's ability to process folate and regulate homocysteine levels.
                      </p>
                      <div className="mt-2 flex items-center text-sm text-orange-700">
                        <Shield className="w-4 h-4 mr-1" />
                        Recommendation: Consider methylfolate supplements and homocysteine testing
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="border border-orange-200 bg-orange-50 rounded-lg p-4">
                  <div className="flex items-start">
                    <div className="p-2 rounded-full bg-orange-100 text-orange-600 mr-3 mt-1">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-medium text-gray-900">SLCO1B1 Intermediate Function (rs4149056)</h5>
                      <p className="text-sm text-gray-700 mt-1">
                        Your SLCO1B1 genotype indicates you have a moderately increased risk (approximately 4.5x higher) of developing muscle pain and damage (myopathy) when taking certain statin medications.
                      </p>
                      <div className="mt-2 flex items-center text-sm text-orange-700">
                        <Shield className="w-4 h-4 mr-1" />
                        Recommendation: Medication review if statins are prescribed
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Genetic Health Categories */}
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Genetic Health Categories</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center mb-3">
                    <div className="p-2 rounded-full bg-red-100 text-red-600 mr-3">
                      <Heart className="w-5 h-5" />
                    </div>
                    <h5 className="font-medium text-gray-900">Cardiovascular Health</h5>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Risk Level:</span>
                    <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">MODERATE</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2">
                    Your genetic profile shows several variants that may affect cholesterol metabolism and cardiovascular health.
                  </p>
                </div>
                
                <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center mb-3">
                    <div className="p-2 rounded-full bg-purple-100 text-purple-600 mr-3">
                      <Brain className="w-5 h-5" />
                    </div>
                    <h5 className="font-medium text-gray-900">Cognitive Function</h5>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Risk Level:</span>
                    <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">ELEVATED</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2">
                    Your APOE E3/E4 genotype is associated with increased risk for cognitive decline with age.
                  </p>
                </div>
                
                <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center mb-3">
                    <div className="p-2 rounded-full bg-green-100 text-green-600 mr-3">
                      <Activity className="w-5 h-5" />
                    </div>
                    <h5 className="font-medium text-gray-900">Metabolism</h5>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Risk Level:</span>
                    <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">MODERATE</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2">
                    Your genetic variants affect folate metabolism and vitamin D processing, which may impact overall metabolic health.
                  </p>
                </div>
                
                <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center mb-3">
                    <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3">
                      <Pill className="w-5 h-5" />
                    </div>
                    <h5 className="font-medium text-gray-900">Drug Response</h5>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Risk Level:</span>
                    <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">HIGH</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2">
                    Your genetic profile indicates altered response to several medication classes, including statins and certain antidepressants.
                  </p>
                </div>
                
                <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center mb-3">
                    <div className="p-2 rounded-full bg-yellow-100 text-yellow-600 mr-3">
                      <Zap className="w-5 h-5" />
                    </div>
                    <h5 className="font-medium text-gray-900">Nutrient Processing</h5>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Risk Level:</span>
                    <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">MODERATE</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2">
                    Your genetic variants affect how your body processes certain nutrients, particularly B vitamins and vitamin D.
                  </p>
                </div>
                
                <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center mb-3">
                    <div className="p-2 rounded-full bg-indigo-100 text-indigo-600 mr-3">
                      <Dna className="w-5 h-5" />
                    </div>
                    <h5 className="font-medium text-gray-900">Carrier Status</h5>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Risk Level:</span>
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">LOW</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2">
                    Your genetic profile shows carrier status for certain recessive conditions, but with low clinical significance.
                  </p>
                </div>
              </div>
            </div>
            
            {/* Personalized Genetic Recommendations */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h4 className="font-medium text-blue-900 mb-4">Personalized Genetic Recommendations</h4>
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3 mt-1">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-medium text-blue-900">Comprehensive Genetic Health Report</h5>
                    <p className="text-sm text-blue-800 mt-1">
                      Your genetic profile suggests several areas that would benefit from specialized testing and monitoring. We recommend a comprehensive genetic health assessment with a healthcare provider familiar with genomic medicine.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3 mt-1">
                    <Heart className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-medium text-blue-900">Cardiovascular Risk Management</h5>
                    <p className="text-sm text-blue-800 mt-1">
                      Based on your APOE and other variants, we recommend enhanced cardiovascular monitoring, including advanced lipid testing and more frequent screenings than typically recommended for your age group.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3 mt-1">
                    <Brain className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-medium text-blue-900">Cognitive Health Plan</h5>
                    <p className="text-sm text-blue-800 mt-1">
                      Your APOE status suggests implementing a proactive cognitive health plan, including regular cognitive assessments, brain-healthy diet rich in omega-3 fatty acids, and regular physical and mental exercise.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3 mt-1">
                    <Pill className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-medium text-blue-900">Medication Response Testing</h5>
                    <p className="text-sm text-blue-800 mt-1">
                      Your CYP2C19 and SLCO1B1 variants indicate you may process certain medications differently than the general population. Consider pharmacogenetic testing before starting new medications, particularly statins, certain antidepressants, and blood thinners.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCategoryContent = () => {
    return (
      <div className="space-y-6">
        <BiomarkerSummary biomarkers={biomarkers} category={selectedCategory} />

        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {selectedCategory} Measurements
            </h2>
            <p className="text-sm text-gray-500">
              {categories.find(c => c.name === selectedCategory)?.description}
            </p>
          </div>
          <div className="flex space-x-3">
            <ExportButton biomarkers={filteredBiomarkers} />
            <button
              onClick={() => setIsClinicalUploadOpen(true)}
              className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors duration-200"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Clinical Files
            </button>
            <button
              onClick={() => setIsPDFModalOpen(true)}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200"
            >
              <FileUp className="w-4 h-4 mr-2" />
              Upload Lab Report
            </button>
            <button 
              onClick={() => setIsModalOpen(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Measurement
            </button>
          </div>
        </div>

        {/* Action Plans for Out-of-Range Biomarkers */}
        {filteredBiomarkers.some(b => b.value < b.normalRange.min || b.value > b.normalRange.max) && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Recommended Action Plans</h3>
            {filteredBiomarkers
              .filter(b => b.value < b.normalRange.min || b.value > b.normalRange.max)
              .map(biomarker => (
                <BiomarkerActionPlan 
                  key={biomarker.id} 
                  biomarker={biomarker} 
                  insurancePlans={insurancePlans} 
                />
              ))}
          </div>
        )}

        {selectedBiomarker && (
          <div className="mb-8">
            <BiomarkerGraph biomarker={selectedBiomarker} />
          </div>
        )}
        
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Measurement
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Value
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Normal Range
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredBiomarkers.map((biomarker) => {
                  const status = getValueStatus(biomarker);
                  const hasGeneticMatch = hasDNAMatch(biomarker);
                  
                  return (
                    <tr 
                      key={biomarker.id} 
                      className="hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
                      onClick={() => setSelectedBiomarker(biomarker === selectedBiomarker ? null : biomarker)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        <div className="flex items-center">
                          {biomarker.name}
                          {biomarker.sourceFile && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                              Auto-extracted
                            </span>
                          )}
                          {hasGeneticMatch && (
                            <span 
                              className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 cursor-pointer"
                              onClick={(e) => handleDNAClick(biomarker, e)}
                            >
                              <Dna className="w-3 h-3 mr-1" />
                              DNA
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="flex items-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            status.isOutOfRange
                              ? 'bg-red-100 text-red-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {biomarker.value} {biomarker.unit}
                          </span>
                          {status.isOutOfRange && (
                            <div className="relative group ml-2">
                              <AlertCircle className="w-4 h-4 text-red-500" />
                              <div className="absolute left-0 top-6 transform -translate-x-1/2 bg-red-100 text-red-800 p-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-normal w-48 text-xs z-10">
                                {status.message}
                              </div>
                            </div>
                          )}
                          {biomarker.extractionConfidence && (
                            <span className="ml-2 text-xs text-gray-400">
                              {Math.round(biomarker.extractionConfidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {biomarker.normalRange.min} - {biomarker.normalRange.max} {biomarker.unit}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(biomarker.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {biomarker.description}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="flex space-x-2">
                          <button 
                            className="text-blue-600 hover:text-blue-800"
                            onClick={(e) => handleTrendClick(biomarker, e)}
                          >
                            <LineChart className="w-5 h-5" />
                          </button>
                          {status.isOutOfRange && insurancePlans.length > 0 && (
                            <button 
                              className="text-green-600 hover:text-green-800"
                              onClick={(e) => handleInsuranceClick(biomarker, e)}
                            >
                              <Shield className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center">
              <Dumbbell className="w-8 h-8 text-blue-600" />
              <span className="ml-2 text-xl font-semibold">OwnMyHealth</span>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setIsPlainEnglishOpen(true)}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200"
              >
                <FileText className="w-4 h-4 mr-2" />
                Plain English Summary
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-[1600px] mx-auto flex">
        {/* Left Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 min-h-screen">
          <div className="p-4">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">
              Categories
            </h3>
            <div className="space-y-1">
              {categories.map((category) => (
                <CategoryTab
                  key={category.name}
                  category={category.name}
                  icon={getIcon(category.icon)}
                  isActive={selectedCategory === category.name}
                  onClick={() => setSelectedCategory(category.name)}
                />
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-8">
          {selectedCategory === 'Dashboard' ? renderDashboardContent() : 
           selectedCategory === 'Health Needs' ? renderHealthNeedsContent() :
           selectedCategory === 'Insurance' ? renderInsuranceContent() : 
           selectedCategory === 'Insurance Guide' ? renderInsuranceGuideContent() :
           selectedCategory === 'Knowledge Base' ? renderKnowledgeBaseContent() :
           selectedCategory === 'Find Providers' ? renderProviderDirectoryContent() :
           selectedCategory === 'Genetics' ? renderGeneticsContent() :
           renderCategoryContent()}
        </main>
      </div>

      <AddMeasurementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        category={selectedCategory}
        onAdd={handleAddMeasurement}
      />

      <PDFUploadModal
        isOpen={isPDFModalOpen}
        onClose={() => setIsPDFModalOpen(false)}
        onExtract={handlePDFExtract}
      />

      <ClinicalFileUpload
        isOpen={isClinicalUploadOpen}
        onClose={() => setIsClinicalUploadOpen(false)}
        onExtract={handleClinicalFileExtract}
      />

      <InsuranceSBCUpload
        isOpen={isSBCUploadOpen}
        onClose={() => setIsSBCUploadOpen(false)}
        onPlanExtracted={handleInsurancePlanExtracted}
      />

      <EnhancedInsuranceUpload
        isOpen={isEnhancedUploadOpen}
        onClose={() => setIsEnhancedUploadOpen(false)}
        onPlanExtracted={handleInsurancePlanExtracted}
      />

      <InsurancePlanViewer
        plans={insurancePlans}
        isOpen={isInsuranceViewerOpen}
        onClose={() => setIsInsuranceViewerOpen(false)}
      />

      <InsuranceKnowledgePanel
        plans={insurancePlans}
        isOpen={isKnowledgeBaseOpen}
        onClose={() => setIsKnowledgeBaseOpen(false)}
      />

      <PlainEnglishSummary
        biomarkers={biomarkers}
        riskAssessments={aiAnalysis.riskAssessments}
        isOpen={isPlainEnglishOpen}
        onClose={() => setIsPlainEnglishOpen(false)}
      />

      <DNAUploadModal
        isOpen={isDNAUploadOpen}
        onClose={() => setIsDNAUploadOpen(false)}
        onVariantsExtracted={handleDNAVariantsExtracted}
      />

      {trendBiomarker && (
        <TrendModal
          isOpen={isTrendModalOpen}
          onClose={() => {
            setIsTrendModalOpen(false);
            setTrendBiomarker(null);
          }}
          biomarker={trendBiomarker}
        />
      )}

      {selectedBiomarkerForInsurance && (
        <BiomarkerInsurancePanel
          biomarker={selectedBiomarkerForInsurance}
          insurancePlans={insurancePlans}
          onClose={() => setSelectedBiomarkerForInsurance(null)}
        />
      )}

      {selectedBiomarkerForDNA && dnaVariants.length > 0 && (
        <BiomarkerDNAExplanation
          biomarker={selectedBiomarkerForDNA}
          dnaVariants={dnaVariants}
          isOpen={!!selectedBiomarkerForDNA}
          onClose={() => setSelectedBiomarkerForDNA(null)}
        />
      )}
    </div>
  );
}