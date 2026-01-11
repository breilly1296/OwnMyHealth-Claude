/**
 * CostOptimization - Insurance Cost Tracking & AI Recommendations
 *
 * Comprehensive cost optimization dashboard that allows users to:
 * - Track deductible and out-of-pocket spending progress
 * - Manage projected healthcare expenses
 * - Get AI-powered cost analysis and optimization recommendations
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign,
  Plus,
  Sparkles,
  Loader2,
  Edit2,
  Trash2,
  TrendingUp,
  AlertCircle,
  Calendar,
  CheckCircle,
} from 'lucide-react';
import {
  expensesApi,
  ExpenseProjectionData,
  CostAnalysisData,
  InsurancePlanData,
} from '../../services/api';
import ExpenseProjectionModal from './ExpenseProjectionModal';
import DeductibleProgressBar from './DeductibleProgressBar';

interface CostOptimizationProps {
  plan: InsurancePlanData;
  onPlanUpdate?: () => void;
}

export default function CostOptimization({ plan, onPlanUpdate: _onPlanUpdate }: CostOptimizationProps) {
  const [projections, setProjections] = useState<ExpenseProjectionData[]>([]);
  const [analyses, setAnalyses] = useState<CostAnalysisData[]>([]);
  const [isLoadingProjections, setIsLoadingProjections] = useState(true);
  const [isLoadingAnalyses, setIsLoadingAnalyses] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProjection, setEditingProjection] = useState<ExpenseProjectionData | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expandedAnalysisId, setExpandedAnalysisId] = useState<string | null>(null);

  // Load projections
  const loadProjections = useCallback(async () => {
    setIsLoadingProjections(true);
    setError(null);
    try {
      const data = await expensesApi.getProjections(plan.id);
      setProjections(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expense projections');
    } finally {
      setIsLoadingProjections(false);
    }
  }, [plan.id]);

  // Load analyses
  const loadAnalyses = useCallback(async () => {
    setIsLoadingAnalyses(true);
    try {
      const data = await expensesApi.getAnalyses(plan.id);
      setAnalyses(data);
      // Auto-expand the most recent analysis
      if (data.length > 0) {
        setExpandedAnalysisId(data[0].id);
      }
    } catch (err) {
      // Silent fail for analyses - not critical
      console.error('Failed to load analyses:', err);
    } finally {
      setIsLoadingAnalyses(false);
    }
  }, [plan.id]);

  // Initial load
  useEffect(() => {
    loadProjections();
    loadAnalyses();
  }, [loadProjections, loadAnalyses]);

  // Auto-hide success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleAddProjection = () => {
    setEditingProjection(null);
    setIsModalOpen(true);
  };

  const handleEditProjection = (projection: ExpenseProjectionData) => {
    setEditingProjection(projection);
    setIsModalOpen(true);
  };

  const handleDeleteProjection = async (id: string) => {
    if (!confirm('Are you sure you want to delete this expense projection?')) {
      return;
    }

    setDeletingId(id);
    setError(null);
    try {
      await expensesApi.deleteProjection(id);
      setSuccessMessage('Projection deleted');
      await loadProjections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete projection');
    } finally {
      setDeletingId(null);
    }
  };

  const handleModalSuccess = async () => {
    setSuccessMessage(editingProjection ? 'Projection updated' : 'Projection added');
    await loadProjections();
  };

  const handleAnalyzeCosts = async () => {
    if (projections.length === 0) {
      setError('Please add at least one expense projection before analyzing costs');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    try {
      const analysis = await expensesApi.analyzeCosts({
        planId: plan.id,
        projections,
      });
      setSuccessMessage('Cost analysis complete');
      setExpandedAnalysisId(analysis.id);
      await loadAnalyses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze costs');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const totalProjectedAnnual = (projections || []).reduce(
    (sum, p) => sum + p.estimatedCost * p.frequencyPerYear,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Cost Optimization</h2>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
            Track spending and optimize your healthcare costs
          </p>
        </div>
        <button
          onClick={handleAddProjection}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="hidden sm:inline">Add Expense</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 dark:text-green-200">{successMessage}</p>
        </div>
      )}

      {/* Deductible & OOP Progress */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Annual Spending Progress
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <DeductibleProgressBar
            label="Individual Deductible"
            current={plan.deductibleMetIndividual || 0}
            total={plan.deductibleIndividual}
            type="deductible"
          />
          <DeductibleProgressBar
            label="Individual Out-of-Pocket Max"
            current={plan.oopMetIndividual || 0}
            total={plan.oopMaxIndividual}
            type="oop"
          />
        </div>
      </div>

      {/* Expense Projections */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Projected Expenses
          </h3>
          {projections.length > 0 && (
            <div className="text-sm text-gray-600 dark:text-slate-400">
              <span className="font-semibold text-gray-900 dark:text-white">
                {formatCurrency(totalProjectedAnnual)}
              </span>
              /year
            </div>
          )}
        </div>

        {isLoadingProjections ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : projections.length === 0 ? (
          <div className="text-center py-12">
            <DollarSign className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-slate-400 mb-4">
              No expense projections yet
            </p>
            <button
              onClick={handleAddProjection}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add your first projection
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {projections.map((projection) => (
              <div
                key={projection.id}
                className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200 dark:border-slate-600"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-gray-900 dark:text-white truncate">
                      {projection.serviceType}
                    </h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        projection.isInNetwork
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                      }`}
                    >
                      {projection.isInNetwork ? 'In-Network' : 'Out-of-Network'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-slate-400">
                    <span>
                      {formatCurrency(projection.estimatedCost)} × {projection.frequencyPerYear}
                      /year
                    </span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      = {formatCurrency(projection.estimatedCost * projection.frequencyPerYear)}/year
                    </span>
                  </div>
                  {projection.notes && (
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1 truncate">
                      {projection.notes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => handleEditProjection(projection)}
                    className="p-2 text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-slate-600 rounded transition-colors"
                    title="Edit projection"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteProjection(projection.id)}
                    disabled={deletingId === projection.id}
                    className="p-2 text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
                    title="Delete projection"
                  >
                    {deletingId === projection.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AI Analysis Button */}
        {projections.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-slate-700">
            <button
              onClick={handleAnalyzeCosts}
              disabled={isAnalyzing}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Analyzing with AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  <span>Get AI Cost Optimization Recommendations</span>
                </>
              )}
            </button>
            <p className="text-xs text-center text-gray-500 dark:text-slate-500 mt-2">
              AI will analyze your projections and suggest ways to reduce costs
            </p>
          </div>
        )}
      </div>

      {/* AI Analyses History */}
      {analyses.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Cost Analysis History
            </h3>
          </div>

          {isLoadingAnalyses ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {analyses.map((analysis) => (
                <div
                  key={analysis.id}
                  className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedAnalysisId(
                        expandedAnalysisId === analysis.id ? null : analysis.id
                      )
                    }
                    className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 hover:from-purple-100 hover:to-indigo-100 dark:hover:from-purple-900/30 dark:hover:to-indigo-900/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-gray-600 dark:text-slate-400" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatDate(analysis.createdAt)}
                      </span>
                      <span className="text-sm text-gray-600 dark:text-slate-400">
                        Projected OOP: {formatCurrency(analysis.totalProjectedOop)}
                      </span>
                    </div>
                    <span className="text-xs text-purple-600 dark:text-purple-400">
                      {expandedAnalysisId === analysis.id ? 'Hide' : 'View'}
                    </span>
                  </button>
                  {expandedAnalysisId === analysis.id && (
                    <div className="p-4 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <div className="whitespace-pre-wrap text-gray-700 dark:text-slate-300">
                          {analysis.claudeResponse}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expense Projection Modal */}
      <ExpenseProjectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
        planId={plan.id}
        projection={editingProjection}
      />
    </div>
  );
}
