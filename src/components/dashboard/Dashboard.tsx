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

import React, { useState, useCallback, lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type { Biomarker } from '../../types';
import {
  useModals,
  useErrorNotification,
  useBiomarkerStats,
  useBiomarkerData,
  useFilteredBiomarkers,
} from '../../hooks';

// Extracted dashboard components
import { DashboardHeader } from './DashboardHeader';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardContent } from './DashboardContent';
import { CategoryContent } from './CategoryContent';
import { DashboardModals } from './DashboardModals';
import { ErrorToast } from '../common/ErrorToast';

// Lazy-loaded pages (only loaded when navigating to them)
const InsuranceHub = lazy(() => import('../insurance/InsuranceHub'));
const InsuranceKnowledgeBase = lazy(() => import('../insurance/InsuranceKnowledgeBase'));
const FilesPage = lazy(() => import('../files/FilesPage'));
const TrendsPage = lazy(() => import('../trends/TrendsPage'));
const AccountSettingsPage = lazy(() => import('../settings/AccountSettingsPage'));

// Data (for demo mode / fallback)
import { initialBiomarkers as sampleBiomarkers, navGroups, categories } from '../../data/sampleData';

// Auth
import { useAuth } from '../../contexts/AuthContext';

/** Loading fallback for lazy-loaded pages */
function PageLoadSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
      </div>
    </div>
  );
}

interface DashboardProps {
  isDemoMode?: boolean;
}

/**
 * Main Dashboard component
 *
 * Orchestrates the health tracking interface using extracted sub-components:
 * - DashboardHeader: Navigation bar with user menu
 * - DashboardSidebar: Category navigation (mobile drawer + desktop fixed)
 * - DashboardContent: Main stats overview
 * - CategoryContent: Biomarker category detail view
 * - DashboardModals: All modal dialogs
 */
