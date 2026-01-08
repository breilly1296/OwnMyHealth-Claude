/**
 * Dashboard Component
 *
 * The main application interface for OwnMyHealth. This component serves as the central hub
 * where users can:
 * - View their health score and biomarker overview
 * - Navigate between different health categories (Blood Work, Vitamins, etc.)
 * - Upload lab reports (PDF) or manually enter biomarker data
 * - View AI-powered health insights and recommendations
 * - Access insurance information
 * - Manage their account and logout
 *
 * Data Flow:
 * - In production: Fetches data from backend API with authentication
 * - In demo mode: Uses sample data for development/testing
 *
 * @module components/dashboard/Dashboard
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { LineChart, Activity, Zap, Plus, AlertCircle, FileUp, Heart, Shield, Loader2, LogOut, User, ChevronDown, Settings, Menu, X } from 'lucide-react';
import type { Biomarker, InsurancePlan } from '../../types';
// Biomarker components
import { BiomarkerGraph, BiomarkerSummary, TrendModal, AddMeasurementModal, BiomarkerActionPlan, BiomarkerInsurancePanel } from '../biomarkers';
// Insurance components
import { InsuranceSBCUpload, InsurancePlanViewer, EnhancedInsuranceUpload, InsurancePlanCompare, InsuranceHub, InsuranceKnowledgeBase } from '../insurance';
// Upload components
import { PDFUploadModal, ClinicalFileUpload, LabUploadModal } from '../upload';
// Files components
import FilesPage from '../files/FilesPage';
// Trends components
import { TrendsPage, BiomarkerAIGuidance } from '../trends';
// Settings components
import { AccountSettingsPage } from '../settings';
// Dashboard components
import { CollapsibleNavGroup } from './index';
// Data (for demo mode / fallback)
import { initialBiomarkers, categories, navGroups } from '../../data/sampleData';
// API services
import { biomarkersApi, insuranceApi } from '../../services/api';
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
  const [isLabUploadModalOpen, setIsLabUploadModalOpen] = useState(false);
  const [isClinicalUploadOpen, setIsClinicalUploadOpen] = useState(false);
  const [isTrendModalOpen, setIsTrendModalOpen] = useState(false);
  const [isSBCUploadOpen, setIsSBCUploadOpen] = useState(false);
  const [isEnhancedUploadOpen, setIsEnhancedUploadOpen] = useState(false);
  const [isInsuranceViewerOpen, setIsInsuranceViewerOpen] = useState(false);
  const [isKnowledgeBaseOpen, setIsKnowledgeBaseOpen] = useState(false);
  const [selectedBiomarker, setSelectedBiomarker] = useState<Biomarker | null>(null);
  const [trendBiomarker, setTrendBiomarker] = useState<Biomarker | null>(null);
  const [selectedBiomarkerForInsurance, setSelectedBiomarkerForInsurance] = useState<Biomarker | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // ============================================
  // Data State (fetched from API, cleared when not needed)
  // ============================================
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([]);

  // Loading states
  const [isLoadingBiomarkers, setIsLoadingBiomarkers] = useState(true);

  // Error state for user feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to show error toast with proper cleanup
  const showErrorToast = useCallback((message: string) => {
    dashboardLogger.error(message);
    setErrorMessage(message);
    setShowError(true);

    // Clear any existing timeout to prevent memory leaks
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }

    // Auto-hide after 5 seconds
    errorTimeoutRef.current = setTimeout(() => {
      setShowError(false);
      setErrorMessage(null);
    }, 5000);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
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
        // Fetch all biomarkers (high limit to avoid pagination issues)
        const result = await biomarkersApi.getAll({ limit: 1000 });
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
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrorToast]);

  // ============================================
  // Computed Values (memoized, computed from fetched data)
  // ============================================

  const filteredBiomarkers = useMemo(() => {
    // Defensive null check to prevent "Cannot read properties of undefined" errors
    const safeBiomarkers = biomarkers || [];
    if (['Dashboard', 'Insurance', 'Insurance Guide', 'Knowledge Base'].includes(selectedCategory)) return safeBiomarkers;
    return safeBiomarkers.filter(b => b.category === selectedCategory);
  }, [biomarkers, selectedCategory]);

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

  // Handler for server-side OCR upload success (Google Document AI)
  const handleLabOCRSuccess = useCallback((extractedBiomarkers: { id: string; name: string; value: number; unit: string; category: string; isOutOfRange: boolean }[]) => {
    // Fetch updated biomarkers from server since they were saved server-side
    const fetchUpdatedBiomarkers = async () => {
      try {
        // Fetch all biomarkers (high limit to avoid pagination issues)
        const result = await biomarkersApi.getAll({ limit: 1000 });
        setBiomarkers(result.biomarkers as unknown as Biomarker[]);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to refresh biomarkers';
        dashboardLogger.error('Error refreshing biomarkers after OCR upload', { error: errorMsg });
        // If refresh fails, at least show the returned data locally
        const newBiomarkers = extractedBiomarkers.map(b => ({
          ...b,
          date: new Date().toISOString().split('T')[0],
          description: `${b.name} measurement`,
          normalRange: { min: 0, max: 100, source: 'OCR' }, // Placeholder, actual values from server
          history: [],
        })) as Biomarker[];
        setBiomarkers(prev => [...prev, ...newBiomarkers]);
      }
    };
    fetchUpdatedBiomarkers();
  }, []);

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

  const handleInsuranceClick = useCallback((biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBiomarkerForInsurance(biomarker);
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

  // ============================================
  // Memoized Computed Values
  // ============================================

  // Memoize biomarker filtering to avoid recalculating on every render
  const { inRangeCount, outOfRangeCount, outOfRangeBiomarkers } = useMemo(() => {
    // Defensive null check to prevent "Cannot read properties of undefined" errors
    const safeBiomarkers = biomarkers || [];
    const outOfRange = safeBiomarkers.filter(
      b => b.value < b.normalRange.min || b.value > b.normalRange.max
    );
    return {
      inRangeCount: safeBiomarkers.length - outOfRange.length,
      outOfRangeCount: outOfRange.length,
      outOfRangeBiomarkers: outOfRange,
    };
  }, [biomarkers]);

  // Calculate biomarker counts per category for sidebar badges
  const categoryCounts = useMemo(() => {
    const safeBiomarkers = biomarkers || [];
    const counts: Record<string, number> = {};
    for (const biomarker of safeBiomarkers) {
      counts[biomarker.category] = (counts[biomarker.category] || 0) + 1;
    }
    return counts;
  }, [biomarkers]);

  // ============================================
  // Loading State
  // ============================================

  if (isLoadingBiomarkers) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-400">Loading your health data...</p>
        </div>
      </div>
    );
  }

  // ============================================
  // Render Content Functions
  // ============================================

  const renderDashboardContent = () => {
    return (
      <div className="animate-fade-in max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <p className="text-sm font-medium text-slate-400 dark:text-slate-500 mb-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">Your Health Data</h1>
        </div>

        {/* Bento Grid Layout - Responsive */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-4 md:gap-5">

          {/* Quick Stats - Stack on mobile */}
          <div className="sm:col-span-1 md:col-span-4 bg-slate-900 rounded-2xl p-4 md:p-5 flex flex-col justify-between min-h-[100px]">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Tracked</span>
            <div>
              <span className="text-3xl md:text-4xl font-bold text-white">{biomarkers.length}</span>
              <p className="text-sm text-slate-400 mt-1">biomarkers</p>
            </div>
          </div>

          <div className="sm:col-span-1 md:col-span-4 bg-wellness-500 rounded-2xl p-4 md:p-5 flex flex-col justify-between min-h-[100px]">
            <span className="text-xs font-medium text-wellness-100 uppercase tracking-wide">Normal</span>
            <div>
              <span className="text-3xl md:text-4xl font-bold text-white">{inRangeCount}</span>
              <p className="text-sm text-wellness-100 mt-1">in range</p>
            </div>
          </div>

          <div className="sm:col-span-2 md:col-span-4 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl p-4 md:p-5 flex flex-col justify-between min-h-[100px]">
            <span className="text-xs font-medium text-red-100 uppercase tracking-wide">Needs Review</span>
            <div className="flex items-end justify-between">
              <div>
                <span className="text-3xl md:text-4xl font-bold text-white">{outOfRangeCount}</span>
                <p className="text-sm text-red-100 mt-1">out of range</p>
              </div>
              {outOfRangeCount > 0 && (
                <AlertCircle className="w-6 h-6 md:w-8 md:h-8 text-white/30" />
              )}
            </div>
          </div>

          {/* Quick Actions - Responsive grid */}
          <div className="sm:col-span-2 md:col-span-6 grid grid-cols-3 gap-2 md:gap-3">
            <button
              onClick={() => setIsLabUploadModalOpen(true)}
              className="bg-white dark:bg-slate-800 rounded-xl md:rounded-2xl border border-slate-200/60 dark:border-slate-700 p-3 md:p-4 hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-sm transition-all group text-left min-h-[88px]"
            >
              <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mb-2 md:mb-3 group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 transition-colors">
                <FileUp className="w-4 h-4 text-brand-600 dark:text-slate-300" />
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-900 dark:text-white">Lab OCR</p>
              <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 hidden sm:block">Auto-extract</p>
            </button>
            <button
              onClick={() => setIsPDFModalOpen(true)}
              className="bg-white dark:bg-slate-800 rounded-xl md:rounded-2xl border border-slate-200/60 dark:border-slate-700 p-3 md:p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all group text-left min-h-[88px]"
            >
              <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center mb-2 md:mb-3 group-hover:bg-slate-200 dark:group-hover:bg-slate-600 transition-colors">
                <FileUp className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-900 dark:text-white">Upload PDF</p>
              <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 hidden sm:block">Local OCR</p>
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-white dark:bg-slate-800 rounded-xl md:rounded-2xl border border-slate-200/60 dark:border-slate-700 p-3 md:p-4 hover:border-wellness-300 dark:hover:border-wellness-500 hover:shadow-sm transition-all group text-left min-h-[88px]"
            >
              <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-wellness-50 dark:bg-wellness-900/30 flex items-center justify-center mb-2 md:mb-3 group-hover:bg-wellness-100 dark:group-hover:bg-wellness-900/50 transition-colors">
                <Plus className="w-4 h-4 text-wellness-600 dark:text-slate-300" />
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-900 dark:text-white">Add Data</p>
              <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 hidden sm:block">Manual entry</p>
            </button>
          </div>

          {/* Attention Items - Conditional */}
          {outOfRangeCount > 0 && (
            <div className="sm:col-span-2 md:col-span-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 overflow-hidden">
              <div className="px-4 md:px-5 py-3 md:py-4 border-b border-slate-100 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-white">Needs Attention</h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {outOfRangeBiomarkers.slice(0, 3).map((biomarker) => {
                  const isLow = biomarker.value < biomarker.normalRange.min;
                  return (
                    <div key={biomarker.id} className="px-4 md:px-5 py-3 md:py-4 flex items-center justify-between hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isLow ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{biomarker.name}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-400">{isLow ? 'Below' : 'Above'} range</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <p className="text-sm font-semibold text-red-600 dark:text-red-400">{biomarker.value}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-400">{biomarker.unit}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Measurements */}
          <div className={`sm:col-span-2 ${outOfRangeCount > 0 ? 'md:col-span-6' : 'md:col-span-12'} bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 overflow-hidden`}>
            <div className="px-4 md:px-5 py-3 md:py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 dark:text-white">Recent Measurements</h3>
              <span className="text-xs text-slate-400 dark:text-slate-400">Last updated</span>
            </div>
            <div className={`${outOfRangeCount > 0 ? '' : 'grid grid-cols-1 md:grid-cols-2'} divide-y md:divide-y-0 divide-slate-100 dark:divide-slate-700`}>
              {(biomarkers || [])
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, outOfRangeCount > 0 ? 4 : 6)
                .map((biomarker, idx) => {
                  const status = getValueStatus(biomarker);
                  return (
                    <div
                      key={biomarker.id}
                      className={`px-4 md:px-5 py-3 md:py-3.5 flex items-center justify-between hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors ${
                        outOfRangeCount === 0 && idx % 2 === 0 ? 'md:border-r md:border-slate-100 dark:md:border-slate-700' : ''
                      } ${outOfRangeCount === 0 ? 'md:border-b md:border-slate-100 dark:md:border-slate-700' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${status.isOutOfRange ? 'bg-red-500' : 'bg-wellness-500'}`} />
                        <span className="text-sm text-slate-700 dark:text-slate-200">{biomarker.name}</span>
                      </div>
                      <span className={`text-sm font-medium ${status.isOutOfRange ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
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

  const renderInsuranceContent = () => {
    return (
      <InsuranceHub
        insurancePlans={insurancePlans}
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
        onUploadSBC={() => setIsSBCUploadOpen(true)}
        onSmartUpload={() => setIsEnhancedUploadOpen(true)}
        onViewPlanDetails={() => setIsInsuranceViewerOpen(true)}
      />
    );
  };

  const renderKnowledgeBaseContent = () => {
    return <InsuranceKnowledgeBase plans={insurancePlans} />;
  };

  const renderFilesContent = () => {
    return (
      <FilesPage onUploadClick={() => setIsLabUploadModalOpen(true)} />
    );
  };

  const renderCategoryContent = () => {
    // Defensive null check to prevent "Cannot read properties of undefined" errors
    const safeFilteredBiomarkers = filteredBiomarkers || [];
    const outOfRangeBiomarkers = safeFilteredBiomarkers.filter(b => b.value < b.normalRange.min || b.value > b.normalRange.max);
    const inRangeBiomarkers = safeFilteredBiomarkers.filter(b => b.value >= b.normalRange.min && b.value <= b.normalRange.max);

    return (
      <div className="max-w-6xl mx-auto animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{selectedCategory}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            {categories.find(c => c.name === selectedCategory)?.description}
          </p>
        </div>

        <BiomarkerSummary biomarkers={biomarkers} category={selectedCategory} />

        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-brand-600 rounded-xl hover:bg-slate-800 dark:hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Data
          </button>
          <button
            onClick={() => setIsPDFModalOpen(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
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
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                Needs Attention ({outOfRangeBiomarkers.length})
              </h2>
              <div className="grid gap-3">
                {outOfRangeBiomarkers.map((biomarker) => {
                  const isLow = biomarker.value < biomarker.normalRange.min;
                  const isSelected = selectedBiomarker?.id === biomarker.id;

                  return (
                    <div
                      key={biomarker.id}
                      onClick={() => setSelectedBiomarker(isSelected ? null : biomarker)}
                      className={`bg-white dark:bg-slate-800 rounded-xl border p-4 cursor-pointer transition-all ${
                        isSelected ? 'border-red-300 dark:border-red-500 ring-2 ring-red-100 dark:ring-red-900/30' : 'border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-600'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-slate-900 dark:text-white">{biomarker.name}</h3>
                            {biomarker.sourceFile && (
                              <span className="text-2xs px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded">Auto</span>
                            )}
                          </div>
                          <p className="text-sm text-slate-500 dark:text-slate-400">{biomarker.description}</p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center gap-2 justify-end">
                            <span className="text-lg font-bold text-red-600 dark:text-red-400">{biomarker.value}</span>
                            <span className="text-sm text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
                          </div>
                          <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                            {isLow ? 'Below' : 'Above'} range ({biomarker.normalRange.min}-{biomarker.normalRange.max})
                          </p>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => handleTrendClick(biomarker, e)}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <LineChart className="w-4 h-4" />
                          </button>
                          {insurancePlans.length > 0 && (
                            <button
                              onClick={(e) => handleInsuranceClick(biomarker, e)}
                              className="p-2 text-slate-400 dark:text-slate-500 hover:text-wellness-600 dark:hover:text-wellness-400 hover:bg-wellness-50 dark:hover:bg-wellness-900/30 rounded-lg transition-colors"
                            >
                              <Shield className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isSelected && (
                        <div className="mt-4 pt-4 border-t border-red-100 dark:border-red-800">
                          <BiomarkerAIGuidance biomarker={biomarker} allBiomarkers={biomarkers} />
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
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-wellness-500" />
                In Range ({inRangeBiomarkers.length})
              </h2>
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {inRangeBiomarkers.map((biomarker) => {
                  const isSelected = selectedBiomarker?.id === biomarker.id;

                  return (
                    <div
                      key={biomarker.id}
                      onClick={() => setSelectedBiomarker(isSelected ? null : biomarker)}
                      className={`p-4 cursor-pointer transition-colors ${isSelected ? 'bg-wellness-50/50 dark:bg-wellness-900/20' : 'hover:bg-slate-50/50 dark:hover:bg-slate-700/50'}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-wellness-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-900 dark:text-white">{biomarker.name}</span>
                            </div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{biomarker.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 flex-shrink-0">
                          <div className="text-right">
                            <span className="font-semibold text-slate-900 dark:text-white">{biomarker.value}</span>
                            <span className="text-sm text-slate-400 dark:text-slate-500 ml-1">{biomarker.unit}</span>
                          </div>
                          <button
                            onClick={(e) => handleTrendClick(biomarker, e)}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <LineChart className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="mt-4 pt-4 border-t border-wellness-100 dark:border-wellness-800">
                          <BiomarkerAIGuidance biomarker={biomarker} allBiomarkers={biomarkers} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {safeFilteredBiomarkers.length === 0 && (
            <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
              <Activity className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No {selectedCategory} Data</h3>
              <p className="text-slate-500 dark:text-slate-400 mb-6">Add your first measurement to start tracking.</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-brand-600 rounded-xl hover:bg-slate-800 dark:hover:bg-brand-700 transition-colors"
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

  // Show Account Settings page if enabled
  if (showSettings) {
    return <AccountSettingsPage onBack={() => setShowSettings(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
      {/* Premium Navbar */}
      <nav className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-700/60 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8">
          <div className="flex justify-between h-14 md:h-16 items-center">
            <div className="flex items-center space-x-2 md:space-x-3">
              {/* Hamburger Menu - Mobile Only */}
              <button
                onClick={() => setIsMobileSidebarOpen(true)}
                className="md:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Open menu"
              >
                <Menu className="w-6 h-6 text-slate-600 dark:text-slate-300" />
              </button>
              <div className="relative">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/25">
                  <Heart className="w-4 h-4 md:w-5 md:h-5 text-white" />
                </div>
              </div>
              <div>
                <span className="text-lg md:text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                  OwnMyHealth
                </span>
                <p className="text-xs text-slate-500 dark:text-slate-400 -mt-0.5 hidden sm:block">Your personal health companion</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* User Menu */}
              {user && onLogout && (
                <div className="relative">
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center space-x-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center">
                      <User className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                    </div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 hidden sm:block max-w-[120px] truncate">
                      {user.email}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
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
                      <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-50">
                        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{user.email}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{user.role.toLowerCase()}</p>
                        </div>
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            setShowSettings(true);
                          }}
                          className="w-full flex items-center px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        >
                          <Settings className="w-4 h-4 mr-3" />
                          Account Settings
                        </button>
                        <button
                          onClick={async () => {
                            setIsUserMenuOpen(false);
                            await onLogout();
                          }}
                          className="w-full flex items-center px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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

      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          {/* Drawer */}
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-white dark:bg-slate-900 shadow-xl animate-slide-in-left overflow-y-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center">
                  <Heart className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-bold text-slate-900 dark:text-white">Menu</span>
              </div>
              <button
                onClick={() => setIsMobileSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </button>
            </div>
            <div className="p-4">
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
                        setIsMobileSidebarOpen(false);
                      }}
                      defaultExpanded={group.id === 'overview' || group.id === 'insurance'}
                      categoryCounts={categoryCounts}
                    />
                  );
                })}
              </nav>
            </div>
          </aside>
        </div>
      )}

      <div className="max-w-[1600px] mx-auto flex">
        {/* Desktop Sidebar - Hidden on Mobile */}
        <aside className="hidden md:block w-72 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border-r border-slate-200/60 dark:border-slate-700/60 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto sidebar-scroll">
          <div className="p-5 pb-8">
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
                    defaultExpanded={group.id === 'overview' || group.id === 'insurance'}
                    categoryCounts={categoryCounts}
                  />
                );
              })}
            </nav>

            <div className="mt-6 p-4 bg-gradient-to-br from-brand-50 to-brand-100/50 dark:from-slate-800 dark:to-slate-800 rounded-2xl border border-brand-200/50 dark:border-slate-700">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-semibold text-brand-900 dark:text-white">Pro Tip</span>
              </div>
              <p className="text-xs text-brand-700 dark:text-slate-300 leading-relaxed">
                Upload your lab reports to automatically extract and track biomarkers over time.
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 px-4 md:px-8 py-6 md:py-8 min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100vh-4rem)]">
          {selectedCategory === 'Dashboard' ? renderDashboardContent() :
           selectedCategory === 'Trends' ? <TrendsPage biomarkers={biomarkers} /> :
           selectedCategory === 'Insurance' ? renderInsuranceContent() :
           selectedCategory === 'Insurance Guide' ? renderInsuranceGuideContent() :
           selectedCategory === 'Knowledge Base' ? renderKnowledgeBaseContent() :
           selectedCategory === 'Files' ? renderFilesContent() :
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

      <LabUploadModal
        isOpen={isLabUploadModalOpen}
        onClose={() => setIsLabUploadModalOpen(false)}
        onSuccess={handleLabOCRSuccess}
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
