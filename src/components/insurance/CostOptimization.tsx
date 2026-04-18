/**
 * CostOptimization - Insurance Cost Tracking & AI Recommendations
 *
 * Comprehensive cost optimization dashboard that allows users to:
 * - Track deductible and out-of-pocket spending progress
 * - Manage projected healthcare expenses
 * - Get AI-powered cost analysis and optimization recommendations
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Clock,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  expensesApi,
  ExpenseProjectionData,
  ExpenseActualData,
  CostAnalysisData,
  InsurancePlanData,
} from '../../services/api';
import ExpenseProjectionModal from './ExpenseProjectionModal';
import DeductibleProgressBar from './DeductibleProgressBar';
import ExpenseActualsList from './ExpenseActualsList';

// ---------- Helpers: timeline + AI section parsing ----------

interface TimelinePoint {
  month: string;
  projected: number;
  actual: number | null;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Build 12-month timeline series.
 * - projected: cumulative evenly-distributed total (total_annual / 12 × month).
 * - actual:    cumulative sum of actuals.patientPaid grouped by month of
 *              serviceDate. Null for months past the latest actual (so the
 *              area fill ends where the data does instead of flatlining).
 */
function buildTimeline(
  projections: ExpenseProjectionData[],
  actuals: ExpenseActualData[]
): TimelinePoint[] {
  const totalAnnual = projections.reduce(
    (sum, p) => sum + p.estimatedCost * p.frequencyPerYear,
    0
  );
  const perMonth = totalAnnual / 12;

  // Sum patientPaid per calendar month of serviceDate.
  const monthlyActual = new Array<number>(12).fill(0);
  let latestMonthWithActual = -1;
  for (const a of actuals) {
    if (!a.serviceDate || a.patientPaid === null) continue;
    const d = new Date(a.serviceDate);
    if (Number.isNaN(d.getTime())) continue;
    const m = d.getMonth();
    monthlyActual[m] += a.patientPaid;
    if (m > latestMonthWithActual) latestMonthWithActual = m;
  }

  let cumulative = 0;
  return MONTH_LABELS.map((month, idx) => {
    cumulative += monthlyActual[idx];
    return {
      month,
      projected: Math.round(perMonth * (idx + 1)),
      actual: idx <= latestMonthWithActual ? Math.round(cumulative) : null,
    };
  });
}

interface AnalysisSection {
  title: string;
  content: string;
  Icon: LucideIcon;
}

const SECTION_ICONS: Array<{ match: RegExp; Icon: LucideIcon }> = [
  { match: /out[-\s]?of[-\s]?pocket|oop|projection/i, Icon: DollarSign },
  { match: /timeline|milestone/i, Icon: Calendar },
  { match: /strategic|timing|schedule/i, Icon: Clock },
  { match: /optimization|tip|saving/i, Icon: Sparkles },
  { match: /action|next step|to[-\s]?do/i, Icon: CheckCircle },
];

function iconFor(title: string): LucideIcon {
  for (const { match, Icon } of SECTION_ICONS) {
    if (match.test(title)) return Icon;
  }
  return Sparkles;
}

/**
 * Split a Claude analysis response into `### N. Title` sections. Returns
 * an empty array when no numbered headings are found — callers fall back
 * to rendering the raw markdown.
 */
function parseAnalysisSections(markdown: string): AnalysisSection[] {
  if (!markdown) return [];
  // Match at line start: "### 1. Title" (allow optional ** wrapping).
  const pattern = /(?:^|\n)#{2,3}\s*\d+\.\s*\**(.+?)\**\s*\n([\s\S]*?)(?=\n#{2,3}\s*\d+\.|\n?$)/g;
  const sections: AnalysisSection[] = [];
  for (const match of markdown.matchAll(pattern)) {
    const title = match[1].trim();
    const content = match[2].trim();
    if (title && content) {
      sections.push({ title, content, Icon: iconFor(title) });
    }
  }
  return sections;
}

interface CostOptimizationProps {
  plan: InsurancePlanData;
  onPlanUpdate?: () => void;
}

