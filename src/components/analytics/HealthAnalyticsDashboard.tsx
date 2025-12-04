/**
 * Health Analytics Dashboard
 *
 * Main container component for the advanced health analytics features including:
 * - Trend analysis with predictions
 * - Cross-biomarker correlations
 * - Goal tracking
 * - Risk alerts
 * - Personalized health insights
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  Lightbulb,
  Calendar,
  BarChart3,
  Activity,
  Info,
  FileText,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { Biomarker } from '../../types';
import {
  calculateCorrelation,
  analyzeCorrelation,
  analyzeTrend,
  detectRisks,
  generateInsights,
  formatPercentChange,
  getTrendColor,
  getTrendBgColor,
  getCorrelationColor,
  getRiskSeverityColor,
  type DataPoint,
  type RiskAlert,
  type CorrelationResult,
} from '../../utils/analytics';
import GoalTrackerPanel from './GoalTrackerPanel';
import ReportGeneratorModal from './ReportGeneratorModal';

interface HealthAnalyticsDashboardProps {
  biomarkers: Biomarker[];
}

type TimeRange = '30d' | '90d' | '1y' | 'all';

const timeRangeLabels: Record<TimeRange, string> = {
  '30d': '30 Days',
  '90d': '90 Days',
  '1y': '1 Year',
  'all': 'All Time',
};

export default function HealthAnalyticsDashboard({ biomarkers }: HealthAnalyticsDashboardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('90d');
  const [selectedBiomarkers, setSelectedBiomarkers] = useState<string[]>([]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Filter biomarkers that have enough history for analysis
  const analyzableBiomarkers = useMemo(() => {
    return biomarkers.filter(b => (b.history?.length || 0) >= 2);
  }, [biomarkers]);

  // Convert biomarker history to DataPoint format
  const getBiomarkerData = useCallback((biomarker: Biomarker): DataPoint[] => {
    const history = biomarker.history || [];
    const data: DataPoint[] = history.map(h => ({
      date: h.date,
      value: h.value,
    }));
    // Add current value
    data.push({ date: biomarker.date, value: biomarker.value });
    return data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, []);

  // Calculate trends for all biomarkers
  const biomarkerTrends = useMemo(() => {
    return analyzableBiomarkers.map(b => {
      const data = getBiomarkerData(b);
      const trend = analyzeTrend(data, b.normalRange.min, b.normalRange.max);
      return { biomarker: b, data, trend };
    });
  }, [analyzableBiomarkers, getBiomarkerData]);

  // Detect all risks
  const allRisks = useMemo(() => {
    const risks: RiskAlert[] = [];
    biomarkerTrends.forEach(({ biomarker, data, trend }) => {
      const detected = detectRisks(
        biomarker.name,
        data,
        biomarker.normalRange.min,
        biomarker.normalRange.max,
        trend
      );
      risks.push(...detected);
    });
    return risks.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }, [biomarkerTrends]);

  // Generate insights
  const insights = useMemo(() => {
    const biomarkerInputs = biomarkerTrends.map(({ biomarker, data, trend }) => ({
      name: biomarker.name,
      data,
      normalMin: biomarker.normalRange.min,
      normalMax: biomarker.normalRange.max,
      trend,
    }));
    return generateInsights(biomarkerInputs);
  }, [biomarkerTrends]);

  // Calculate correlation matrix
  const correlationMatrix = useMemo(() => {
    const matrix: { b1: string; b2: string; correlation: CorrelationResult }[] = [];
    for (let i = 0; i < analyzableBiomarkers.length; i++) {
      for (let j = i + 1; j < analyzableBiomarkers.length; j++) {
        const b1 = analyzableBiomarkers[i];
        const b2 = analyzableBiomarkers[j];
        const data1 = getBiomarkerData(b1);
        const data2 = getBiomarkerData(b2);

        // Align data points by date
        const dates = new Set([...data1.map(d => d.date), ...data2.map(d => d.date)]);
        const aligned1: number[] = [];
        const aligned2: number[] = [];

        dates.forEach(date => {
          const v1 = data1.find(d => d.date === date);
          const v2 = data2.find(d => d.date === date);
          if (v1 && v2) {
            aligned1.push(v1.value);
            aligned2.push(v2.value);
          }
        });

        if (aligned1.length >= 3) {
          const coefficient = calculateCorrelation(aligned1, aligned2);
          const correlation = analyzeCorrelation(coefficient);
          matrix.push({ b1: b1.name, b2: b2.name, correlation });
        }
      }
    }
    return matrix;
  }, [analyzableBiomarkers, getBiomarkerData]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const improving = biomarkerTrends.filter(t => t.trend.direction === 'improving').length;
    const declining = biomarkerTrends.filter(t => t.trend.direction === 'declining').length;
    const stable = biomarkerTrends.filter(t => t.trend.direction === 'stable').length;
    const highRisks = allRisks.filter(r => r.severity === 'high').length;

    return { improving, declining, stable, highRisks };
  }, [biomarkerTrends, allRisks]);

  // Toggle biomarker selection
  const toggleBiomarker = useCallback((name: string) => {
    setSelectedBiomarkers(prev =>
      prev.includes(name)
        ? prev.filter(n => n !== name)
        : prev.length < 4
          ? [...prev, name]
          : prev
    );
  }, []);

  // Get chart data for selected biomarkers
  const chartData = useMemo(() => {
    if (selectedBiomarkers.length === 0) return [];

    const allDates = new Set<string>();
    const biomarkerData: Record<string, DataPoint[]> = {};

    selectedBiomarkers.forEach(name => {
      const biomarker = biomarkers.find(b => b.name === name);
      if (biomarker) {
        const data = getBiomarkerData(biomarker);
        biomarkerData[name] = data;
        data.forEach(d => allDates.add(d.date));
      }
    });

    const sortedDates = Array.from(allDates).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    return sortedDates.map(date => {
      const point: Record<string, string | number> = {
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
      selectedBiomarkers.forEach(name => {
        const found = biomarkerData[name]?.find(d => d.date === date);
        if (found) point[name] = found.value;
      });
      return point;
    });
  }, [selectedBiomarkers, biomarkers, getBiomarkerData]);

  // Chart colors
  const chartColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  // Empty state
  if (analyzableBiomarkers.length < 2) {
    return (
      <div className="max-w-6xl mx-auto animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Health Analytics</h1>
          <p className="text-slate-500 mt-1">Advanced trend analysis and predictions</p>
        </div>
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60">
          <BarChart3 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Insufficient Data</h3>
          <p className="text-slate-500 max-w-md mx-auto">
            Add more biomarker measurements over time to unlock trend analysis, correlations, and predictive insights.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Health Analytics</h1>
          <p className="text-slate-500 mt-1">Correlations, trends, and predictive insights</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-colors shadow-md shadow-blue-500/20"
          >
            <FileText className="w-4 h-4" />
            <span className="font-medium">Generate Report</span>
          </button>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            >
              {Object.entries(timeRangeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200/60 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{summaryStats.improving}</p>
              <p className="text-sm text-slate-500">Improving</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/60 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{summaryStats.declining}</p>
              <p className="text-sm text-slate-500">Declining</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/60 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">
              <Activity className="w-5 h-5 text-slate-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{summaryStats.stable}</p>
              <p className="text-sm text-slate-500">Stable</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/60 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{summaryStats.highRisks}</p>
              <p className="text-sm text-slate-500">Alerts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Trend Analysis Section */}
      <div className="bg-white rounded-2xl border border-slate-200/60 p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Trend Analysis</h2>
            <p className="text-sm text-slate-500">Select up to 4 biomarkers to compare</p>
          </div>
        </div>

        {/* Biomarker Selector */}
        <div className="flex flex-wrap gap-2 mb-6">
          {analyzableBiomarkers.map(b => {
            const isSelected = selectedBiomarkers.includes(b.name);
            const trend = biomarkerTrends.find(t => t.biomarker.name === b.name)?.trend;
            return (
              <button
                key={b.id}
                onClick={() => toggleBiomarker(b.name)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  isSelected
                    ? 'bg-brand-500 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {b.name}
                  {trend && (
                    <span className={`text-xs ${isSelected ? 'text-white/80' : getTrendColor(trend.direction)}`}>
                      {trend.direction === 'improving' && '↑'}
                      {trend.direction === 'declining' && '↓'}
                      {trend.direction === 'stable' && '→'}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Chart */}
        {selectedBiomarkers.length > 0 ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                {selectedBiomarkers.map((name, idx) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={chartColors[idx]}
                    strokeWidth={2}
                    dot={{ fill: chartColors[idx], strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-80 flex items-center justify-center bg-slate-50 rounded-xl">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Select biomarkers above to view trends</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Trend Details */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Biomarker Trends</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {biomarkerTrends.map(({ biomarker, trend }) => (
              <div
                key={biomarker.id}
                className={`p-4 rounded-xl border ${getTrendBgColor(trend.direction)} border-slate-200/60`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-slate-900">{biomarker.name}</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Current: {biomarker.value} {biomarker.unit}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-medium ${getTrendColor(trend.direction)}`}>
                      {formatPercentChange(trend.percentChange)}
                    </span>
                    <p className="text-xs text-slate-400 mt-1 capitalize">{trend.direction}</p>
                  </div>
                </div>
                {trend.direction !== 'stable' && (
                  <div className="mt-3 pt-3 border-t border-slate-200/60">
                    <p className="text-xs text-slate-500">
                      <span className="font-medium">30d prediction:</span> {trend.prediction30d.toFixed(1)} {biomarker.unit}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Correlation Matrix */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Correlations</h2>
          {correlationMatrix.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {correlationMatrix
                .filter(c => c.correlation.strength !== 'none')
                .sort((a, b) => Math.abs(b.correlation.coefficient) - Math.abs(a.correlation.coefficient))
                .map((c, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2 h-2 rounded-full ${getCorrelationColor(c.correlation.coefficient)}`} />
                        <span className="text-sm text-slate-700 truncate">
                          {c.b1} ↔ {c.b2}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-sm font-medium ${
                          c.correlation.coefficient > 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}>
                          {c.correlation.coefficient > 0 ? '+' : ''}{c.correlation.coefficient.toFixed(2)}
                        </span>
                        <span className="text-xs text-slate-400 capitalize">
                          {c.correlation.strength}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              {correlationMatrix.filter(c => c.correlation.strength !== 'none').length === 0 && (
                <div className="text-center py-8">
                  <Info className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No significant correlations detected</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Info className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">Need more overlapping data points</p>
            </div>
          )}
        </div>
      </div>

      {/* Risk Alerts */}
      {allRisks.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Risk Alerts
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {allRisks.slice(0, 4).map((risk, idx) => {
              const colors = getRiskSeverityColor(risk.severity);
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border ${colors.bg} ${colors.border}`}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-5 h-5 ${colors.text} flex-shrink-0 mt-0.5`} />
                    <div>
                      <h3 className={`font-medium ${colors.text}`}>{risk.biomarkerName}</h3>
                      <p className="text-sm text-slate-600 mt-1">{risk.message}</p>
                      <p className="text-xs text-slate-500 mt-2">{risk.recommendation}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Health Insights */}
      {insights.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-500" />
            Health Insights
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {insights.map((insight, idx) => {
              const iconMap = {
                'trending-up': TrendingUp,
                'trending-down': TrendingDown,
                'target': Target,
                'link': Activity,
                'lightbulb': Lightbulb,
                'alert': AlertTriangle,
              };
              const Icon = iconMap[insight.icon] || Lightbulb;
              const bgColor = insight.type === 'improvement' ? 'bg-emerald-50' :
                             insight.type === 'concern' ? 'bg-rose-50' :
                             insight.type === 'goal_progress' ? 'bg-sky-50' : 'bg-amber-50';
              const iconColor = insight.type === 'improvement' ? 'text-emerald-500' :
                               insight.type === 'concern' ? 'text-rose-500' :
                               insight.type === 'goal_progress' ? 'text-sky-500' : 'text-amber-500';

              return (
                <div key={idx} className={`p-4 rounded-xl ${bgColor}`}>
                  <div className="flex items-start gap-3">
                    <Icon className={`w-5 h-5 ${iconColor} flex-shrink-0 mt-0.5`} />
                    <div>
                      <h3 className="font-medium text-slate-900">{insight.title}</h3>
                      <p className="text-sm text-slate-600 mt-1">{insight.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Goal Tracker */}
      <GoalTrackerPanel biomarkers={biomarkers} />

      {/* Report Generator Modal */}
      <ReportGeneratorModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        biomarkers={biomarkers}
        patientName="Demo User"
      />
    </div>
  );
}
