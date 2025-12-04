/**
 * Dashboard Component
 *
 * The main application interface for OwnMyHealth. This component serves as the central hub
 * where users can:
 * - View their health score and biomarker overview
 * - Navigate between different health categories (Blood Work, Vitamins, etc.)
 * - Upload lab reports (PDF) or manually enter biomarker data
 * - View AI-powered health insights and recommendations
 * - Access insurance information and genetic analysis
 * - Manage their account and logout
 *
 * Data Flow:
 * - In production: Fetches data from backend API with authentication
 * - In demo mode: Uses sample data for development/testing
 *
 * @module components/dashboard/Dashboard
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { LineChart, Activity, Zap, Plus, AlertCircle, FileUp, Heart, Upload, Brain, FileText, Shield, Dna, Loader2, LogOut, User, ChevronDown } from 'lucide-react';
import type { Biomarker, InsurancePlan } from '../../types';
import type { DNAVariant, DNAFileInfo } from '../../types/dna';
// Biomarker components
import { BiomarkerGraph, BiomarkerSummary, TrendModal, AddMeasurementModal, BiomarkerActionPlan, BiomarkerInsurancePanel, BiomarkerDNAExplanation } from '../biomarkers';
// Health components
import { HealthReportSummary, HealthNeedsPanel, ProviderDirectoryPanel } from '../health';
// Insurance components
import { InsuranceSBCUpload, InsurancePlanViewer, EnhancedInsuranceUpload, InsurancePlanCompare, InsuranceHub, InsuranceKnowledgeBase } from '../insurance';
// Upload components
import { PDFUploadModal, ClinicalFileUpload } from '../upload';
// DNA components
import { DNAUploadModal, DNAAnalysisPanel } from '../dna';
// Analytics components
import { HealthAnalyticsDashboard } from '../analytics';
// Dashboard components
import { CollapsibleNavGroup } from './index';
// Utils
import { performAIAnalysis } from '../../utils/ai';
import { analyzeHealthNeeds } from '../../utils/health';
import { generatePersonalizedInsuranceGuide } from '../../utils/insurance';
// Data (for demo mode / fallback)
import { initialBiomarkers, sampleDNAVariants, sampleDNAFileInfo, categories, navGroups } from '../../data/sampleData';
// API services
import { biomarkersApi, insuranceApi, dnaApi } from '../../services/api';
// Logger
import { dashboardLogger } from '../../utils/logger';

// Demo mode flag - only enabled in development when explicitly set
const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true';

interface DashboardProps {
  user?: { id: string; email: string; role: string } | null;
  onLogout?: () => Promise<void>;
}

/**
 * Dashboard - Main application component that serves as the central hub for the OwnMyHealth app.
 *
 * This component now fetches data from the backend API instead of storing PHI in local state.
 * In demo mode, it falls back to sample data for development purposes.
 */
