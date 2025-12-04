/**
 * Predictive Trend Chart
 *
 * Advanced chart component that displays historical biomarker data
 * along with future predictions and confidence intervals.
 */

import React, { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import type { Biomarker } from '../../types';
import { analyzeTrend, type DataPoint } from '../../utils/analytics';

interface PredictiveTrendChartProps {
  biomarker: Biomarker;
  projectionDays?: number;
  showConfidenceInterval?: boolean;
}

interface ChartDataPoint {
  date: string;
  displayDate: string;
  value?: number;
  predicted?: number;
  upperBound?: number;
  lowerBound?: number;
  isPrediction: boolean;
}

// Linear regression for predictions
function linearRegression(data: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: data[0]?.y || 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const point of data) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const point of data) {
    ssTot += Math.pow(point.y - yMean, 2);
    ssRes += Math.pow(point.y - (slope * point.x + intercept), 2);
  }
  const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { slope, intercept, r2 };
}

// Calculate standard error for confidence intervals
function calculateStandardError(data: { x: number; y: number }[], slope: number, intercept: number): number {
  if (data.length < 3) return 0;

  const residuals = data.map(p => p.y - (slope * p.x + intercept));
  const sumSquaredResiduals = residuals.reduce((sum, r) => sum + r * r, 0);
  return Math.sqrt(sumSquaredResiduals / (data.length - 2));
}

