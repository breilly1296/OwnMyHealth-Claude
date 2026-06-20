/**
 * GoalTrackerPanel - health goals UI wired to the real API.
 *
 * Replaces the previous sample-data prototype. Fetches via healthGoalsApi,
 * supports create / update-progress / status-change / delete, renders
 * per-goal progress AreaChart from server-supplied progressHistory, and
 * surfaces the biomarker-goal link from relatedBiomarkerId.
 *
 * Server-generated suggestions (from /health-goals/suggestions) are used
 * when available; a client-side computation from out-of-range biomarkers
 * is kept as a fallback so the UI still works before the first fetch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Award,
  Calendar,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Biomarker } from '../../types';
import {
  healthGoalsApi,
  type HealthGoalData,
  type CreateHealthGoalData,
  type GoalsSummary,
  type HealthGoalSuggestion,
} from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface GoalTrackerPanelProps {
  biomarkers: Biomarker[];
  /** Optional — when provided, "View Biomarker" links route via this. */
  onBiomarkerClick?: (biomarker: Biomarker) => void;
}

// The service type HealthGoalData doesn't declare progressHistory even
// though the backend includes it in GET responses (confirmed in
// healthGoalsController.ts toResponse). Extend locally so we can read
// the field without modifying the API service file.
interface ProgressEntry {
  id: string;
  value: number;
  progress: number;
  note: string | null;
  recordedAt: string;
}
type HealthGoalWithHistory = HealthGoalData & {
  progressHistory?: ProgressEntry[];
};

type GoalStatus = HealthGoalData['status'];
type GoalDirection = HealthGoalData['direction'];

const STATUS_BADGE: Record<GoalStatus, { cls: string; label: string }> = {
  ACTIVE: {
    cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    label: 'Active',
  },
  PAUSED: {
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    label: 'Paused',
  },
  ACHIEVED: {
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    label: 'Achieved',
  },
  FAILED: {
    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    label: 'Failed',
  },
  CANCELLED: {
    cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
    label: 'Cancelled',
  },
};

