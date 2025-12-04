/**
 * Goal Tracker Panel
 *
 * Component for setting, tracking, and visualizing health goals.
 * Integrates with the Health Analytics Dashboard.
 */

import React, { useState, useMemo } from 'react';
import {
  Target,
  Plus,
  TrendingUp,
  TrendingDown,
  Check,
  X,
  ChevronRight,
  Award,
  Calendar,
  Activity,
  AlertCircle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import type { Biomarker } from '../../types';

interface HealthGoal {
  id: string;
  name: string;
  description?: string;
  category: string;
  targetValue: number;
  currentValue: number;
  startValue: number;
  unit: string;
  direction: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  startDate: string;
  targetDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'FAILED' | 'CANCELLED';
  progress: number;
  milestones?: Milestone[];
  progressHistory?: ProgressEntry[];
}

interface Milestone {
  value: number;
  label: string;
  achieved: boolean;
  achievedAt?: string;
}

interface ProgressEntry {
  date: string;
  value: number;
  progress: number;
}

interface GoalTrackerPanelProps {
  biomarkers: Biomarker[];
}

// Sample goals for demonstration
const sampleGoals: HealthGoal[] = [
  {
    id: '1',
    name: 'Lower Blood Pressure',
    description: 'Reduce systolic blood pressure to healthy range',
    category: 'Vital Signs',
    targetValue: 120,
    currentValue: 145,
    startValue: 150,
    unit: 'mmHg',
    direction: 'DECREASE',
    startDate: '2024-01-01',
    targetDate: '2024-06-01',
    status: 'ACTIVE',
    progress: 17,
    milestones: [
      { value: 140, label: 'First milestone', achieved: true, achievedAt: '2024-02-15' },
      { value: 130, label: 'Halfway there', achieved: false },
      { value: 120, label: 'Goal reached', achieved: false },
    ],
    progressHistory: [
      { date: '2024-01-15', value: 150, progress: 0 },
      { date: '2024-02-01', value: 148, progress: 7 },
      { date: '2024-02-15', value: 145, progress: 17 },
    ],
  },
  {
    id: '2',
    name: 'Improve HDL Cholesterol',
    description: 'Increase HDL to healthy levels',
    category: 'Lipids',
    targetValue: 50,
    currentValue: 35,
    startValue: 32,
    unit: 'mg/dL',
    direction: 'INCREASE',
    startDate: '2024-01-01',
    targetDate: '2024-09-01',
    status: 'ACTIVE',
    progress: 17,
    milestones: [
      { value: 38, label: 'Getting started', achieved: false },
      { value: 45, label: 'Good progress', achieved: false },
      { value: 50, label: 'Goal reached', achieved: false },
    ],
    progressHistory: [
      { date: '2024-01-15', value: 32, progress: 0 },
      { date: '2024-02-01', value: 33, progress: 6 },
      { date: '2024-02-15', value: 35, progress: 17 },
    ],
  },
  {
    id: '3',
    name: 'Optimize Vitamin D',
    description: 'Bring Vitamin D into optimal range',
    category: 'Vitamins',
    targetValue: 50,
    currentValue: 25,
    startValue: 22,
    unit: 'ng/mL',
    direction: 'INCREASE',
    startDate: '2024-01-15',
    targetDate: '2024-05-15',
    status: 'ACTIVE',
    progress: 11,
    progressHistory: [
      { date: '2024-01-15', value: 22, progress: 0 },
      { date: '2024-02-01', value: 24, progress: 7 },
      { date: '2024-02-15', value: 25, progress: 11 },
    ],
  },
];

// Generate suggestions from out-of-range biomarkers
function generateGoalSuggestions(biomarkers: Biomarker[]): Partial<HealthGoal>[] {
  return biomarkers
    .filter(b => {
      const isLow = b.value < b.normalRange.min;
      const isHigh = b.value > b.normalRange.max;
      return isLow || isHigh;
    })
    .map(b => {
      const isLow = b.value < b.normalRange.min;
      const targetValue = isLow
        ? (b.normalRange.min + b.normalRange.max) / 2
        : (b.normalRange.min + b.normalRange.max) / 2;

      return {
        name: `Optimize ${b.name}`,
        category: b.category,
        targetValue: Math.round(targetValue * 10) / 10,
        currentValue: b.value,
        startValue: b.value,
        unit: b.unit,
        direction: isLow ? 'INCREASE' as const : 'DECREASE' as const,
        description: `Bring ${b.name} into the normal range (${b.normalRange.min}-${b.normalRange.max} ${b.unit})`,
      };
    });
}

function getProgressColor(progress: number, status: string): string {
  if (status === 'ACHIEVED') return 'bg-emerald-500';
  if (status === 'FAILED' || status === 'CANCELLED') return 'bg-slate-300';
  if (progress >= 75) return 'bg-emerald-500';
  if (progress >= 50) return 'bg-sky-500';
  if (progress >= 25) return 'bg-amber-500';
  return 'bg-rose-500';
}

function getStatusBadge(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case 'ACTIVE':
      return { bg: 'bg-sky-100', text: 'text-sky-700', label: 'Active' };
    case 'ACHIEVED':
      return { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Achieved' };
    case 'PAUSED':
      return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Paused' };
    case 'FAILED':
      return { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Failed' };
    default:
      return { bg: 'bg-slate-100', text: 'text-slate-700', label: status };
  }
}

function getDaysRemaining(targetDate: string): number {
  const target = new Date(targetDate);
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function GoalTrackerPanel({ biomarkers }: GoalTrackerPanelProps) {
  const [goals] = useState<HealthGoal[]>(sampleGoals);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<HealthGoal | null>(null);

  const suggestions = useMemo(() => generateGoalSuggestions(biomarkers), [biomarkers]);

  const activeGoals = goals.filter(g => g.status === 'ACTIVE');
  const completedGoals = goals.filter(g => g.status === 'ACHIEVED');

  const summaryStats = useMemo(() => ({
    total: goals.length,
    active: activeGoals.length,
    achieved: completedGoals.length,
    avgProgress: activeGoals.length > 0
      ? Math.round(activeGoals.reduce((sum, g) => sum + g.progress, 0) / activeGoals.length)
      : 0,
  }), [goals, activeGoals, completedGoals]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-brand-500" />
            Health Goals
          </h2>
          <p className="text-sm text-slate-500">Track progress towards your health targets</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Goal
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center">
              <Target className="w-5 h-5 text-sky-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{summaryStats.active}</p>
              <p className="text-sm text-slate-500">Active</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Award className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{summaryStats.achieved}</p>
              <p className="text-sm text-slate-500">Achieved</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <Activity className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{summaryStats.avgProgress}%</p>
              <p className="text-sm text-slate-500">Avg Progress</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{suggestions.length}</p>
              <p className="text-sm text-slate-500">Suggestions</p>
            </div>
          </div>
        </div>
      </div>

      {/* Active Goals */}
      {activeGoals.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Active Goals</h3>
          <div className="space-y-4">
            {activeGoals.map(goal => {
              const daysLeft = getDaysRemaining(goal.targetDate);
              const statusBadge = getStatusBadge(goal.status);

              return (
                <div
                  key={goal.id}
                  onClick={() => setSelectedGoal(goal)}
                  className="p-4 rounded-xl border border-slate-200 hover:border-brand-200 hover:bg-brand-50/30 cursor-pointer transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-slate-900">{goal.name}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge.bg} ${statusBadge.text}`}>
                          {statusBadge.label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500">{goal.description}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </div>

                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">
                        {goal.currentValue} {goal.unit}
                      </span>
                      <span className="text-slate-500">
                        Target: {goal.targetValue} {goal.unit}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getProgressColor(goal.progress, goal.status)}`}
                        style={{ width: `${Math.min(goal.progress, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Footer info */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-1">
                      {goal.direction === 'DECREASE' ? (
                        <TrendingDown className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      )}
                      {goal.progress}% complete
                    </span>
                    <span className={`flex items-center gap-1 ${daysLeft < 30 ? 'text-amber-600' : 'text-slate-500'}`}>
                      <Calendar className="w-4 h-4" />
                      {daysLeft > 0 ? `${daysLeft} days left` : 'Overdue'}
                    </span>
                  </div>

                  {/* Milestones */}
                  {goal.milestones && goal.milestones.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        {goal.milestones.map((m, idx) => (
                          <div
                            key={idx}
                            className={`flex items-center gap-1 text-xs ${
                              m.achieved ? 'text-emerald-600' : 'text-slate-400'
                            }`}
                          >
                            {m.achieved ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <div className="w-3 h-3 rounded-full border border-slate-300" />
                            )}
                            <span>{m.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Goal Suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-gradient-to-br from-brand-50 to-purple-50 rounded-2xl border border-brand-200/60 p-6">
          <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-brand-500" />
            Suggested Goals
          </h3>
          <p className="text-sm text-slate-600 mb-4">
            Based on your out-of-range biomarkers
          </p>
          <div className="space-y-3">
            {suggestions.slice(0, 3).map((suggestion, idx) => (
              <div
                key={idx}
                className="bg-white/80 backdrop-blur p-4 rounded-xl border border-slate-200/60 flex items-center justify-between"
              >
                <div>
                  <h4 className="font-medium text-slate-900">{suggestion.name}</h4>
                  <p className="text-sm text-slate-500 mt-1">
                    {suggestion.direction === 'INCREASE' ? 'Increase' : 'Decrease'} from{' '}
                    {suggestion.currentValue} to {suggestion.targetValue} {suggestion.unit}
                  </p>
                </div>
                <button className="px-3 py-1.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors">
                  Add Goal
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Goal Detail Modal */}
      {selectedGoal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{selectedGoal.name}</h3>
                  <p className="text-sm text-slate-500">{selectedGoal.category}</p>
                </div>
                <button
                  onClick={() => setSelectedGoal(null)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Progress Chart */}
              {selectedGoal.progressHistory && selectedGoal.progressHistory.length > 1 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-3">Progress Over Time</h4>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={selectedGoal.progressHistory.map(h => ({
                        ...h,
                        date: new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                      }))}>
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" domain={['auto', 'auto']} />
                        <Tooltip />
                        <ReferenceLine
                          y={selectedGoal.targetValue}
                          stroke="#10b981"
                          strokeDasharray="3 3"
                          label={{ value: 'Target', position: 'right', fontSize: 10 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="#3b82f6"
                          fill="#3b82f680"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-sm text-slate-500">Start Value</p>
                  <p className="text-xl font-bold text-slate-900">
                    {selectedGoal.startValue} {selectedGoal.unit}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-sm text-slate-500">Current Value</p>
                  <p className="text-xl font-bold text-slate-900">
                    {selectedGoal.currentValue} {selectedGoal.unit}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-sm text-slate-500">Target Value</p>
                  <p className="text-xl font-bold text-emerald-600">
                    {selectedGoal.targetValue} {selectedGoal.unit}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-sm text-slate-500">Progress</p>
                  <p className="text-xl font-bold text-brand-600">
                    {selectedGoal.progress}%
                  </p>
                </div>
              </div>

              {/* Milestones */}
              {selectedGoal.milestones && selectedGoal.milestones.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-3">Milestones</h4>
                  <div className="space-y-2">
                    {selectedGoal.milestones.map((milestone, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          milestone.achieved ? 'bg-emerald-50' : 'bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {milestone.achieved ? (
                            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                              <Check className="w-4 h-4 text-white" />
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full border-2 border-slate-300" />
                          )}
                          <div>
                            <p className="font-medium text-slate-900">{milestone.label}</p>
                            <p className="text-sm text-slate-500">
                              {milestone.value} {selectedGoal.unit}
                            </p>
                          </div>
                        </div>
                        {milestone.achievedAt && (
                          <span className="text-xs text-slate-500">
                            {new Date(milestone.achievedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 transition-colors">
                  Update Progress
                </button>
                <button className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors">
                  Edit Goal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Goal Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Create Health Goal</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Goal Name</label>
                <input
                  type="text"
                  placeholder="e.g., Lower Blood Pressure"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Target Value</label>
                  <input
                    type="number"
                    placeholder="120"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
                  <input
                    type="text"
                    placeholder="mmHg"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Direction</label>
                <select className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
                  <option value="DECREASE">Decrease</option>
                  <option value="INCREASE">Increase</option>
                  <option value="MAINTAIN">Maintain</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Target Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 transition-colors">
                  Create Goal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {goals.length === 0 && suggestions.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 p-12 text-center">
          <Target className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Goals Yet</h3>
          <p className="text-slate-500 max-w-md mx-auto mb-6">
            Start tracking your health journey by setting personalized goals based on your biomarkers.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            Create Your First Goal
          </button>
        </div>
      )}
    </div>
  );
}
