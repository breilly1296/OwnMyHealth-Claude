/**
 * InsuranceHub Component
 *
 * A comprehensive insurance management dashboard that provides users with tools to:
 * - View and manage their insurance plans
 * - Analyze healthcare costs with projections and breakdowns
 * - Learn about insurance terms and discover money-saving strategies
 *
 * Features three main tabs:
 * 1. My Plans - Display uploaded insurance plans with coverage details and accuracy scores
 * 2. Cost Analysis - Show cost projections (premiums, deductibles, copays, coinsurance)
 *    along with a visual breakdown and health profile summary
 * 3. Learn & Save - Provide optimization tips with potential savings, an expandable
 *    glossary of insurance terms, and educational modules
 *
 * Stats grid shows: active plans count, covered services, estimated annual cost,
 * and potential savings from optimization tips.
 *
 * @module components/insurance/InsuranceHub
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  CreditCard,
  BookOpen,
  Lightbulb,
  FileText,
  CheckCircle,
  DollarSign,
  TrendingDown,
  Clock,
  ChevronRight,
  Plus,
  Sparkles,
  Info,
  AlertCircle,
  Stethoscope,
  UserCheck,
  Ambulance,
  Pill,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import type { InsurancePlan, PersonalizedInsuranceGuide } from '../../types';
import type { InsurancePlanData } from '../../services/api';
import { SuccessToast } from '../common';
import AddInsurancePlanModal from './AddInsurancePlanModal';
import InsurancePlanDetail from './InsurancePlanDetail';
import CostOptimization from './CostOptimization';

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

// Default empty guide when none is provided
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
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [isAddPlanModalOpen, setIsAddPlanModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<InsurancePlan | null>(null);
  const [deleteConfirmPlan, setDeleteConfirmPlan] = useState<InsurancePlan | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Auto-hide success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const hideSuccessMessage = useCallback(() => setSuccessMessage(null), []);

  const handlePlanAdded = () => {
    setIsAddPlanModalOpen(false);
    onRefresh?.();
  };

  const handleDeleteClick = (e: React.MouseEvent, plan: InsurancePlan) => {
    e.stopPropagation(); // Prevent card click
    setDeleteConfirmPlan(plan);
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const totalPotentialSavings = guide.optimizationTips
    .filter(tip => tip.potentialSavings)
    .reduce((sum, tip) => sum + (tip.potentialSavings || 0), 0);

  const tabs = [
    { id: 'plans' as TabType, label: 'My Plans', icon: Shield },
    { id: 'costs' as TabType, label: 'Cost Analysis', icon: CreditCard },
    { id: 'learn' as TabType, label: 'Learn & Save', icon: Lightbulb },
  ];

  // If a plan is selected, show the detail view
  if (selectedPlan) {
    return (
      <InsurancePlanDetail
        plan={selectedPlan}
        onBack={() => setSelectedPlan(null)}
      />
    );
  }

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Success Toast */}
      <SuccessToast
        message={successMessage}
        isVisible={!!successMessage}
        onDismiss={hideSuccessMessage}
      />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Insurance</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Manage plans, track costs, and optimize coverage</p>
      </div>

      {/* Stats Grid */}
      {insurancePlans.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 dark:bg-slate-800 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Plans</span>
            </div>
            <div className="text-3xl font-bold">{insurancePlans.length}</div>
            <p className="text-sm opacity-60 mt-1">active</p>
          </div>

          <div className="bg-wellness-500 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Services</span>
            </div>
            <div className="text-3xl font-bold">
              {insurancePlans.reduce((sum, p) => sum + p.benefits.length, 0)}
            </div>
            <p className="text-sm opacity-60 mt-1">covered</p>
          </div>

          <div className="bg-amber-500 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Est. Cost</span>
            </div>
            <div className="text-3xl font-bold">
              {guide.costProjections.length > 0
                ? formatCurrency(guide.costProjections[0]?.estimatedCosts.total || 0)
                : '$0'}
            </div>
            <p className="text-sm opacity-60 mt-1">annual</p>
          </div>

          <div className="bg-blue-500 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Savings</span>
            </div>
            <div className="text-3xl font-bold">
              {totalPotentialSavings > 0 ? formatCurrency(totalPotentialSavings) : '$0'}
            </div>
            <p className="text-sm opacity-60 mt-1">potential</p>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
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

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {/* Plans Tab */}
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
                  <div
                    key={plan.id}
                    className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6 hover:border-blue-200 dark:hover:border-blue-500 transition-all cursor-pointer group"
                    onClick={() => setSelectedPlan(plan)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">{plan.planName}</h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{plan.insurerName}</p>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg">
                              {plan.planType}
                            </span>
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              Effective {new Date(plan.effectiveDate).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {onDeletePlan && (
                          <button
                            onClick={(e) => handleDeleteClick(e, plan)}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete plan"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
                      </div>
                    </div>

                    {/* Deductible & OOP Progress */}
                    <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <p className="text-xs text-slate-400 dark:text-slate-500">Deductible</p>
                          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            {formatCurrency(plan.deductibleMetIndividual || 0)} / {formatCurrency(plan.deductibleIndividual || 0)}
                          </p>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, ((plan.deductibleMetIndividual || 0) / (plan.deductibleIndividual || 1)) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <p className="text-xs text-slate-400 dark:text-slate-500">Out-of-Pocket</p>
                          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            {formatCurrency(plan.oopMetIndividual || 0)} / {formatCurrency(plan.oopMaxIndividual || 0)}
                          </p>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, ((plan.oopMetIndividual || 0) / (plan.oopMaxIndividual || 1)) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Coverage Quick View */}
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Quick Coverage</p>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                          <Stethoscope className="w-4 h-4 mx-auto text-blue-500 mb-1" />
                          <p className="text-xs text-slate-500 dark:text-slate-400">Primary</p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {plan.copayPrimaryCare ? `$${plan.copayPrimaryCare}` : '--'}
                          </p>
                        </div>
                        <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                          <UserCheck className="w-4 h-4 mx-auto text-purple-500 mb-1" />
                          <p className="text-xs text-slate-500 dark:text-slate-400">Specialist</p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {plan.copaySpecialist ? `$${plan.copaySpecialist}` : '--'}
                          </p>
                        </div>
                        <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                          <Ambulance className="w-4 h-4 mx-auto text-red-500 mb-1" />
                          <p className="text-xs text-slate-500 dark:text-slate-400">Emergency</p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {plan.copayEmergency ? `$${plan.copayEmergency}` : '--'}
                          </p>
                        </div>
                        <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                          <Pill className="w-4 h-4 mx-auto text-green-500 mb-1" />
                          <p className="text-xs text-slate-500 dark:text-slate-400">Coinsurance</p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {plan.coinsuranceRate ? `${plan.coinsuranceRate}%` : '--'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Prior Auth Warning */}
                    {plan.benefits.some(b => b.priorAuthRequired) && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{plan.benefits.filter(b => b.priorAuthRequired).length} services require prior authorization</span>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add another plan */}
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

        {/* Add Insurance Plan Modal */}
        <AddInsurancePlanModal
          isOpen={isAddPlanModalOpen}
          onClose={() => setIsAddPlanModalOpen(false)}
          onPlanAdded={handlePlanAdded}
        />

        {/* Delete Confirmation Modal */}
        {deleteConfirmPlan && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Delete Insurance Plan</h3>
              </div>
              <p className="text-slate-600 dark:text-slate-400 mb-2">
                Are you sure you want to delete this plan?
              </p>
              <p className="text-sm font-medium text-slate-900 dark:text-white mb-6">
                {deleteConfirmPlan.planName} ({deleteConfirmPlan.insurerName})
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmPlan(null)}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
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
        )}

        {/* Costs Tab */}
        {activeTab === 'costs' && (
          <div className="space-y-6">
            {insurancePlans.length === 0 ? (
              <div className="text-center py-16 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                <CreditCard className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                <p className="text-slate-600 dark:text-slate-400">No insurance plans available</p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Upload an insurance plan to start tracking costs</p>
              </div>
            ) : (
              <>
                {/* Cost Optimization Component */}
                <CostOptimization
                  plan={(insurancePlans.find(p => p.isActive) || insurancePlans[0]) as InsurancePlanData}
                  onPlanUpdate={onRefresh}
                />

                {/* Legacy Cost Projections (from guide) */}
                {guide.costProjections.length > 0 && (
              <>
                {/* Cost Projections */}
                {guide.costProjections.map((projection, index) => (
                  <div key={index} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6">
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-1">{projection.scenario}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{projection.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                          {formatCurrency(projection.estimatedCosts.total)}
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">per year</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Premiums</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(projection.estimatedCosts.premiums)}
                        </p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Deductibles</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(projection.estimatedCosts.deductibles)}
                        </p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Copays</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(projection.estimatedCosts.copays)}
                        </p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Coinsurance</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(projection.estimatedCosts.coinsurance)}
                        </p>
                      </div>
                    </div>

                    {/* Cost breakdown visualization */}
                    <div className="mt-6">
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Cost breakdown</p>
                      <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                        <div
                          className="bg-blue-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.premiums / projection.estimatedCosts.total) * 100}%` }}
                          title="Premiums"
                        />
                        <div
                          className="bg-amber-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.deductibles / projection.estimatedCosts.total) * 100}%` }}
                          title="Deductibles"
                        />
                        <div
                          className="bg-emerald-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.copays / projection.estimatedCosts.total) * 100}%` }}
                          title="Copays"
                        />
                        <div
                          className="bg-purple-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.coinsurance / projection.estimatedCosts.total) * 100}%` }}
                          title="Coinsurance"
                        />
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-slate-500 dark:text-slate-400">Premiums</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-amber-500" />
                          <span className="text-slate-500 dark:text-slate-400">Deductibles</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-slate-500 dark:text-slate-400">Copays</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-purple-500" />
                          <span className="text-slate-500 dark:text-slate-400">Coinsurance</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Your Health Profile */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                      <Info className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                    </div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Your Health Profile</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Conditions</p>
                      <div className="space-y-2">
                        {guide.userProfile.detectedConditions.length > 0 ? (
                          guide.userProfile.detectedConditions.map((cond, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                              <span className="text-slate-700 dark:text-slate-300">{cond}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-slate-400">No conditions detected</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Recommended Services</p>
                      <div className="space-y-2">
                        {guide.userProfile.recommendedServices.slice(0, 4).map((svc, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <CheckCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                            <span className="text-slate-700 dark:text-slate-300">{svc}</span>
                          </div>
                        ))}
                        {guide.userProfile.recommendedServices.length > 4 && (
                          <p className="text-xs text-slate-400 dark:text-slate-500">
                            +{guide.userProfile.recommendedServices.length - 4} more
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
                )}
              </>
            )}
          </div>
        )}

        {/* Learn Tab */}
        {activeTab === 'learn' && (
          <div className="space-y-6">
            {/* Money-Saving Tips */}
            {guide.optimizationTips.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-5 h-5 text-green-500" />
                    <h2 className="font-semibold text-slate-900">Ways to Save</h2>
                  </div>
                  {totalPotentialSavings > 0 && (
                    <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">
                      Save up to {formatCurrency(totalPotentialSavings)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {guide.optimizationTips.slice(0, 4).map((tip, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:border-green-200 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-medium text-slate-900">{tip.title}</h3>
                        <span className={`text-xs px-2 py-1 rounded-lg ${
                          tip.difficulty === 'Easy' ? 'bg-green-50 text-green-700' :
                          tip.difficulty === 'Moderate' ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700'
                        }`}>
                          {tip.difficulty}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mb-4">{tip.description}</p>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1 text-slate-400">
                          <Clock className="w-4 h-4" />
                          {tip.timeToImplement}
                        </div>
                        {tip.potentialSavings && (
                          <span className="font-semibold text-green-600">
                            Save {formatCurrency(tip.potentialSavings)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Glossary */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="w-5 h-5 text-purple-500" />
                <h2 className="font-semibold text-slate-900">Insurance Terms</h2>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200/60 divide-y divide-slate-100">
                {guide.glossary.slice(0, 6).map((term, i) => (
                  <div key={i} className="p-4">
                    <button
                      onClick={() => setExpandedTerm(expandedTerm === term.term ? null : term.term)}
                      className="w-full flex items-center justify-between text-left"
                    >
                      <span className="font-medium text-slate-900">{term.term}</span>
                      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${
                        expandedTerm === term.term ? 'rotate-90' : ''
                      }`} />
                    </button>
                    {expandedTerm === term.term && (
                      <div className="mt-3 space-y-3">
                        <p className="text-sm text-slate-600">{term.definition}</p>
                        {term.userSpecificExample && (
                          <div className="p-3 bg-blue-50 rounded-xl">
                            <p className="text-sm text-blue-700">
                              <span className="font-medium">Your example:</span> {term.userSpecificExample}
                            </p>
                          </div>
                        )}
                        {term.tips.length > 0 && (
                          <div className="space-y-1">
                            {term.tips.slice(0, 2).map((tip, ti) => (
                              <div key={ti} className="flex items-start gap-2 text-sm text-slate-500">
                                <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                {tip}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Education Modules Preview */}
            {guide.educationModules.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="w-5 h-5 text-indigo-500" />
                  <h2 className="font-semibold text-slate-900">Learning Modules</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {guide.educationModules.slice(0, 2).map((module, i) => (
                    <div key={i} className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 p-5">
                      <h3 className="font-medium text-slate-900 mb-2">{module.title}</h3>
                      <p className="text-sm text-slate-600 mb-4">{module.description}</p>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>{module.terms.length} terms</span>
                        <span>{module.scenarios.length} scenarios</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