export default function PredictiveTrendChart({
  biomarker,
  projectionDays = 30,
  showConfidenceInterval = true,
}: PredictiveTrendChartProps) {
  // Prepare historical data
  const historicalData = useMemo((): DataPoint[] => {
    const history = biomarker.history || [];
    const data: DataPoint[] = history.map(h => ({
      date: h.date,
      value: h.value,
    }));
    // Add current value
    data.push({ date: biomarker.date, value: biomarker.value });
    return data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [biomarker]);

  // Calculate trend
  const trend = useMemo(() => {
    return analyzeTrend(historicalData, biomarker.normalRange.min, biomarker.normalRange.max);
  }, [historicalData, biomarker.normalRange]);

  // Generate chart data with predictions
  const chartData = useMemo((): ChartDataPoint[] => {
    if (historicalData.length < 2) return [];

    // Convert dates to numeric for regression
    const baseTime = new Date(historicalData[0].date).getTime();
    const regressionData = historicalData.map(d => ({
      x: (new Date(d.date).getTime() - baseTime) / (1000 * 60 * 60 * 24), // Days from start
      y: d.value,
    }));

    const { slope, intercept } = linearRegression(regressionData);
    const standardError = calculateStandardError(regressionData, slope, intercept);

    // t-value for 95% confidence interval (approximately 1.96 for large samples)
    const tValue = 1.96;

    const result: ChartDataPoint[] = [];

    // Add historical data points
    for (const point of historicalData) {
      const date = new Date(point.date);
      result.push({
        date: point.date,
        displayDate: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: point.value,
        isPrediction: false,
      });
    }

    // Add prediction points
    const lastDate = new Date(historicalData[historicalData.length - 1].date);
    const lastX = regressionData[regressionData.length - 1].x;

    for (let i = 1; i <= projectionDays; i += Math.ceil(projectionDays / 5)) {
      const futureDate = new Date(lastDate);
      futureDate.setDate(futureDate.getDate() + i);

      const x = lastX + i;
      const predicted = slope * x + intercept;

      // Confidence interval widens as we predict further out
      const predictionDistance = Math.sqrt(1 + (1 / regressionData.length) +
        Math.pow(x - regressionData.reduce((s, p) => s + p.x, 0) / regressionData.length, 2) /
        regressionData.reduce((s, p) => s + Math.pow(p.x - regressionData.reduce((ss, pp) => ss + pp.x, 0) / regressionData.length, 2), 0));

      const confidenceMargin = tValue * standardError * predictionDistance;

      result.push({
        date: futureDate.toISOString().split('T')[0],
        displayDate: futureDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        predicted: Math.round(predicted * 10) / 10,
        upperBound: showConfidenceInterval ? Math.round((predicted + confidenceMargin) * 10) / 10 : undefined,
        lowerBound: showConfidenceInterval ? Math.round((predicted - confidenceMargin) * 10) / 10 : undefined,
        isPrediction: true,
      });
    }

    return result;
  }, [historicalData, projectionDays, showConfidenceInterval]);

  // Determine if within normal range in prediction
  const predictionStatus = useMemo(() => {
    if (chartData.length === 0) return null;

    const lastPrediction = chartData[chartData.length - 1];
    const predictedValue = lastPrediction.predicted;

    if (predictedValue === undefined) return null;

    const isWithinRange = predictedValue >= biomarker.normalRange.min &&
                          predictedValue <= biomarker.normalRange.max;
    const currentWithinRange = biomarker.value >= biomarker.normalRange.min &&
                               biomarker.value <= biomarker.normalRange.max;

    if (isWithinRange && !currentWithinRange) return 'improving';
    if (!isWithinRange && currentWithinRange) return 'declining';
    if (isWithinRange && currentWithinRange) return 'stable';
    return trend.direction;
  }, [chartData, biomarker, trend]);

  // Empty state
  if (historicalData.length < 2) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/60 p-6">
        <div className="text-center py-8">
          <Info className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500">Need at least 2 data points for predictions</p>
        </div>
      </div>
    );
  }

  const TrendIcon = trend.direction === 'improving' ? TrendingUp :
                    trend.direction === 'declining' ? TrendingDown : Minus;

  const trendColor = trend.direction === 'improving' ? 'text-emerald-500' :
                     trend.direction === 'declining' ? 'text-rose-500' : 'text-slate-500';

  return (
    <div className="bg-white rounded-xl border border-slate-200/60 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-900">{biomarker.name}</h3>
          <p className="text-sm text-slate-500">
            {projectionDays}-day prediction
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TrendIcon className={`w-5 h-5 ${trendColor}`} />
          <span className={`text-sm font-medium ${trendColor} capitalize`}>
            {trend.direction}
          </span>
        </div>
      </div>

      {/* Current Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1">Current</p>
          <p className="text-lg font-bold text-slate-900">
            {biomarker.value} <span className="text-sm font-normal text-slate-500">{biomarker.unit}</span>
          </p>
        </div>
        <div className="bg-sky-50 rounded-lg p-3">
          <p className="text-xs text-sky-600 mb-1">Predicted</p>
          <p className="text-lg font-bold text-sky-700">
            {trend.prediction30d.toFixed(1)} <span className="text-sm font-normal text-sky-500">{biomarker.unit}</span>
          </p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-xs text-emerald-600 mb-1">Target Range</p>
          <p className="text-lg font-bold text-emerald-700">
            {biomarker.normalRange.min}-{biomarker.normalRange.max}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 11 }}
              stroke="#94a3b8"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="#94a3b8"
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '8px 12px',
              }}
              formatter={(value: number, name: string) => {
                const label = name === 'value' ? 'Actual' :
                              name === 'predicted' ? 'Predicted' :
                              name === 'upperBound' ? 'Upper Bound' :
                              name === 'lowerBound' ? 'Lower Bound' : name;
                return [`${value} ${biomarker.unit}`, label];
              }}
            />

            {/* Normal range reference area */}
            <ReferenceArea
              y1={biomarker.normalRange.min}
              y2={biomarker.normalRange.max}
              fill="#10b981"
              fillOpacity={0.1}
              stroke="#10b981"
              strokeDasharray="3 3"
              strokeOpacity={0.3}
            />

            {/* Confidence interval area */}
            {showConfidenceInterval && (
              <Area
                type="monotone"
                dataKey="upperBound"
                stroke="none"
                fill="#3b82f6"
                fillOpacity={0.1}
              />
            )}
            {showConfidenceInterval && (
              <Area
                type="monotone"
                dataKey="lowerBound"
                stroke="none"
                fill="#ffffff"
                fillOpacity={1}
              />
            )}

            {/* Historical values line */}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ fill: '#3b82f6', strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls={false}
            />

            {/* Prediction line */}
            <Line
              type="monotone"
              dataKey="predicted"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ fill: '#3b82f6', strokeWidth: 0, r: 3 }}
              connectNulls={false}
            />

            {/* Target reference lines */}
            <ReferenceLine
              y={biomarker.normalRange.min}
              stroke="#10b981"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <ReferenceLine
              y={biomarker.normalRange.max}
              stroke="#10b981"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-blue-500" />
          <span className="text-slate-600">Historical</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-blue-500" style={{ borderStyle: 'dashed', borderWidth: '1px', height: '0' }} />
          <span className="text-slate-600">Predicted</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 bg-emerald-500/20 border border-emerald-500/30 rounded" />
          <span className="text-slate-600">Normal Range</span>
        </div>
      </div>

      {/* Prediction insight */}
      {predictionStatus && (
        <div className={`mt-4 p-3 rounded-lg ${
          predictionStatus === 'improving' ? 'bg-emerald-50' :
          predictionStatus === 'declining' ? 'bg-rose-50' : 'bg-slate-50'
        }`}>
          <p className={`text-sm ${
            predictionStatus === 'improving' ? 'text-emerald-700' :
            predictionStatus === 'declining' ? 'text-rose-700' : 'text-slate-700'
          }`}>
            {predictionStatus === 'improving' && (
              <>Based on current trends, your {biomarker.name.toLowerCase()} is projected to move toward the normal range.</>
            )}
            {predictionStatus === 'declining' && (
              <>Based on current trends, your {biomarker.name.toLowerCase()} may move outside the normal range. Consider consulting your healthcare provider.</>
            )}
            {predictionStatus === 'stable' && (
              <>Your {biomarker.name.toLowerCase()} is projected to remain stable within the normal range.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
