/**
 * BiomarkerChart Component
 *
 * A responsive line chart visualization for biomarker historical data using Recharts.
 * Displays measurement values over time with optional normal range visualization.
 *
 * Features:
 * - Interactive tooltips showing value, date, and status (normal/abnormal)
 * - Shaded normal range reference area
 * - Color-coded data points based on whether values are in range
 * - Responsive sizing for different container widths
 * - Animation support for smooth data transitions
 *
 * @module components/biomarkers/BiomarkerChart
 */

import React, { useMemo } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
  TooltipProps
} from 'recharts';
import type { Biomarker } from '../../types';

interface BiomarkerChartProps {
  /** The biomarker with historical data to chart */
  biomarker: Biomarker;
  /** Chart height in pixels (default: 300) */
  height?: number;
  /** Whether to show the normal range shaded area (default: true) */
  showNormalRange?: boolean;
  /** Whether to show gradient fill under the line (default: true) */
  showGradient?: boolean;
  /** Whether to animate chart transitions (default: true) */
  animate?: boolean;
  /** Compact mode with reduced padding (default: false) */
  compact?: boolean;
}

interface ChartDataPoint {
  date: string;
  displayDate: string;
  value: number;
  normalMin: number;
  normalMax: number;
}

// Custom tooltip component
const CustomTooltip = ({
  active,
  payload,
  biomarker
}: TooltipProps<number, string> & { biomarker: Biomarker }) => {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload as ChartDataPoint;
  const value = data.value;
  const isInRange = value >= data.normalMin && value <= data.normalMax;
  const isLow = value < data.normalMin;

  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200/60 p-4 min-w-[180px]">
      <p className="text-xs text-slate-500 mb-2">{data.displayDate}</p>
      <div className="flex items-baseline gap-2 mb-2">
        <span className={`text-2xl font-bold ${
          isInRange ? 'text-slate-900' : isLow ? 'text-amber-600' : 'text-red-600'
        }`}>
          {value}
        </span>
        <span className="text-sm text-slate-500">{biomarker.unit}</span>
      </div>
      <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${
        isInRange
          ? 'bg-wellness-50 text-wellness-700'
          : isLow
            ? 'bg-amber-50 text-amber-700'
            : 'bg-red-50 text-red-700'
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full ${
          isInRange ? 'bg-wellness-500' : isLow ? 'bg-amber-500' : 'bg-red-500'
        }`} />
        {isInRange ? 'Within range' : isLow ? 'Below range' : 'Above range'}
      </div>
    </div>
  );
};

// Custom dot component for data points
const CustomDot = (props: {
  cx?: number;
  cy?: number;
  payload?: ChartDataPoint;
  index?: number;
  dataLength?: number;
}) => {
  const { cx, cy, payload, index, dataLength } = props;
  if (!cx || !cy || !payload) return null;

  const isInRange = payload.value >= payload.normalMin && payload.value <= payload.normalMax;
  const isLast = index === (dataLength ?? 0) - 1;

  return (
    <g>
      {/* Outer glow for last point */}
      {isLast && (
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill={isInRange ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'}
          className="animate-pulse"
        />
      )}
      {/* Main dot */}
      <circle
        cx={cx}
        cy={cy}
        r={isLast ? 6 : 4}
        fill={isInRange ? '#22c55e' : '#ef4444'}
        stroke="white"
        strokeWidth={2}
        className="transition-all duration-300"
      />
    </g>
  );
};

// Custom active dot for hover
const CustomActiveDot = (props: {
  cx?: number;
  cy?: number;
  payload?: ChartDataPoint;
}) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;

  const isInRange = payload.value >= payload.normalMin && payload.value <= payload.normalMax;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={12}
        fill={isInRange ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}
      />
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill={isInRange ? '#22c55e' : '#ef4444'}
        stroke="white"
        strokeWidth={2}
      />
    </g>
  );
};

export default function BiomarkerChart({
  biomarker,
  height = 300,
  showNormalRange = true,
  showGradient = true,
  animate = true,
  compact = false
}: BiomarkerChartProps) {
  // Process data for chart
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!biomarker.history || biomarker.history.length === 0) {
      // If no history, show current value as single point
      return [{
        date: biomarker.date,
        displayDate: new Date(biomarker.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }),
        value: biomarker.value,
        normalMin: biomarker.normalRange.min,
        normalMax: biomarker.normalRange.max
      }];
    }

    // Combine history with current value if not already included
    const historyData = biomarker.history.map(h => ({
      date: h.date,
      displayDate: new Date(h.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      }),
      value: h.value,
      normalMin: biomarker.normalRange.min,
      normalMax: biomarker.normalRange.max
    }));

    // Add current value if it's newer than the last history entry
    const lastHistoryDate = new Date(biomarker.history[biomarker.history.length - 1].date);
    const currentDate = new Date(biomarker.date);

    if (currentDate > lastHistoryDate) {
      historyData.push({
        date: biomarker.date,
        displayDate: new Date(biomarker.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        }),
        value: biomarker.value,
        normalMin: biomarker.normalRange.min,
        normalMax: biomarker.normalRange.max
      });
    }

    return historyData;
  }, [biomarker]);

  // Calculate Y-axis domain
  const yDomain = useMemo(() => {
    const allValues = chartData.map(d => d.value);
    const minValue = Math.min(...allValues, biomarker.normalRange.min);
    const maxValue = Math.max(...allValues, biomarker.normalRange.max);
    const padding = (maxValue - minValue) * 0.15;

    return [
      Math.floor(minValue - padding),
      Math.ceil(maxValue + padding)
    ];
  }, [chartData, biomarker.normalRange]);

  // Gradient ID for unique identification
  const gradientId = `biomarker-gradient-${biomarker.id}`;
  const normalRangeGradientId = `normal-range-${biomarker.id}`;

  if (chartData.length === 0) return null;

  return (
    <div className={`w-full ${compact ? '' : 'p-4'}`}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
          margin={{
            top: 20,
            right: compact ? 10 : 30,
            left: compact ? 0 : 10,
            bottom: 10
          }}
        >
          {/* Gradient definitions */}
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.1} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={normalRangeGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Clean grid lines */}
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e2e8f0"
            vertical={false}
          />

          {/* X-axis */}
          <XAxis
            dataKey="displayDate"
            axisLine={false}
            tickLine={false}
            tick={{
              fill: '#64748b',
              fontSize: compact ? 10 : 12,
              fontWeight: 500
            }}
            dy={10}
          />

          {/* Y-axis */}
          <YAxis
            domain={yDomain}
            axisLine={false}
            tickLine={false}
            tick={{
              fill: '#64748b',
              fontSize: compact ? 10 : 12,
              fontWeight: 500
            }}
            tickFormatter={(value) => `${value}`}
            dx={-10}
            width={compact ? 40 : 50}
          />

          {/* Interactive tooltip */}
          <Tooltip
            content={<CustomTooltip biomarker={biomarker} />}
            cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
          />

          {/* Normal range reference area */}
          {showNormalRange && (
            <>
              {/* Normal range fill */}
              <ReferenceLine
                y={biomarker.normalRange.min}
                stroke="#22c55e"
                strokeDasharray="6 4"
                strokeOpacity={0.6}
                label={compact ? undefined : {
                  value: `Min: ${biomarker.normalRange.min}`,
                  position: 'right',
                  fill: '#22c55e',
                  fontSize: 11,
                  fontWeight: 500
                }}
              />
              <ReferenceLine
                y={biomarker.normalRange.max}
                stroke="#22c55e"
                strokeDasharray="6 4"
                strokeOpacity={0.6}
                label={compact ? undefined : {
                  value: `Max: ${biomarker.normalRange.max}`,
                  position: 'right',
                  fill: '#22c55e',
                  fontSize: 11,
                  fontWeight: 500
                }}
              />
            </>
          )}

          {/* Gradient fill under line */}
          {showGradient && (
            <Area
              type="monotone"
              dataKey="value"
              stroke="none"
              fill={`url(#${gradientId})`}
              animationDuration={animate ? 1500 : 0}
              animationEasing="ease-out"
            />
          )}

          {/* Main data line */}
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={(props) => (
              <CustomDot
                {...props}
                dataLength={chartData.length}
              />
            )}
            activeDot={<CustomActiveDot />}
            animationDuration={animate ? 1500 : 0}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend / Unit indicator */}
      {!compact && (
        <div className="flex items-center justify-center gap-6 mt-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-blue-500 rounded" />
            <span className="text-slate-600">Value ({biomarker.unit})</span>
          </div>
          {showNormalRange && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-wellness-500 rounded" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #22c55e 0, #22c55e 3px, transparent 3px, transparent 6px)' }} />
              <span className="text-slate-600">Normal Range</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