export default function Dashboard({ user, onLogout }: DashboardProps) {
  // ============================================
  // UI State (kept in React state - not PHI)
  // ============================================
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
  const [selectedBiomarkerForInsurance, setSelectedBiomarkerForInsurance] = useState<Biomarker | null>(null);
  const [selectedBiomarkerForDNA, setSelectedBiomarkerForDNA] = useState<Biomarker | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  // ============================================
  // Data State (fetched from API, cleared when not needed)
  // ============================================
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([]);
  const [dnaVariants, setDnaVariants] = useState<DNAVariant[]>([]);
  const [dnaFileInfo, setDnaFileInfo] = useState<DNAFileInfo | null>(null);

  // Loading states
  const [isLoadingBiomarkers, setIsLoadingBiomarkers] = useState(true);
  const [isLoadingDNA, setIsLoadingDNA] = useState(false);

  // Error state for user feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  // Helper to show error toast
  const showErrorToast = useCallback((message: string) => {
    dashboardLogger.error(message);
    setErrorMessage(message);
    setShowError(true);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setShowError(false);
      setErrorMessage(null);
    }, 5000);
  }, []);

  // ============================================
  // Data Fetching
  // ============================================

  // Fetch biomarkers on mount
  useEffect(() => {
    const fetchBiomarkers = async () => {
      setIsLoadingBiomarkers(true);

      if (DEMO_MODE) {
        // In demo mode, use sample data
        setBiomarkers(initialBiomarkers);
        setIsLoadingBiomarkers(false);
        return;
      }

      // If no authenticated user, use sample data
      if (!user) {
        setBiomarkers(initialBiomarkers);
        setIsLoadingBiomarkers(false);
        return;
      }

      try {
        const result = await biomarkersApi.getAll();
        setBiomarkers(result.biomarkers as unknown as Biomarker[]);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to load biomarkers';
        dashboardLogger.error('Error fetching biomarkers', { error: errorMsg });
        showErrorToast(`${errorMsg}. Using sample data for demonstration.`);
        // Fall back to sample data in case of error
        setBiomarkers(initialBiomarkers);
      } finally {
        setIsLoadingBiomarkers(false);
      }
    };

    fetchBiomarkers();

    // Cleanup: Clear PHI data on unmount
    return () => {
      setBiomarkers([]);
      setInsurancePlans([]);
      setDnaVariants([]);
      setDnaFileInfo(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrorToast]);

  // Fetch DNA data when Genetics category is selected
  useEffect(() => {
    if (selectedCategory !== 'Genetics') return;

    const fetchDNAData = async () => {
      setIsLoadingDNA(true);

      if (DEMO_MODE) {
        setDnaVariants(sampleDNAVariants);
        setDnaFileInfo(sampleDNAFileInfo);
        setIsLoadingDNA(false);
        return;
      }

      try {
        const uploads = await dnaApi.getUploads();
        if (uploads.length > 0) {
          const latestUpload = uploads[0];
          const variants = await dnaApi.getVariants(latestUpload.id);
          setDnaFileInfo(latestUpload as unknown as DNAFileInfo);
          setDnaVariants(variants.variants as unknown as DNAVariant[]);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to load DNA data';
        dashboardLogger.error('Error fetching DNA data', { error: errorMsg });
        showErrorToast(`${errorMsg}. Using sample data for demonstration.`);
        // Fall back to sample data
        setDnaVariants(sampleDNAVariants);
        setDnaFileInfo(sampleDNAFileInfo);
      } finally {
        setIsLoadingDNA(false);
      }
    };

    fetchDNAData();
   
  }, [selectedCategory, showErrorToast]);

  // ============================================
  // Computed Values (memoized, computed from fetched data)
  // ============================================

  const filteredBiomarkers = useMemo(() => {
    if (['Dashboard', 'Health Needs', 'Health Analytics', 'Insurance', 'Insurance Guide', 'Knowledge Base', 'Find Providers', 'Genetics'].includes(selectedCategory)) return biomarkers;
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

  // ============================================
  // Event Handlers
  // ============================================

  const handleAddMeasurement = useCallback(async (measurement: Partial<Biomarker>) => {
    const newBiomarker: Biomarker = {
      ...measurement,
      id: measurement.id || crypto.randomUUID(),
      history: [],
    } as Biomarker;

    if (DEMO_MODE) {
      setBiomarkers(prev => [...prev, newBiomarker]);
      return;
    }

    try {
      const created = await biomarkersApi.create({
        name: newBiomarker.name,
        value: newBiomarker.value,
        unit: newBiomarker.unit,
        date: newBiomarker.date,
        category: newBiomarker.category,
        normalRangeMin: newBiomarker.normalRange.min,
        normalRangeMax: newBiomarker.normalRange.max,
        normalRangeSource: newBiomarker.normalRange.source,
        notes: newBiomarker.notes,
      });
      setBiomarkers(prev => [...prev, created as unknown as Biomarker]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save measurement';
      dashboardLogger.error('Error adding measurement', { error: errorMsg });
      showErrorToast(`${errorMsg}. Added locally but not synced to server.`);
      // Still add locally for UX
      setBiomarkers(prev => [...prev, newBiomarker]);
    }
  }, [showErrorToast]);

  const handlePDFExtract = useCallback(async (extractedBiomarkers: Partial<Biomarker>[]) => {
    const newBiomarkers = extractedBiomarkers.map(b => ({
      ...b,
      id: crypto.randomUUID(),
      history: [],
    })) as Biomarker[];

    if (DEMO_MODE) {
      setBiomarkers(prev => [...prev, ...newBiomarkers]);
      return;
    }

    try {
      const createData = newBiomarkers.map(b => ({
        name: b.name,
        value: b.value,
        unit: b.unit,
        date: b.date,
        category: b.category,
        normalRangeMin: b.normalRange.min,
        normalRangeMax: b.normalRange.max,
        normalRangeSource: b.normalRange.source,
        sourceFile: b.sourceFile,
        extractionConfidence: b.extractionConfidence,
      }));
      const created = await biomarkersApi.createBatch(createData);
      setBiomarkers(prev => [...prev, ...created as unknown as Biomarker[]]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save extracted data';
      dashboardLogger.error('Error saving PDF extracted data', { error: errorMsg });
      showErrorToast(`${errorMsg}. Data added locally but not synced to server.`);
      setBiomarkers(prev => [...prev, ...newBiomarkers]);
    }
  }, [showErrorToast]);

  const handleClinicalFileExtract = useCallback((extractedBiomarkers: Partial<Biomarker>[]) => {
    handlePDFExtract(extractedBiomarkers);
  }, [handlePDFExtract]);

  const handleInsurancePlanExtracted = useCallback(async (plan: InsurancePlan) => {
    if (DEMO_MODE) {
      setInsurancePlans(prev => [...prev, plan]);
      return;
    }

    try {
      // Extract costs from the plan's costs array using correct field names
      const deductibleIndividual = plan.costs?.find(
        c => c.type === 'Deductible' && c.appliesTo === 'Individual'
      )?.amount || 0;
      const deductibleFamily = plan.costs?.find(
        c => c.type === 'Deductible' && c.appliesTo === 'Family'
      )?.amount || 0;
      const oopMaxIndividual = plan.costs?.find(
        c => c.type === 'Out-of-Pocket Maximum' && c.appliesTo === 'Individual'
      )?.amount || 0;
      const oopMaxFamily = plan.costs?.find(
        c => c.type === 'Out-of-Pocket Maximum' && c.appliesTo === 'Family'
      )?.amount || 0;

      const created = await insuranceApi.createPlan({
        planName: plan.planName,
        insurerName: plan.insurerName,
        planType: plan.planType,
        effectiveDate: plan.effectiveDate,
        deductibleIndividual,
        deductibleFamily,
        oopMaxIndividual,
        oopMaxFamily,
      });
      setInsurancePlans(prev => [...prev, created as unknown as InsurancePlan]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save insurance plan';
      dashboardLogger.error('Error saving insurance plan', { error: errorMsg });
      showErrorToast(`${errorMsg}. Plan added locally but not synced to server.`);
      setInsurancePlans(prev => [...prev, plan]);
    }
  }, [showErrorToast]);

  const handleTrendClick = useCallback((biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setTrendBiomarker(biomarker);
    setIsTrendModalOpen(true);
  }, []);

  const handleDNAVariantsExtracted = useCallback((variants: DNAVariant[], fileInfo: DNAFileInfo) => {
    setDnaVariants(variants);
    setDnaFileInfo(fileInfo);
  }, []);

  const handleInsuranceClick = useCallback((biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBiomarkerForInsurance(biomarker);
  }, []);

  const handleDNAClick = useCallback((biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBiomarkerForDNA(biomarker);
  }, []);

  // ============================================
  // Helper Functions
  // ============================================

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

  const hasDNAMatch = (biomarker: Biomarker) => {
    if (dnaVariants.length === 0) return false;

    const biomarkerSNPs: Record<string, string[]> = {
      'Glucose (Fasting)': ['rs7903146', 'rs1801282'],
      'Total Cholesterol': ['rs429358', 'rs4149056'],
      'LDL Cholesterol': ['rs429358'],
      'HDL Cholesterol': ['rs1800588'],
      'Vitamin D': ['rs2282679', 'rs1544410'],
      'CRP': ['rs1205', 'rs1800795'],
      'Homocysteine': ['rs1801133']
    };

    const relevantSNPs = biomarkerSNPs[biomarker.name] || [];
    if (relevantSNPs.length === 0) return false;

    return dnaVariants.some(variant =>
      relevantSNPs.includes(variant.rsid.toLowerCase()) ||
      relevantSNPs.includes(variant.rsid.toUpperCase())
    );
  };

  // ============================================
  // Loading State
  // ============================================

  if (isLoadingBiomarkers) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-4" />
          <p className="text-slate-600">Loading your health data...</p>
        </div>
      </div>
    );
  }

  // ============================================
  // Render Content Functions
  // ============================================

  const renderDashboardContent = () => {
    const inRangeCount = biomarkers.filter(b => b.value >= b.normalRange.min && b.value <= b.normalRange.max).length;
    const outOfRangeCount = biomarkers.filter(b => b.value < b.normalRange.min || b.value > b.normalRange.max).length;
    const outOfRangeBiomarkers = biomarkers.filter(b => b.value < b.normalRange.min || b.value > b.normalRange.max);
    const scoreColor = aiAnalysis.overallHealthScore >= 70 ? '#22c55e' : aiAnalysis.overallHealthScore >= 50 ? '#f59e0b' : '#ef4444';

    return (
      <div className="animate-fade-in max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <p className="text-sm font-medium text-slate-400 mb-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Your Health Overview</h1>
        </div>

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-12 gap-5">

          {/* Health Score - Large Card */}
          <div className="col-span-12 md:col-span-5 bg-white rounded-2xl border border-slate-200/60 p-8">
            <div className="flex items-center gap-6">
              <div className="relative flex-shrink-0">
                <svg className="w-28 h-28 -rotate-90">
                  <circle cx="56" cy="56" r="48" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                  <circle
                    cx="56" cy="56" r="48" fill="none"
                    stroke={scoreColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${(aiAnalysis.overallHealthScore / 100) * 302} 302`}
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-slate-900">{Math.round(aiAnalysis.overallHealthScore)}</span>
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Health Score</h2>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-wellness-500" />
                    <span className="text-sm text-slate-600">{inRangeCount} in range</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-sm text-slate-600">{outOfRangeCount} attention</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="col-span-6 md:col-span-2 bg-slate-900 rounded-2xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Tracked</span>
            <div>
              <span className="text-4xl font-bold text-white">{biomarkers.length}</span>
              <p className="text-sm text-slate-400 mt-1">biomarkers</p>
            </div>
          </div>

          <div className="col-span-6 md:col-span-2 bg-wellness-500 rounded-2xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-wellness-100 uppercase tracking-wide">Normal</span>
            <div>
              <span className="text-4xl font-bold text-white">{inRangeCount}</span>
              <p className="text-sm text-wellness-100 mt-1">in range</p>
            </div>
          </div>

          <div className="col-span-12 md:col-span-3 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-red-100 uppercase tracking-wide">Needs Review</span>
            <div className="flex items-end justify-between">
              <div>
                <span className="text-4xl font-bold text-white">{outOfRangeCount}</span>
                <p className="text-sm text-red-100 mt-1">out of range</p>
              </div>
              {outOfRangeCount > 0 && (
                <AlertCircle className="w-8 h-8 text-white/30" />
              )}
            </div>
          </div>

          {/* AI Insights */}
          <div className="col-span-12 md:col-span-7 bg-white rounded-2xl border border-slate-200/60 p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-900 mb-2">AI Health Summary</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {aiAnalysis.priorityActions.length > 0
                    ? `Based on ${biomarkers.length} biomarkers, we recommend focusing on: ${aiAnalysis.priorityActions.slice(0, 2).join(' and ').toLowerCase()}.`
                    : 'Your health metrics look good overall. Continue monitoring your biomarkers regularly.'}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions - Compact */}
          <div className="col-span-12 md:col-span-5 grid grid-cols-2 gap-3">
            <button
              onClick={() => setIsPDFModalOpen(true)}
              className="bg-white rounded-2xl border border-slate-200/60 p-4 hover:border-brand-300 hover:shadow-sm transition-all group text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center mb-3 group-hover:bg-brand-100 transition-colors">
                <FileUp className="w-4 h-4 text-brand-600" />
              </div>
              <p className="text-sm font-medium text-slate-900">Upload Report</p>
              <p className="text-xs text-slate-400 mt-0.5">PDF or image</p>
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-white rounded-2xl border border-slate-200/60 p-4 hover:border-wellness-300 hover:shadow-sm transition-all group text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-wellness-50 flex items-center justify-center mb-3 group-hover:bg-wellness-100 transition-colors">
                <Plus className="w-4 h-4 text-wellness-600" />
              </div>
              <p className="text-sm font-medium text-slate-900">Add Data</p>
              <p className="text-xs text-slate-400 mt-0.5">Manual entry</p>
            </button>
          </div>

          {/* Attention Items - Conditional */}
          {outOfRangeCount > 0 && (
            <div className="col-span-12 md:col-span-6 bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-900">Needs Attention</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {outOfRangeBiomarkers.slice(0, 3).map((biomarker) => {
                  const isLow = biomarker.value < biomarker.normalRange.min;
                  return (
                    <div key={biomarker.id} className="px-5 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isLow ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{biomarker.name}</p>
                          <p className="text-xs text-slate-400">{isLow ? 'Below' : 'Above'} range</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <p className="text-sm font-semibold text-red-600">{biomarker.value}</p>
                        <p className="text-xs text-slate-400">{biomarker.unit}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Measurements */}
          <div className={`col-span-12 ${outOfRangeCount > 0 ? 'md:col-span-6' : 'md:col-span-12'} bg-white rounded-2xl border border-slate-200/60 overflow-hidden`}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Recent Measurements</h3>
              <span className="text-xs text-slate-400">Last updated</span>
            </div>
            <div className={`${outOfRangeCount > 0 ? '' : 'grid grid-cols-1 md:grid-cols-2'} divide-y md:divide-y-0 divide-slate-100`}>
              {biomarkers
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, outOfRangeCount > 0 ? 4 : 6)
                .map((biomarker, idx) => {
                  const status = getValueStatus(biomarker);
                  return (
                    <div
                      key={biomarker.id}
                      className={`px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors ${
                        outOfRangeCount === 0 && idx % 2 === 0 ? 'md:border-r md:border-slate-100' : ''
                      } ${outOfRangeCount === 0 ? 'md:border-b md:border-slate-100' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${status.isOutOfRange ? 'bg-red-500' : 'bg-wellness-500'}`} />
                        <span className="text-sm text-slate-700">{biomarker.name}</span>
                      </div>
                      <span className={`text-sm font-medium ${status.isOutOfRange ? 'text-red-600' : 'text-slate-900'}`}>
                        {biomarker.value} {biomarker.unit}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

        </div>
      </div>
    );
  };

  const renderHealthNeedsContent = () => {
    return <HealthNeedsPanel analysis={healthNeedsAnalysis} insurancePlans={insurancePlans} />;
  };

  const renderHealthAnalyticsContent = () => {
    return <HealthAnalyticsDashboard biomarkers={biomarkers} />;
  };

  const renderInsuranceContent = () => {
    return (
      <InsuranceHub
        insurancePlans={insurancePlans}
        guide={insuranceGuide}
        onUploadSBC={() => setIsSBCUploadOpen(true)}
        onSmartUpload={() => setIsEnhancedUploadOpen(true)}
        onViewPlanDetails={() => setIsInsuranceViewerOpen(true)}
      />
    );
  };

  const renderInsuranceGuideContent = () => {
    return (
      <InsuranceHub
        insurancePlans={insurancePlans}
        guide={insuranceGuide}
        onUploadSBC={() => setIsSBCUploadOpen(true)}
        onSmartUpload={() => setIsEnhancedUploadOpen(true)}
        onViewPlanDetails={() => setIsInsuranceViewerOpen(true)}
      />
    );
  };

  const renderKnowledgeBaseContent = () => {
    return <InsuranceKnowledgeBase plans={insurancePlans} />;
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
    if (isLoadingDNA) {
      return (
        <div className="max-w-6xl mx-auto animate-fade-in">
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60">
            <Loader2 className="w-8 h-8 animate-spin text-wellness-500 mx-auto mb-4" />
            <p className="text-slate-600">Loading genetic data...</p>
          </div>
        </div>
      );
    }

    if (dnaVariants.length > 0 && dnaFileInfo) {
      return (
        <DNAAnalysisPanel
          variants={dnaVariants}
          fileInfo={dnaFileInfo}
          insurancePlans={insurancePlans}
        />
      );
    }

    return (
      <div className="max-w-6xl mx-auto animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Genetic Insights</h1>
          <p className="text-slate-500 mt-1">Upload your DNA data for personalized health insights</p>
        </div>

        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60">
          <div className="w-16 h-16 bg-wellness-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Dna className="w-8 h-8 text-wellness-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Genetic Data Yet</h3>
          <p className="text-slate-500 mb-6 max-w-md mx-auto">
            Upload your raw DNA data from 23andMe or AncestryDNA to unlock personalized genetic insights.
          </p>
          <button
            onClick={() => setIsDNAUploadOpen(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload DNA Data
          </button>
        </div>
      </div>
    );
  };

  const renderCategoryContent = () => {
    const outOfRangeBiomarkers = filteredBiomarkers.filter(b => b.value < b.normalRange.min || b.value > b.normalRange.max);
    const inRangeBiomarkers = filteredBiomarkers.filter(b => b.value >= b.normalRange.min && b.value <= b.normalRange.max);

    return (
      <div className="max-w-6xl mx-auto animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">{selectedCategory}</h1>
          <p className="text-slate-500 mt-1">
            {categories.find(c => c.name === selectedCategory)?.description}
          </p>
        </div>

        <BiomarkerSummary biomarkers={biomarkers} category={selectedCategory} />

        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Data
          </button>
          <button
            onClick={() => setIsPDFModalOpen(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <FileUp className="w-4 h-4 mr-2" />
            Upload Report
          </button>
        </div>

        {selectedBiomarker && (
          <div className="mb-8">
            <BiomarkerGraph biomarker={selectedBiomarker} />
          </div>
        )}

        <div className="space-y-6">
          {outOfRangeBiomarkers.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                Needs Attention ({outOfRangeBiomarkers.length})
              </h2>
              <div className="grid gap-3">
                {outOfRangeBiomarkers.map((biomarker) => {
                  const isLow = biomarker.value < biomarker.normalRange.min;
                  const hasGeneticMatch = hasDNAMatch(biomarker);
                  const isSelected = selectedBiomarker?.id === biomarker.id;

                  return (
                    <div
                      key={biomarker.id}
                      onClick={() => setSelectedBiomarker(isSelected ? null : biomarker)}
                      className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${
                        isSelected ? 'border-red-300 ring-2 ring-red-100' : 'border-red-200 hover:border-red-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-slate-900">{biomarker.name}</h3>
                            {biomarker.sourceFile && (
                              <span className="text-2xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">Auto</span>
                            )}
                            {hasGeneticMatch && (
                              <button
                                onClick={(e) => handleDNAClick(biomarker, e)}
                                className="text-2xs px-1.5 py-0.5 bg-wellness-50 text-wellness-600 rounded hover:bg-wellness-100"
                              >
                                DNA
                              </button>
                            )}
                          </div>
                          <p className="text-sm text-slate-500">{biomarker.description}</p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center gap-2 justify-end">
                            <span className="text-lg font-bold text-red-600">{biomarker.value}</span>
                            <span className="text-sm text-slate-400">{biomarker.unit}</span>
                          </div>
                          <p className="text-xs text-red-500 mt-0.5">
                            {isLow ? 'Below' : 'Above'} range ({biomarker.normalRange.min}-{biomarker.normalRange.max})
                          </p>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => handleTrendClick(biomarker, e)}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <LineChart className="w-4 h-4" />
                          </button>
                          {insurancePlans.length > 0 && (
                            <button
                              onClick={(e) => handleInsuranceClick(biomarker, e)}
                              className="p-2 text-slate-400 hover:text-wellness-600 hover:bg-wellness-50 rounded-lg transition-colors"
                            >
                              <Shield className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isSelected && (
                        <div className="mt-4 pt-4 border-t border-red-100">
                          <BiomarkerActionPlan biomarker={biomarker} insurancePlans={insurancePlans} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {inRangeBiomarkers.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-wellness-500" />
                In Range ({inRangeBiomarkers.length})
              </h2>
              <div className="bg-white rounded-xl border border-slate-200/60 divide-y divide-slate-100">
                {inRangeBiomarkers.map((biomarker) => {
                  const hasGeneticMatch = hasDNAMatch(biomarker);
                  const isSelected = selectedBiomarker?.id === biomarker.id;

                  return (
                    <div
                      key={biomarker.id}
                      onClick={() => setSelectedBiomarker(isSelected ? null : biomarker)}
                      className={`p-4 cursor-pointer transition-colors ${isSelected ? 'bg-wellness-50/50' : 'hover:bg-slate-50/50'}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-wellness-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-900">{biomarker.name}</span>
                              {hasGeneticMatch && (
                                <button
                                  onClick={(e) => handleDNAClick(biomarker, e)}
                                  className="text-2xs px-1.5 py-0.5 bg-wellness-50 text-wellness-600 rounded hover:bg-wellness-100"
                                >
                                  DNA
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 truncate">{biomarker.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 flex-shrink-0">
                          <div className="text-right">
                            <span className="font-semibold text-slate-900">{biomarker.value}</span>
                            <span className="text-sm text-slate-400 ml-1">{biomarker.unit}</span>
                          </div>
                          <button
                            onClick={(e) => handleTrendClick(biomarker, e)}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <LineChart className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {filteredBiomarkers.length === 0 && (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60">
              <Activity className="w-12 h-12 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No {selectedCategory} Data</h3>
              <p className="text-slate-500 mb-6">Add your first measurement to start tracking.</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Measurement
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // Main Render
  // ============================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100">
      {/* Premium Navbar */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/25">
                  <Heart className="w-5 h-5 text-white" />
                </div>
              </div>
              <div>
                <span className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                  OwnMyHealth
                </span>
                <p className="text-xs text-slate-500 -mt-0.5">Your personal health companion</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsPlainEnglishOpen(true)}
                className="inline-flex items-center px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-wellness-500 to-wellness-600 rounded-xl hover:from-wellness-600 hover:to-wellness-700 focus:outline-none focus:ring-2 focus:ring-wellness-500 focus:ring-offset-2 transition-all duration-200 shadow-lg shadow-wellness-500/25"
              >
                <FileText className="w-4 h-4 mr-2" />
                Health Summary
              </button>

              {/* User Menu */}
              {user && onLogout && (
                <div className="relative">
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center space-x-2 px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors"
                  >
                    <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center">
                      <User className="w-4 h-4 text-slate-600" />
                    </div>
                    <span className="text-sm font-medium text-slate-700 hidden sm:block max-w-[120px] truncate">
                      {user.email}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown Menu */}
                  {isUserMenuOpen && (
                    <>
                      {/* Backdrop */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsUserMenuOpen(false)}
                      />
                      {/* Menu */}
                      <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
                        <div className="px-4 py-3 border-b border-slate-100">
                          <p className="text-sm font-medium text-slate-900 truncate">{user.email}</p>
                          <p className="text-xs text-slate-500 capitalize">{user.role.toLowerCase()}</p>
                        </div>
                        <button
                          onClick={async () => {
                            setIsUserMenuOpen(false);
                            await onLogout();
                          }}
                          className="w-full flex items-center px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut className="w-4 h-4 mr-3" />
                          Sign out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-[1600px] mx-auto flex">
        {/* Premium Left Sidebar */}
        <aside className="w-72 bg-white/50 backdrop-blur-sm border-r border-slate-200/60 min-h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto">
          <div className="p-5">
            <nav className="space-y-1">
              {navGroups.map((group) => {
                const groupCategories = categories.filter(cat => cat.group === group.id);
                return (
                  <CollapsibleNavGroup
                    key={group.id}
                    group={group}
                    categories={groupCategories}
                    selectedCategory={selectedCategory}
                    onCategorySelect={(category) => {
                      setSelectedCategory(category);
                      setSelectedBiomarker(null);
                    }}
                    defaultExpanded={group.id === 'overview' || group.id === 'insights'}
                  />
                );
              })}
            </nav>

            <div className="mt-6 p-4 bg-gradient-to-br from-brand-50 to-brand-100/50 rounded-2xl border border-brand-200/50">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-semibold text-brand-900">Pro Tip</span>
              </div>
              <p className="text-xs text-brand-700 leading-relaxed">
                Upload your lab reports to automatically extract and track biomarkers over time.
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 px-8 py-8 min-h-[calc(100vh-4rem)]">
          {selectedCategory === 'Dashboard' ? renderDashboardContent() :
           selectedCategory === 'Health Needs' ? renderHealthNeedsContent() :
           selectedCategory === 'Health Analytics' ? renderHealthAnalyticsContent() :
           selectedCategory === 'Insurance' ? renderInsuranceContent() :
           selectedCategory === 'Insurance Guide' ? renderInsuranceGuideContent() :
           selectedCategory === 'Knowledge Base' ? renderKnowledgeBaseContent() :
           selectedCategory === 'Find Providers' ? renderProviderDirectoryContent() :
           selectedCategory === 'Genetics' ? renderGeneticsContent() :
           renderCategoryContent()}
        </main>
      </div>

      {/* Modals */}
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

      <InsurancePlanCompare
        plans={insurancePlans}
        isOpen={isKnowledgeBaseOpen}
        onClose={() => setIsKnowledgeBaseOpen(false)}
      />

      <HealthReportSummary
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

      {/* Error Toast Notification */}
      {showError && errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
          <div className="bg-red-50 border border-red-200 rounded-xl shadow-lg p-4 max-w-md">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
              </div>
              <button
                onClick={() => {
                  setShowError(false);
                  setErrorMessage(null);
                }}
                className="flex-shrink-0 p-1 rounded-lg hover:bg-red-100 transition-colors"
              >
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