function daysRemaining(targetDate: string): number {
  const target = new Date(targetDate);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDaysRemaining(days: number): string {
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} remaining`;
  if (days === 0) return 'Due today';
  return `Overdue by ${Math.abs(days)} day${days === -1 ? '' : 's'}`;
}

/** Trend classifier for the progress chart fill color. */
function progressTrend(
  history: ProgressEntry[] | undefined,
  direction: GoalDirection
): 'positive' | 'stagnant' | 'negative' {
  if (!history || history.length < 2) return 'stagnant';
  const first = history[0].value;
  const last = history[history.length - 1].value;
  if (direction === 'INCREASE') {
    if (last > first) return 'positive';
    if (last < first) return 'negative';
    return 'stagnant';
  }
  if (direction === 'DECREASE') {
    if (last < first) return 'positive';
    if (last > first) return 'negative';
    return 'stagnant';
  }
  // MAINTAIN: stagnant is positive, movement is negative
  return first === last ? 'positive' : 'stagnant';
}

const TREND_COLORS = {
  positive: { stroke: '#10b981', fill: '#10b98155' },
  stagnant: { stroke: '#f59e0b', fill: '#f59e0b55' },
  negative: { stroke: '#ef4444', fill: '#ef444455' },
};

function progressBarColor(progress: number, status: GoalStatus): string {
  if (status === 'ACHIEVED') return 'bg-emerald-500';
  if (status === 'CANCELLED' || status === 'FAILED') return 'bg-slate-300 dark:bg-slate-600';
  if (progress >= 75) return 'bg-emerald-500';
  if (progress >= 50) return 'bg-sky-500';
  if (progress >= 25) return 'bg-amber-500';
  return 'bg-rose-500';
}

interface ClientSuggestion {
  name: string;
  description: string;
  category: string;
  unit: string;
  direction: GoalDirection;
  targetValue: number;
  biomarkerId: string;
  currentValue: number;
}

function clientSuggestionsFromBiomarkers(biomarkers: Biomarker[]): ClientSuggestion[] {
  return biomarkers
    .filter((b) => b.value < b.normalRange.min || b.value > b.normalRange.max)
    .map((b): ClientSuggestion => {
      const isLow = b.value < b.normalRange.min;
      const mid = (b.normalRange.min + b.normalRange.max) / 2;
      return {
        name: `Optimize ${b.name}`,
        description: `Bring ${b.name} into the normal range (${b.normalRange.min}–${b.normalRange.max} ${b.unit})`,
        category: b.category,
        unit: b.unit,
        direction: isLow ? 'INCREASE' : 'DECREASE',
        targetValue: Math.round(mid * 10) / 10,
        biomarkerId: b.id,
        currentValue: b.value,
      };
    });
}

// ---------- component ----------

export default function GoalTrackerPanel({ biomarkers, onBiomarkerClick }: GoalTrackerPanelProps) {
  const [goals, setGoals] = useState<HealthGoalWithHistory[]>([]);
  const [summary, setSummary] = useState<GoalsSummary | null>(null);
  const [serverSuggestions, setServerSuggestions] = useState<HealthGoalSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const [selectedGoal, setSelectedGoal] = useState<HealthGoalWithHistory | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<Partial<CreateHealthGoalData> | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  const biomarkerById = useMemo(() => {
    const map = new Map<string, Biomarker>();
    for (const b of biomarkers) map.set(b.id, b);
    return map;
  }, [biomarkers]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [goalsData, summaryData] = await Promise.all([
        healthGoalsApi.getAll(),
        healthGoalsApi.getSummary().catch(() => null),
      ]);
      setGoals((goalsData as HealthGoalWithHistory[]) || []);
      if (summaryData) setSummary(summaryData);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load goals'));
      setGoals([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    setIsLoadingSuggestions(true);
    try {
      const data = await healthGoalsApi.getSuggestions();
      setServerSuggestions(data || []);
    } catch {
      // Silent — fall back to client-side suggestions.
      setServerSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadSuggestions();
  }, [load, loadSuggestions]);

  // Refresh selected-goal reference when the goals list changes so the
  // detail modal always shows the latest progress.
  useEffect(() => {
    if (selectedGoal) {
      const fresh = goals.find((g) => g.id === selectedGoal.id);
      if (fresh && fresh !== selectedGoal) setSelectedGoal(fresh);
    }
  }, [goals, selectedGoal]);

  const activeGoals = goals.filter((g) => g.status === 'ACTIVE' || g.status === 'PAUSED');
  const completedGoals = goals.filter((g) => g.status === 'ACHIEVED');

  const derivedSummary = useMemo(
    () => ({
      active: summary?.active ?? activeGoals.length,
      completed: summary?.achieved ?? completedGoals.length,
      // The backend summary doesn't carry an average-progress figure, so it's
      // always computed client-side from the loaded active goals.
      avgProgress:
        activeGoals.length > 0
          ? Math.round(activeGoals.reduce((s, g) => s + g.progress, 0) / activeGoals.length)
          : 0,
    }),
    [summary, activeGoals, completedGoals]
  );

  // Use server suggestions when we got them; otherwise fall back to client compute.
  const clientSuggestions = useMemo(
    () => clientSuggestionsFromBiomarkers(biomarkers),
    [biomarkers]
  );
  const effectiveSuggestions = serverSuggestions.length > 0 ? serverSuggestions : clientSuggestions;

  // ----- mutations -----

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this goal?')) return;
    setMutatingId(id);
    try {
      await healthGoalsApi.delete(id);
      setGoals((prev) => prev.filter((g) => g.id !== id));
      if (selectedGoal?.id === id) setSelectedGoal(null);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete goal'));
    } finally {
      setMutatingId(null);
    }
  };

  const handleStatusChange = async (id: string, status: GoalStatus) => {
    setMutatingId(id);
    try {
      const updated = (await healthGoalsApi.update(id, { status })) as HealthGoalWithHistory;
      setGoals((prev) => prev.map((g) => (g.id === id ? updated : g)));
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update status'));
    } finally {
      setMutatingId(null);
    }
  };

  const handleProgressUpdate = async (id: string, value: number, note?: string) => {
    setMutatingId(id);
    try {
      const updated = (await healthGoalsApi.updateProgress(id, { value, note })) as HealthGoalWithHistory;
      setGoals((prev) => prev.map((g) => (g.id === id ? updated : g)));
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update progress'));
    } finally {
      setMutatingId(null);
    }
  };

  const handleCreate = async (data: CreateHealthGoalData) => {
    try {
      const created = (await healthGoalsApi.create(data)) as HealthGoalWithHistory;
      setGoals((prev) => [created, ...prev]);
      setShowCreateModal(false);
      setCreatePrefill(null);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create goal'));
      throw err;
    }
  };

  const handleAddFromSuggestion = (suggestion: ClientSuggestion | HealthGoalSuggestion) => {
    const today = new Date().toISOString().split('T')[0];
    const targetDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const isClient = 'biomarkerId' in suggestion;

    if (isClient) {
      setCreatePrefill({
        name: suggestion.name,
        description: suggestion.description,
        category: suggestion.category,
        unit: suggestion.unit,
        direction: suggestion.direction as GoalDirection,
        targetValue: suggestion.targetValue,
        startValue: suggestion.currentValue,
        startDate: today,
        targetDate,
        relatedBiomarkerId: suggestion.biomarkerId,
      });
    } else {
      // Server suggestion: targetValue is precomputed (midpoint of normal
      // range) and relatedBiomarkerId points at the user's biomarker so
      // we can pull the current value as startValue without a round-trip.
      // Empty relatedBiomarkerId means it's a generic non-biomarker
      // suggestion (e.g., "Maintain Healthy Blood Pressure").
      const linkedBiomarker = suggestion.relatedBiomarkerId
        ? biomarkerById.get(suggestion.relatedBiomarkerId)
        : undefined;
      setCreatePrefill({
        name: suggestion.name,
        description: suggestion.description,
        category: suggestion.category,
        unit: suggestion.unit,
        direction: suggestion.direction as GoalDirection,
        targetValue: suggestion.targetValue,
        startValue: linkedBiomarker?.value,
        startDate: today,
        targetDate,
        relatedBiomarkerId: suggestion.relatedBiomarkerId || undefined,
      });
    }
    setShowCreateModal(true);
  };

  // ----- rendering -----

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-brand-500" />
            Health Goals
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track progress towards your health targets
          </p>
        </div>
        <button
          onClick={() => {
            setCreatePrefill(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Goal
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200 flex-1">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-600 dark:text-red-400"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Target className="w-5 h-5 text-sky-500" />} iconBg="bg-sky-50 dark:bg-sky-900/30" value={derivedSummary.active} label="Active" />
        <StatCard icon={<Award className="w-5 h-5 text-emerald-500" />} iconBg="bg-emerald-50 dark:bg-emerald-900/30" value={derivedSummary.completed} label="Completed" />
        <StatCard icon={<Activity className="w-5 h-5 text-amber-500" />} iconBg="bg-amber-50 dark:bg-amber-900/30" value={`${derivedSummary.avgProgress}%`} label="Avg progress" />
        <StatCard icon={<TrendingUp className="w-5 h-5 text-purple-500" />} iconBg="bg-purple-50 dark:bg-purple-900/30" value={effectiveSuggestions.length} label="Suggestions" />
      </div>

      {/* Active goals */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        </div>
      ) : activeGoals.length > 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Active goals</h3>
          <div className="space-y-4">
            {activeGoals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                biomarker={goal.relatedBiomarkerId ? biomarkerById.get(goal.relatedBiomarkerId) : undefined}
                onClick={() => setSelectedGoal(goal)}
                onBiomarkerClick={onBiomarkerClick}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Completed goals (collapsible, kept simple) */}
      {completedGoals.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-500" />
            Completed ({completedGoals.length})
          </h3>
          <div className="space-y-2">
            {completedGoals.map((goal) => (
              <div
                key={goal.id}
                className="flex items-center justify-between p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white truncate">{goal.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {goal.completedAt ? `Completed ${new Date(goal.completedAt).toLocaleDateString()}` : 'Completed'}
                  </p>
                </div>
                <Check className="w-5 h-5 text-emerald-500" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {!isLoadingSuggestions && effectiveSuggestions.length > 0 && (() => {
        const initialVisible = 3;
        const visibleSuggestions = showAllSuggestions
          ? effectiveSuggestions
          : effectiveSuggestions.slice(0, initialVisible);
        const hasMore = effectiveSuggestions.length > initialVisible;
        return (
        <div className="bg-gradient-to-br from-brand-50 to-purple-50 dark:from-slate-800 dark:to-slate-800 rounded-2xl border border-brand-200/60 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-brand-500" />
            Suggested goals
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            {serverSuggestions.length > 0
              ? 'Based on your biomarkers (server-generated)'
              : 'Based on your out-of-range biomarkers'}
          </p>
          <div className="space-y-3">
            {visibleSuggestions.map((suggestion, idx) => (
              <div
                key={idx}
                className="bg-white/80 dark:bg-slate-800/80 backdrop-blur p-4 rounded-xl border border-slate-200/60 dark:border-slate-700 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-slate-900 dark:text-white">{suggestion.name}</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {suggestion.description}
                  </p>
                </div>
                <button
                  onClick={() => handleAddFromSuggestion(suggestion)}
                  className="px-3 py-1.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors flex-shrink-0"
                >
                  Add goal
                </button>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setShowAllSuggestions((v) => !v)}
              className="mt-4 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
            >
              {showAllSuggestions
                ? 'Show fewer'
                : `View all ${effectiveSuggestions.length} suggestions`}
            </button>
          )}
        </div>
        );
      })()}

      {/* Empty state */}
      {!isLoading && goals.length === 0 && effectiveSuggestions.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-12 text-center">
          <Target className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No goals yet</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
            Start tracking your health journey by setting personalized goals based on your biomarkers.
          </p>
          <button
            onClick={() => {
              setCreatePrefill(null);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            Create your first goal
          </button>
        </div>
      )}

      {/* Detail modal */}
      {selectedGoal && (
        <GoalDetailModal
          goal={selectedGoal}
          biomarker={selectedGoal.relatedBiomarkerId ? biomarkerById.get(selectedGoal.relatedBiomarkerId) : undefined}
          isMutating={mutatingId === selectedGoal.id}
          onClose={() => setSelectedGoal(null)}
          onProgressUpdate={(v, note) => handleProgressUpdate(selectedGoal.id, v, note)}
          onStatusChange={(status) => handleStatusChange(selectedGoal.id, status)}
          onDelete={() => handleDelete(selectedGoal.id)}
          onBiomarkerClick={onBiomarkerClick}
        />
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateGoalModal
          biomarkers={biomarkers}
          prefill={createPrefill}
          onClose={() => {
            setShowCreateModal(false);
            setCreatePrefill(null);
          }}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}

// ---------- sub-components ----------

function StatCard({ icon, iconBg, value, label }: { icon: React.ReactNode; iconBg: string; value: number | string; label: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>{icon}</div>
        <div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

interface GoalCardProps {
  goal: HealthGoalWithHistory;
  biomarker: Biomarker | undefined;
  onClick: () => void;
  onBiomarkerClick?: (b: Biomarker) => void;
}

function GoalCard({ goal, biomarker, onClick, onBiomarkerClick }: GoalCardProps) {
  const status = STATUS_BADGE[goal.status];
  const days = daysRemaining(goal.targetDate);
  const daysOverdue = days < 0;
  const trend = progressTrend(goal.progressHistory, goal.direction);
  const trendColor = TREND_COLORS[trend];
  const hasHistory = (goal.progressHistory?.length ?? 0) >= 2;

  return (
    <div
      onClick={onClick}
      className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-brand-200 dark:hover:border-brand-500 hover:bg-brand-50/30 dark:hover:bg-brand-900/10 cursor-pointer transition-all"
    >
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h4 className="font-medium text-slate-900 dark:text-white">{goal.name}</h4>
            <span className={`text-xs px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
          </div>
          {goal.description && (
            <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-1">{goal.description}</p>
          )}
        </div>
        {hasHistory && (
          <div className="flex-shrink-0 hidden sm:block" style={{ width: 200, height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={goal.progressHistory!.map((h) => ({
                  date: new Date(h.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                  value: h.value,
                }))}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <XAxis dataKey="date" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip
                  formatter={(value) => `${value} ${goal.unit}`}
                  labelStyle={{ fontSize: 10 }}
                  contentStyle={{ fontSize: 11, borderRadius: 6, padding: '4px 8px' }}
                />
                <ReferenceLine y={goal.targetValue} stroke="#10b981" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="value" stroke={trendColor.stroke} fill={trendColor.fill} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
      </div>

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-600 dark:text-slate-300">
            {goal.currentValue ?? goal.startValue ?? '--'} {goal.unit}
            {biomarker && (
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                · biomarker: {biomarker.value} {biomarker.unit}
              </span>
            )}
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            Target: {goal.targetValue} {goal.unit}
          </span>
        </div>
        <div className="relative h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${progressBarColor(goal.progress, goal.status)}`}
            style={{ width: `${Math.min(goal.progress, 100)}%` }}
          />
          {/* Milestone markers */}
          {goal.milestones?.map((m, idx) => {
            // Position milestone marker at its projected progress fraction.
            // Use a simple linear interp from start→target.
            const start = goal.startValue ?? goal.currentValue ?? 0;
            const span = goal.targetValue - start;
            if (span === 0) return null;
            const pct = Math.max(0, Math.min(100, ((m.value - start) / span) * 100));
            return (
              <div
                key={idx}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border ${
                  m.achieved
                    ? 'bg-emerald-500 border-emerald-700'
                    : 'bg-white dark:bg-slate-900 border-slate-400'
                }`}
                style={{ left: `${pct}%` }}
                title={`${m.label} (${m.value} ${goal.unit})`}
              />
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
          {goal.direction === 'DECREASE' ? (
            <TrendingDown className="w-4 h-4 text-emerald-500" />
          ) : goal.direction === 'INCREASE' ? (
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          ) : (
            <Activity className="w-4 h-4 text-emerald-500" />
          )}
          {Math.round(goal.progress)}% complete
        </span>
        <span
          className={`inline-flex items-center gap-1 ${
            daysOverdue ? 'text-red-600 dark:text-red-400' : days < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Calendar className="w-4 h-4" />
          {formatDaysRemaining(days)}
        </span>
      </div>

      {biomarker && onBiomarkerClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBiomarkerClick(biomarker);
          }}
          className="mt-2 text-xs text-brand-600 dark:text-brand-400 hover:underline"
        >
          View biomarker →
        </button>
      )}
    </div>
  );
}

// ---------- detail modal ----------

interface GoalDetailModalProps {
  goal: HealthGoalWithHistory;
  biomarker: Biomarker | undefined;
  isMutating: boolean;
  onClose: () => void;
  onProgressUpdate: (value: number, note?: string) => Promise<void>;
  onStatusChange: (status: GoalStatus) => void;
  onDelete: () => void;
  onBiomarkerClick?: (b: Biomarker) => void;
}

function GoalDetailModal({
  goal,
  biomarker,
  isMutating,
  onClose,
  onProgressUpdate,
  onStatusChange,
  onDelete,
  onBiomarkerClick,
}: GoalDetailModalProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [progressValue, setProgressValue] = useState<string>(
    goal.currentValue !== null ? String(goal.currentValue) : ''
  );
  const [progressNote, setProgressNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const history = goal.progressHistory ?? [];
  const hasHistory = history.length >= 1;
  const trend = progressTrend(history, goal.direction);
  const trendColor = TREND_COLORS[trend];

  const handleProgressSave = async () => {
    const v = parseFloat(progressValue);
    if (!Number.isFinite(v)) return;
    setIsSaving(true);
    try {
      await onProgressUpdate(v, progressNote.trim() || undefined);
      setProgressNote('');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-detail-modal-title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="goal-detail-modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">{goal.name}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{goal.category}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Progress chart */}
          {hasHistory && history.length > 1 && (
            <div>
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Progress over time</h4>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={history.map((h) => ({
                      date: new Date(h.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                      value: h.value,
                    }))}
                  >
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" domain={['auto', 'auto']} />
                    <Tooltip formatter={(value) => `${value} ${goal.unit}`} />
                    <ReferenceLine
                      y={goal.targetValue}
                      stroke="#10b981"
                      strokeDasharray="3 3"
                      label={{ value: 'Target', position: 'right', fontSize: 10, fill: '#10b981' }}
                    />
                    <Area type="monotone" dataKey="value" stroke={trendColor.stroke} fill={trendColor.fill} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Values grid */}
          <div className="grid grid-cols-2 gap-4">
            <StatTile label="Start value" value={goal.startValue !== null ? `${goal.startValue} ${goal.unit}` : '--'} />
            <StatTile label="Current value" value={goal.currentValue !== null ? `${goal.currentValue} ${goal.unit}` : '--'} />
            <StatTile label="Target value" value={`${goal.targetValue} ${goal.unit}`} accent="emerald" />
            <StatTile label="Progress" value={`${Math.round(goal.progress)}%`} accent="brand" />
          </div>

          {biomarker && (
            <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Linked biomarker</p>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {biomarker.name}: {biomarker.value} {biomarker.unit}
                </p>
              </div>
              {onBiomarkerClick && (
                <button
                  onClick={() => {
                    onBiomarkerClick(biomarker);
                    onClose();
                  }}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                >
                  View →
                </button>
              )}
            </div>
          )}

          {/* Milestones */}
          {goal.milestones && goal.milestones.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Milestones</h4>
              <div className="space-y-2">
                {goal.milestones.map((m, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      m.achieved ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-slate-50 dark:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {m.achieved ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border-2 border-slate-300 dark:border-slate-600" />
                      )}
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{m.label}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {m.value} {goal.unit}
                        </p>
                      </div>
                    </div>
                    {m.achievedAt && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(m.achievedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Update progress */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Log progress</h4>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  step="any"
                  value={progressValue}
                  onChange={(e) => setProgressValue(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white text-sm"
                  placeholder={`Current value (${goal.unit})`}
                />
                <button
                  onClick={handleProgressSave}
                  disabled={isSaving || !progressValue}
                  className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50 text-sm font-medium"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                </button>
              </div>
              <input
                type="text"
                value={progressNote}
                onChange={(e) => setProgressNote(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white text-sm"
                placeholder="Note (optional)"
              />
            </div>
          </div>

          {/* Status + delete */}
          <div className="flex items-center justify-between gap-2 pt-4 border-t border-slate-200 dark:border-slate-700 flex-wrap">
            <select
              value={goal.status}
              onChange={(e) => onStatusChange(e.target.value as GoalStatus)}
              disabled={isMutating}
              className="px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white text-sm"
            >
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="ACHIEVED">Achieved</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <button
              onClick={onDelete}
              disabled={isMutating}
              className="px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Delete goal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'brand' }) {
  const valueCls =
    accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'brand'
      ? 'text-brand-600 dark:text-brand-400'
      : 'text-slate-900 dark:text-white';
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-bold ${valueCls}`}>{value}</p>
    </div>
  );
}

// ---------- create modal ----------

interface CreateGoalModalProps {
  biomarkers: Biomarker[];
  prefill: Partial<CreateHealthGoalData> | null;
  onClose: () => void;
  onSubmit: (data: CreateHealthGoalData) => Promise<void>;
}

function CreateGoalModal({ biomarkers, prefill, onClose, onSubmit }: CreateGoalModalProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const today = new Date().toISOString().split('T')[0];
  const sixMonths = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [form, setForm] = useState<CreateHealthGoalData>({
    name: prefill?.name ?? '',
    description: prefill?.description ?? '',
    category: prefill?.category ?? 'Other',
    targetValue: prefill?.targetValue ?? 0,
    startValue: prefill?.startValue,
    unit: prefill?.unit ?? '',
    direction: (prefill?.direction as GoalDirection) ?? 'DECREASE',
    relatedBiomarkerId: prefill?.relatedBiomarkerId,
    startDate: prefill?.startDate ?? today,
    targetDate: prefill?.targetDate ?? sixMonths,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = <K extends keyof CreateHealthGoalData>(field: K, value: CreateHealthGoalData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.unit.trim() || !form.category.trim()) {
      setFormError('Name, category, and unit are required');
      return;
    }
    if (!Number.isFinite(form.targetValue)) {
      setFormError('Target value must be a number');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await onSubmit({
        ...form,
        name: form.name.trim(),
        description: form.description?.trim() || undefined,
        category: form.category.trim(),
        unit: form.unit.trim(),
        relatedBiomarkerId: form.relatedBiomarkerId || undefined,
      });
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Failed to create goal'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-goal-modal-title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 id="create-goal-modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">Create health goal</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Goal name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="e.g., Lower blood pressure"
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Description</label>
            <textarea
              value={form.description ?? ''}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Category *</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => handleChange('category', e.target.value)}
                placeholder="e.g., Vital Signs"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Unit *</label>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => handleChange('unit', e.target.value)}
                placeholder="e.g., mmHg"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Target value *</label>
              <input
                type="number"
                step="any"
                value={form.targetValue}
                onChange={(e) => handleChange('targetValue', parseFloat(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Direction *</label>
              <select
                value={form.direction}
                onChange={(e) => handleChange('direction', e.target.value as GoalDirection)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
              >
                <option value="DECREASE">Decrease</option>
                <option value="INCREASE">Increase</option>
                <option value="MAINTAIN">Maintain</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Start date *</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => handleChange('startDate', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Target date *</label>
              <input
                type="date"
                value={form.targetDate}
                onChange={(e) => handleChange('targetDate', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
                required
              />
            </div>
          </div>

          {biomarkers.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                Linked biomarker (optional)
              </label>
              <select
                value={form.relatedBiomarkerId ?? ''}
                onChange={(e) => handleChange('relatedBiomarkerId', e.target.value || undefined)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:text-white"
              >
                <option value="">None</option>
                {biomarkers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.value} {b.unit})
                  </option>
                ))}
              </select>
            </div>
          )}

          {formError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-800 dark:text-red-200">{formError}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