export default function CostOptimization({ plan, onPlanUpdate: _onPlanUpdate }: CostOptimizationProps) {
  const [projections, setProjections] = useState<ExpenseProjectionData[]>([]);
  const [actuals, setActuals] = useState<ExpenseActualData[]>([]);
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
      setProjections(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expense projections');
      setProjections([]);
    } finally {
      setIsLoadingProjections(false);
    }
  }, [plan.id]);

  // Load analyses
  const loadAnalyses = useCallback(async () => {
    setIsLoadingAnalyses(true);
    try {
      const data = await expensesApi.getAnalyses(plan.id);
      setAnalyses(data || []);
      // Auto-expand the most recent analysis
      if (data && data.length > 0) {
        setExpandedAnalysisId(data[0].id);
      }
    } catch (err) {
      // Silent fail for analyses - not critical
      console.error('Failed to load analyses:', err);
      setAnalyses([]);
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

  const timeline = useMemo(
    () => buildTimeline(projections || [], actuals || []),
    [projections, actuals]
  );
  const hasProjectionData = totalProjectedAnnual > 0;
  const hasActualData = actuals.some((a) => a.patientPaid !== null);

  // Projection-vs-actual comparison: match actuals to projections by
  // projectionId when set, else by normalized-serviceType.
  const comparison = useMemo(() => {
    const normalize = (s: string) => s.trim().toLowerCase();
    const byProjection = new Map<string, ExpenseActualData[]>();
    const unplanned: ExpenseActualData[] = [];

    for (const a of actuals) {
      let match: ExpenseProjectionData | undefined;
      if (a.projectionId) {
        match = projections.find((p) => p.id === a.projectionId);
      }
      if (!match) {
        match = projections.find((p) => normalize(p.serviceType) === normalize(a.serviceType));
      }
      if (match) {
        const list = byProjection.get(match.id) ?? [];
        list.push(a);
        byProjection.set(match.id, list);
      } else {
        unplanned.push(a);
      }
    }

    return {
      byProjection,
      unplanned,
      unplannedTotal: unplanned.reduce((sum, a) => sum + (a.patientPaid ?? 0), 0),
    };
  }, [projections, actuals]);

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

      {/* Spending Timeline */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Spending Timeline</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Projected cumulative spend over the plan year
            </p>
          </div>
        </div>
        {hasProjectionData ? (
          <>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="projectedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.55} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-slate-700" opacity={0.35} />
                  <XAxis
                    dataKey="month"
                    stroke="currentColor"
                    className="text-gray-500 dark:text-slate-400"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="currentColor"
                    className="text-gray-500 dark:text-slate-400"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid rgba(148,163,184,0.3)',
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="projected"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    fill="url(#projectedFill)"
                    name="Projected"
                  />
                  {hasActualData && (
                    <Area
                      type="monotone"
                      dataKey="actual"
                      stroke="#059669"
                      strokeWidth={2}
                      fill="url(#actualFill)"
                      name="Actual"
                      connectNulls={false}
                    />
                  )}
                  {plan.deductibleIndividual > 0 && (
                    <ReferenceLine
                      y={plan.deductibleIndividual}
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                      label={{
                        value: `Deductible ${formatCurrency(plan.deductibleIndividual)}`,
                        position: 'insideTopLeft',
                        fill: '#f59e0b',
                        fontSize: 10,
                      }}
                    />
                  )}
                  {plan.oopMaxIndividual > 0 && (
                    <ReferenceLine
                      y={plan.oopMaxIndividual}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{
                        value: `OOP max ${formatCurrency(plan.oopMaxIndividual)}`,
                        position: 'insideTopLeft',
                        fill: '#ef4444',
                        fontSize: 10,
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-gray-500 dark:text-slate-500 mt-2">
              {hasActualData
                ? 'Solid area = actuals to date. Dashed line = full-year projection.'
                : 'Add expense actuals below to see your real spending trend.'}
            </p>
          </>
        ) : (
          <div className="text-center py-8 text-sm text-gray-500 dark:text-slate-400">
            Add an expense projection to see a projected spending timeline.
          </div>
        )}
      </div>

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

      {/* Expense Actuals (recorded claims / EOBs) */}
      <ExpenseActualsList planId={plan.id} onActualsChange={setActuals} />

      {/* Projection vs Actual Comparison */}
      {projections.length > 0 && (actuals.length > 0 || comparison.unplanned.length > 0) && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Projection vs Actual
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projections.map((p) => {
              const annualProjected = p.estimatedCost * p.frequencyPerYear;
              const matches = comparison.byProjection.get(p.id) ?? [];
              const actualTotal = matches.reduce((sum, a) => sum + (a.patientPaid ?? 0), 0);
              const hasActuals = matches.length > 0;
              const variance = annualProjected - actualTotal;
              const underBudget = variance >= 0;
              return (
                <div
                  key={p.id}
                  className="p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200 dark:border-slate-600"
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h4 className="font-medium text-gray-900 dark:text-white truncate">{p.serviceType}</h4>
                    {hasActuals ? (
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${
                          underBudget
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        }`}
                      >
                        {underBudget ? 'Under' : 'Over'} by {formatCurrency(Math.abs(variance))}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-slate-500 italic flex-shrink-0">
                        No actuals recorded
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-gray-600 dark:text-slate-400">
                      <span>Projected</span>
                      <span>
                        {formatCurrency(p.estimatedCost)} × {p.frequencyPerYear}/yr ={' '}
                        {formatCurrency(annualProjected)}
                      </span>
                    </div>
                    <div className="flex justify-between text-gray-900 dark:text-white font-medium">
                      <span>Actual to date</span>
                      <span>{hasActuals ? formatCurrency(actualTotal) : '--'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {comparison.unplanned.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Unplanned expenses</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    {comparison.unplanned.length} claim
                    {comparison.unplanned.length === 1 ? '' : 's'} with no matching projection
                  </p>
                </div>
                <span className="text-lg font-semibold text-orange-600 dark:text-orange-400">
                  {formatCurrency(comparison.unplannedTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Analyses History */}
      {analyses && analyses.length > 0 && (
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
                      <AnalysisBody markdown={analysis.claudeResponse} />
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

// ---------- Analysis rendering ----------

/**
 * Renders a Claude cost analysis response as collapsible sections.
 * Falls back to the original whitespace-pre-wrap rendering when the
 * response doesn't use numbered `### N.` headers (older format).
 */
function AnalysisBody({ markdown }: { markdown: string }) {
  const sections = useMemo(() => parseAnalysisSections(markdown), [markdown]);
  // First two sections expanded by default.
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set([0, 1]));

  if (sections.length === 0) {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <div className="whitespace-pre-wrap text-gray-700 dark:text-slate-300">{markdown}</div>
      </div>
    );
  }

  const toggle = (idx: number) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {sections.map((section, idx) => {
        const isOpen = openIds.has(idx);
        const Icon = section.Icon;
        return (
          <div
            key={idx}
            className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden"
          >
            <button
              onClick={() => toggle(idx)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {section.title}
                </span>
              </div>
              {isOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
              )}
            </button>
            {isOpen && (
              <div className="px-4 py-3 whitespace-pre-wrap text-sm text-gray-700 dark:text-slate-300">
                {section.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
