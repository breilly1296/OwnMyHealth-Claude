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

import React, { useState, useCallback, lazy, Suspense, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { Biomarker } from '../../types';
import { onboardingApi } from '../../services/api';
import type { OnboardingStatus } from '../../services/api';
import { dashboardLogger } from '../../utils/logger';
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
import { ErrorBoundary } from '../common';

// Lazy-loaded pages (only loaded when navigating to them)
const InsuranceHub = lazy(() => import('../insurance/InsuranceHub'));
const InsuranceKnowledgeBase = lazy(() => import('../insurance/InsuranceKnowledgeBase'));
const FilesPage = lazy(() => import('../files/FilesPage'));
const TrendsPage = lazy(() => import('../trends/TrendsPage'));
const AccountSettingsPage = lazy(() => import('../settings/AccountSettingsPage'));
const GoalTrackerPanel = lazy(() => import('../analytics/GoalTrackerPanel'));
const HealthNeedsPage = lazy(() => import('../health/HealthNeedsPage'));
const HealthGuidePage = lazy(() => import('../health/HealthGuidePage'));
const OnboardingWizard = lazy(() => import('../onboarding/OnboardingWizard'));

// Data (for demo mode / fallback)
import { initialBiomarkers as sampleBiomarkers, navGroups, categories } from '../../data/sampleData';

// Auth
import { useAuth } from '../../contexts/AuthContext';

// URL <-> category sync. Maps live in categoryRouting.ts so the sidebar
// can compute proper link `href` values without duplicating the table.
import { pathToCategoryMap, categoryToPathMap } from './categoryRouting';

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

  // Navigation state — initialize from URL so deep links land on the right
  // page instead of always defaulting to Overview.
  const [selectedCategory, setSelectedCategory] = useState<string>(
    () => pathToCategoryMap[window.location.pathname] || 'Overview'
  );
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
    handleDeleteInsurancePlan,
    refreshBiomarkers,
    refreshInsurancePlans,
  } = useBiomarkerData({
    user,
    initialBiomarkers: isDemoMode ? sampleBiomarkers : [],
    onError: errorNotification.show,
  });

  // Computed stats
  const stats = useBiomarkerStats(biomarkers);
  const filteredBiomarkers = useFilteredBiomarkers(biomarkers, selectedCategory);

  // Onboarding state. Unknown until the first fetch resolves; the wizard
  // renders only when we've confirmed `completed: false`. Demo mode skips
  // onboarding entirely — the sample dataset already makes the app useful.
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(isDemoMode);
  useEffect(() => {
    if (isDemoMode || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await onboardingApi.getStatus();
        if (!cancelled) setOnboardingStatus(status);
      } catch {
        // Non-fatal — if the check fails, fall through to the normal
        // dashboard rather than trap the user behind a broken wizard.
      } finally {
        if (!cancelled) setOnboardingChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDemoMode, user?.id]);

  const showOnboarding = !!onboardingStatus && !onboardingStatus.completed;

  // Event handlers
  const handleLogout = useCallback(async () => {
    try {
      await authLogout();
    } catch (error) {
      dashboardLogger.error('Logout failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }, [authLogout]);

  const handleCategorySelect = useCallback((category: string) => {
    setSelectedCategory(category);
    setSelectedBiomarker(null);
    const newPath = categoryToPathMap[category] || '/';
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
  }, []);

  // Browser back/forward — keep selectedCategory in sync with URL.
  useEffect(() => {
    const handlePopState = () => {
      setSelectedCategory(pathToCategoryMap[window.location.pathname] || 'Overview');
      setSelectedBiomarker(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Reflect the current page in the tab title.
  useEffect(() => {
    const isHome = selectedCategory === 'Overview' || selectedCategory === 'Dashboard';
    document.title = isHome ? 'OwnMyHealth' : `${selectedCategory} — OwnMyHealth`;
  }, [selectedCategory]);

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
      case 'Insurance':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <InsuranceHub
              insurancePlans={insurancePlans}
              onUploadSBC={() => modals.open('sbcUpload')}
              onSmartUpload={() => modals.open('enhancedUpload')}
              onViewPlanDetails={() => modals.open('insuranceViewer')}
              onDeletePlan={handleDeleteInsurancePlan}
              onRefresh={refreshInsurancePlans}
            />
          </Suspense>
        );
      case 'Knowledge Base':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <InsuranceKnowledgeBase plans={insurancePlans} />
          </Suspense>
        );
      case 'Files':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <FilesPage onUploadClick={() => modals.open('pdfUpload')} />
          </Suspense>
        );
      case 'Trends':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <TrendsPage biomarkers={biomarkers} />
          </Suspense>
        );
      case 'Health Guide':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <HealthGuidePage
              biomarkers={biomarkers}
              insurancePlans={insurancePlans}
              onNavigateToSettings={() => handleCategorySelect('Account Settings')}
              onOpenLabUpload={() => modals.open('pdfUpload')}
            />
          </Suspense>
        );
      case 'Goals':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <GoalTrackerPanel biomarkers={biomarkers} />
          </Suspense>
        );
      case 'Needs':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <HealthNeedsPage biomarkers={biomarkers} />
          </Suspense>
        );
      case 'Account Settings':
        return (
          <Suspense fallback={<PageLoadSpinner />}>
            <AccountSettingsPage onBack={() => handleCategorySelect('Overview')} />
          </Suspense>
        );
      default:
        return null;
    }
  };

  // Determine if showing a special page or biomarker content
  const specialPages = ['Insurance', 'Knowledge Base', 'Files', 'Trends', 'Goals', 'Needs', 'Health Guide', 'Account Settings'];
  const isSpecialPage = specialPages.includes(selectedCategory);

  // Loading state. `fixed inset-0` (rather than min-h-screen + width-auto)
  // guarantees the splash covers the entire viewport edge-to-edge — using
  // min-h-screen alone left a thin strip on the right/bottom in a
  // different shade because the wrapper inherited a narrower width from
  // the React tree above.
  if (isLoading && biomarkers.length === 0) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-950 z-40">
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
          biomarkers={biomarkers}
          insurancePlans={insurancePlans}
          stats={{ outOfRangeCount: stats.outOfRangeCount }}
        />

        {/* Main Content */}
        <main id="main-content" className="flex-1 p-4 md:p-8">
          {/* Granular boundary: a render error in one page must not unmount
              the whole app (header/sidebar stay alive). Keyed by category so
              navigating to another section remounts and recovers. */}
          <ErrorBoundary
            key={selectedCategory}
            fallback={
              <div className="flex items-center justify-center min-h-[60vh]">
                <div className="max-w-md text-center">
                  <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">
                    This section ran into a problem
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Try selecting a different section from the menu, or reload the
                    page. Your data is safe.
                  </p>
                </div>
              </div>
            }
          >
          {!onboardingChecked ? (
            <PageLoadSpinner />
          ) : showOnboarding && onboardingStatus ? (
            <Suspense fallback={<PageLoadSpinner />}>
              <OnboardingWizard
                status={onboardingStatus}
                onComplete={() => {
                  // Mark completed but keep the rest of the status so the
                  // stale-upload banner below can still read lastLabUploadAt.
                  setOnboardingStatus((prev) =>
                    prev ? { ...prev, completed: true, completedAt: new Date().toISOString() } : prev
                  );
                  refreshBiomarkers();
                }}
                onOpenHealthProfile={() => handleCategorySelect('Account Settings')}
              />
            </Suspense>
          ) : isSpecialPage ? (
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
              lastLabUploadAt={onboardingStatus?.lastLabUploadAt ?? null}
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
          </ErrorBoundary>
        </main>
      </div>

      {/* Modals — wrapped so a modal render error can't take down the shell. */}
      <ErrorBoundary fallback={null}>
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
      </ErrorBoundary>
    </div>
  );
}

export default Dashboard;
