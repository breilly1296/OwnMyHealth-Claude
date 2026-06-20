/**
 * InsuranceHub
 *
 * Top-level insurance dashboard. Orchestrates the stats grid, tab
 * switching, and per-tab content. Plan card rendering, stats computation,
 * and the Learn & Save content live in their own focused components.
 *
 * Tabs:
 * - My Plans → InsurancePlanCard grid
 * - Cost Analysis → cost summary header + CostOptimization
 * - Learn & Save → InsuranceLearnTab
 *
 * When a plan is selected, the hub swaps to InsurancePlanDetail.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield,
  CreditCard,
  Lightbulb,
  Plus,
  Sparkles,
  AlertTriangle,
  Trash2,
  CreditCard as CreditCardIcon,
  TrendingDown,
} from 'lucide-react';
import type { InsurancePlan, PersonalizedInsuranceGuide } from '../../types';
import type { InsurancePlanData } from '../../services/api';
import { SuccessToast } from '../common';
import AddInsurancePlanModal from './AddInsurancePlanModal';
import InsurancePlanDetail from './InsurancePlanDetail';
import CostOptimization from './CostOptimization';
import InsurancePlanCard from './InsurancePlanCard';
import { formatCurrency } from './planFormatters';
import InsuranceStatsGrid from './InsuranceStatsGrid';
import InsuranceLearnTab from './InsuranceLearnTab';

interface InsuranceHubProps {
  insurancePlans: InsurancePlan[];
  guide?: PersonalizedInsuranceGuide;
  onUploadSBC: () => void;
  onSmartUpload: () => void;
  onViewPlanDetails: () => void;
  onDeletePlan?: (planId: string) => Promise<void>;
  onRefresh?: () => void;
}

type TabType = 'plans' | 'costs' | 'learn';

const defaultGuide: PersonalizedInsuranceGuide = {
  userProfile: {
    detectedConditions: [],
    recommendedServices: [],
    riskFactors: [],
    currentPlans: [],
  },
  educationModules: [],
  costProjections: [],
  optimizationTips: [],
  glossary: [],
};

// ---------- Cost tab summary ----------

interface CostSummaryProps {
  plan: InsurancePlan;
}

function CostSummary({ plan }: CostSummaryProps) {
  const monthlyPremium = plan.premiumMonthly;
  const annualPremium = typeof monthlyPremium === 'number' ? monthlyPremium * 12 : null;

  const deductible = plan.deductibleIndividual;
  const deductibleMet = plan.deductibleMetIndividual;
  const deductibleRemaining =
    typeof deductible === 'number' && typeof deductibleMet === 'number'
      ? Math.max(0, deductible - deductibleMet)
      : null;
  const deductibleProgress =
    typeof deductible === 'number' && deductible > 0 && typeof deductibleMet === 'number'
      ? Math.round((deductibleMet / deductible) * 100)
      : null;

  let narrative = 'Track your deductible in plan details to see personalized progress.';
  if (deductibleProgress !== null && deductibleRemaining !== null) {
    narrative = `You've met ${deductibleProgress}% of your deductible — ${formatCurrency(
      deductibleRemaining
    )} remaining before coinsurance rates apply.`;
  } else if (typeof deductible === 'number') {
    narrative = `Deductible of ${formatCurrency(deductible)}. Add spending data in plan details to track progress.`;
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
            Monthly premium
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {formatCurrency(monthlyPremium)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
            Annual premium
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {formatCurrency(annualPremium)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
            Remaining deductible
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {formatCurrency(deductibleRemaining)}
          </p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
        <p className="text-sm text-slate-600 dark:text-slate-300">{narrative}</p>
      </div>
    </div>
  );
}

// ---------- Delete confirmation ----------

interface DeleteConfirmModalProps {
  plan: InsurancePlan;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

function DeleteConfirmModal({ plan, onCancel, onConfirm, isDeleting }: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Delete Insurance Plan</h3>
        </div>
        <p className="text-slate-600 dark:text-slate-400 mb-2">Are you sure you want to delete this plan?</p>
        <p className="text-sm font-medium text-slate-900 dark:text-white mb-6">
          {plan.planName} ({plan.insurerName})
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isDeleting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete Plan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Main ----------

export default function InsuranceHub({
  insurancePlans,
  guide = defaultGuide,
  onUploadSBC: _onUploadSBC,
  onSmartUpload,
  onViewPlanDetails: _onViewPlanDetails,
  onDeletePlan,
  onRefresh,
}: InsuranceHubProps) {
  const [activeTab, setActiveTab] = useState<TabType>('plans');
  const [isAddPlanModalOpen, setIsAddPlanModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<InsurancePlan | null>(null);
  const [deleteConfirmPlan, setDeleteConfirmPlan] = useState<InsurancePlan | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const hideSuccessMessage = useCallback(() => setSuccessMessage(null), []);

  const handlePlanAdded = () => {
    setIsAddPlanModalOpen(false);
    onRefresh?.();
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmPlan || !onDeletePlan) return;
    setIsDeleting(true);
    try {
      await onDeletePlan(deleteConfirmPlan.id);
      setDeleteConfirmPlan(null);
      setSuccessMessage('Plan deleted');
    } catch {
      // Error already handled by parent
    } finally {
      setIsDeleting(false);
    }
  };

  // The CostOptimization panel needs a single active plan. Prefer the
  // one flagged active on the backend shape (not on the UI type —
  // InsurancePlan in src/types has no isActive field, so we read through
  // an unknown-cast), fall back to the first.
  const activePlan = useMemo<InsurancePlan | undefined>(
    () =>
      insurancePlans.find((p) => (p as unknown as { isActive?: boolean }).isActive) ??
      insurancePlans[0],
    [insurancePlans]
  );

  const tabs: Array<{ id: TabType; label: string; icon: typeof Shield }> = [
    { id: 'plans', label: 'My Plans', icon: Shield },
    { id: 'costs', label: 'Cost Analysis', icon: CreditCard },
    { id: 'learn', label: 'Learn & Save', icon: Lightbulb },
  ];

  if (selectedPlan) {
    return <InsurancePlanDetail plan={selectedPlan} onBack={() => setSelectedPlan(null)} />;
  }

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      <SuccessToast message={successMessage} isVisible={!!successMessage} onDismiss={hideSuccessMessage} />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Insurance</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Manage plans, track costs, and optimize coverage</p>
      </div>

      {/* Stats */}
      {insurancePlans.length > 0 && <InsuranceStatsGrid plans={insurancePlans} guide={guide} />}

      {/* Tabs */}
      <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-1 inline-flex mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'plans' && (
          <div className="space-y-6">
            {insurancePlans.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-blue-500 dark:text-blue-400" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">No insurance plans yet</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-md mx-auto">
                  Upload your Summary of Benefits and Coverage (SBC) document to get personalized insights.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    onClick={() => setIsAddPlanModalOpen(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-blue-500/25 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Add Plan
                  </button>
                  <button
                    onClick={onSmartUpload}
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                  >
                    <Sparkles className="w-4 h-4" />
                    Smart Upload
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {insurancePlans.map((plan) => (
                  <InsurancePlanCard
                    key={plan.id}
                    plan={plan}
                    onSelect={setSelectedPlan}
                    onDelete={onDeletePlan ? (p) => setDeleteConfirmPlan(p) : undefined}
                    isDeleting={isDeleting && deleteConfirmPlan?.id === plan.id}
                  />
                ))}
                <button
                  onClick={() => setIsAddPlanModalOpen(true)}
                  className="w-full p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-slate-500 dark:text-slate-400 hover:border-blue-300 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  <span className="font-medium">Add another plan</span>
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'costs' && (
          <CostsTab
            plans={insurancePlans}
            activePlan={activePlan}
            onAddPlan={() => setIsAddPlanModalOpen(true)}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'learn' && <InsuranceLearnTab plans={insurancePlans} guide={guide} />}
      </div>

      <AddInsurancePlanModal
        isOpen={isAddPlanModalOpen}
        onClose={() => setIsAddPlanModalOpen(false)}
        onPlanAdded={handlePlanAdded}
      />

      {deleteConfirmPlan && (
        <DeleteConfirmModal
          plan={deleteConfirmPlan}
          isDeleting={isDeleting}
          onCancel={() => setDeleteConfirmPlan(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

// ---------- Cost tab (inline, small enough not to extract) ----------

interface CostsTabProps {
  plans: InsurancePlan[];
  activePlan: InsurancePlan | undefined;
  onAddPlan: () => void;
  onRefresh?: () => void;
}

function CostsTab({ plans, activePlan, onAddPlan, onRefresh }: CostsTabProps) {
  if (plans.length === 0 || !activePlan) {
    return (
      <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
        <div className="w-20 h-20 bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <CreditCardIcon className="w-10 h-10 text-amber-500 dark:text-amber-400" />
        </div>
        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
          Add an insurance plan to see cost projections
        </h3>
        <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-md mx-auto">
          Cost analysis compares your projected spending against your plan's deductible, copays, and coinsurance.
        </p>
        <button
          onClick={onAddPlan}
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-blue-500/25 transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Plan
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CostSummary plan={activePlan} />
      <CostOptimization plan={activePlan as unknown as InsurancePlanData} onPlanUpdate={onRefresh} />
      {/*
        CostOptimization renders its own empty/no-projections state; if
        that surface needs its own guided CTA later it can be added there,
        not here.
      */}
      <div className="flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <TrendingDown className="w-3.5 h-3.5" />
        <span>Projections update as you add expense data.</span>
      </div>
    </div>
  );
}