export function Dashboard({ isDemoMode = false }: DashboardProps) {
  const { user, logout: authLogout } = useAuth();
  const modals = useModals();
  const errorNotification = useErrorNotification();

  // Navigation state
  const [selectedCategory, setSelectedCategory] = useState<string>('Overview');
  const [selectedBiomarker, setSelectedBiomarker] = useState<Biomarker | null>(null);
  const [trendBiomarker, setTrendBiomarker] = useState<Biomarker | null>(null);
  const [selectedBiomarkerForInsurance, setSelectedBiomarkerForInsurance] = useState<Biomarker | null>(null);

  // Data fetching and management
  // NOTE: useBiomarkerData uses useRef internally for initialBiomarkers and onError
  // to prevent infinite loops. Only user?.id triggers re-fetches.
  const {
    biomarkers,
    insurancePlans,
    isLoading,
    handleAddMeasurement,
    handlePDFExtract,
    handleClinicalFileExtract,
    handleLabOCRSuccess,
    handleInsurancePlanExtracted,
  } = useBiomarkerData({
    user,
    initialBiomarkers: isDemoMode ? sampleBiomarkers : [],
    onError: errorNotification.show,
  });

  // Computed stats
  const stats = useBiomarkerStats(biomarkers);
  const filteredBiomarkers = useFilteredBiomarkers(biomarkers, selectedCategory);

  // Event handlers
  const handleLogout = useCallback(async () => {
    try {
      await authLogout();
    } catch (error) {
      console.error('Logout error:', error);
    }
  }, [authLogout]);

  const handleCategorySelect = useCallback((category: string) => {
    setSelectedCategory(category);
    setSelectedBiomarker(null);
  }, []);

  const handleTrendClick = useCallback((biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setTrendBiomarker(biomarker);
    modals.open('trend');
  }, [modals]);

  const handleInsuranceClick = useCallback((biomarker: Biomarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBiomarkerForInsurance(biomarker);
  }, []);

  const handleCloseTrendModal = useCallback(() => {
    modals.close('trend');
    setTrendBiomarker(null);
  }, [modals]);

  // Render special pages (non-biomarker categories)
  const renderSpecialPage = () => {
    switch (selectedCategory) {
      case 'Insurance Hub':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <InsuranceHub
              plans={insurancePlans}
              onOpenSBCUpload={() => modals.open('sbcUpload')}
              onOpenPlanViewer={() => modals.open('insuranceViewer')}
              onOpenEnhancedUpload={() => modals.open('enhancedUpload')}
            />
          </Suspense>
        );
      case 'Knowledge Base':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <InsuranceKnowledgeBase />
          </Suspense>
        );
      case 'Files':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <FilesPage />
          </Suspense>
        );
      case 'Trends':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <TrendsPage biomarkers={biomarkers} />
          </Suspense>
        );
      case 'Account Settings':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <AccountSettingsPage />
          </Suspense>
        );
      default:
        return null;
    }
  };

  // Determine if showing a special page or biomarker content
  const specialPages = ['Insurance Hub', 'Knowledge Base', 'Files', 'Trends', 'Account Settings'];
  const isSpecialPage = specialPages.includes(selectedCategory);

  // Loading state
  if (isLoading && biomarkers.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-brand-500 mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Loading your health data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Error Toast */}
      <ErrorToast
        message={errorNotification.message}
        isVisible={errorNotification.isVisible}
        onDismiss={errorNotification.hide}
      />

      {/* Header */}
      <DashboardHeader
        user={user}
        onLogout={handleLogout}
        onOpenMobileSidebar={() => modals.open('mobileSidebar')}
        onOpenAccountSettings={() => handleCategorySelect('Account Settings')}
      />

      {/* Main Layout */}
      <div className="flex">
        {/* Sidebar */}
        <DashboardSidebar
          navGroups={navGroups}
          categories={categories}
          selectedCategory={selectedCategory}
          onCategorySelect={handleCategorySelect}
          categoryCounts={stats.categoryCounts}
          showMobileSidebar={modals.isOpen('mobileSidebar')}
          onCloseMobileSidebar={() => modals.close('mobileSidebar')}
        />

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8">
          {isSpecialPage ? (
            renderSpecialPage()
          ) : selectedCategory === 'Overview' || selectedCategory === 'Dashboard' ? (
            <DashboardContent
              biomarkers={biomarkers}
              categories={categories}
              stats={stats}
              insurancePlans={insurancePlans}
              onCategorySelect={handleCategorySelect}
              onOpenAddMeasurement={() => modals.open('addMeasurement')}
              onOpenPDFUpload={() => modals.open('pdfUpload')}
              onOpenLabUpload={() => modals.open('labUpload')}
              onOpenClinicalUpload={() => modals.open('clinicalUpload')}
            />
          ) : (
            <CategoryContent
              selectedCategory={selectedCategory}
              categories={categories}
              biomarkers={biomarkers}
              filteredBiomarkers={filteredBiomarkers}
              insurancePlans={insurancePlans}
              selectedBiomarker={selectedBiomarker}
              onSelectBiomarker={setSelectedBiomarker}
              onTrendClick={handleTrendClick}
              onInsuranceClick={handleInsuranceClick}
              onOpenAddMeasurement={() => modals.open('addMeasurement')}
              onOpenPDFUpload={() => modals.open('pdfUpload')}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <DashboardModals
        isOpen={modals.isOpen}
        close={modals.close}
        selectedCategory={selectedCategory}
        insurancePlans={insurancePlans}
        trendBiomarker={trendBiomarker}
        selectedBiomarkerForInsurance={selectedBiomarkerForInsurance}
        onAddMeasurement={handleAddMeasurement}
        onPDFExtract={handlePDFExtract}
        onClinicalFileExtract={handleClinicalFileExtract}
        onLabOCRSuccess={handleLabOCRSuccess}
        onInsurancePlanExtracted={handleInsurancePlanExtracted}
        onCloseTrendModal={handleCloseTrendModal}
        onCloseInsurancePanel={() => setSelectedBiomarkerForInsurance(null)}
      />
    </div>
  );
}

export default Dashboard;
