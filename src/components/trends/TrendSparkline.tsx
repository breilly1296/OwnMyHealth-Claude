/**
 * TrendSparkline Component
 *
 * A compact sparkline chart for displaying biomarker trends in cards.
 * Shows a small line chart without axes, with optional normal range shading.
 *
 * Features:
 * - Tiny form factor (~100px wide)
 * - Normal range as subtle shaded area
 * - Line color changes based on current value status
 * - No axes or labels for minimal footprint
 *
 * @module components/trends/TrendSparkline
 */

import { useMemo, useId } from 'react';
import {
  Line,
  ResponsiveContainer,
  ComposedChart,
  Area,
  ReferenceLine,
} from 'recharts';
import type { BiomarkerHistory } from '../../types';

interface TrendSparklineProps {
  /** Historical data points to display */
  data: BiomarkerHistory[];
  /** Current biomarker value */
  currentValue: number;
  /** Current measurement date */
  currentDate: string;
  /** Normal range boundaries */
  normalRange: { min: number; max: number };
  /** Width of the sparkline (default: 100) */
  width?: number;
  /** Height of the sparkline (default: 40) */
  height?: number;
  /** Whether current value is out of range */
  isOutOfRange?: boolean;
}

interface SparklineDataPoint {
  date: string;
  value: number;
  normalMin: number;
  normalMax: number;
}

export default function TrendSparkline({
  data,
  currentValue,
  currentDate,
  normalRange,
  width = 100,
  height = 40,
  isOutOfRange = false,
}: TrendSparklineProps) {
  // Process data for sparkline
  const chartData = useMemo<SparklineDataPoint[]>(() => {
    const points: SparklineDataPoint[] = data.map((h) => ({
      date: h.date,
      value: h.value,
      normalMin: normalRange.min,
      normalMax: normalRange.max,
    }));

    // Add current value if newer than last history point
    const lastDate = data.length > 0 ? new Date(data[data.length - 1].date) : new Date(0);
    const current = new Date(currentDate);

    if (current > lastDate) {
      points.push({
        date: currentDate,
        value: currentValue,
        normalMin: normalRange.min,
        normalMax: normalRange.max,
      });
    }

    return points;
  }, [data, currentValue, currentDate, normalRange]);

  // Stable, per-instance unique gradient IDs. Date.now() produced identical
  // ids for sparklines rendered in the same tick (duplicate DOM ids →
  // url(#id) resolves to the first match → gradient bleed across charts) and
  // changed every render. useId() is unique per instance and stable. Strip
  // the colons React emits so the value is safe inside an SVG url(#...) ref.
  const uid = useId().replace(/:/g, '');
  const gradientId = `sparkline-gradient-${uid}`;
  const normalRangeId = `sparkline-normal-${uid}`;

  // Line color based on status
  const lineColor = isOutOfRange ? '#ef4444' : '#3b82f6';
  const gradientColor = isOutOfRange ? '#ef4444' : '#3b82f6';

  if (chartData.length < 2) {
    // Not enough data for sparkline
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-xs text-slate-400 dark:text-slate-500"
      >
        —
      </div>
    );
  }

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            {/* Line gradient */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradientColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={gradientColor} stopOpacity={0.05} />
            </linearGradient>
            {/* Normal range gradient */}
            <linearGradient id={normalRangeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          {/* Normal range reference lines (subtle) */}
          <ReferenceLine
            y={normalRange.min}
            stroke="#22c55e"
            strokeDasharray="2 2"
            strokeOpacity={0.3}
            strokeWidth={1}
          />
          <ReferenceLine
            y={normalRange.max}
            stroke="#22c55e"
            strokeDasharray="2 2"
            strokeOpacity={0.3}
            strokeWidth={1}
          />

          {/* Gradient fill under line */}
          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fill={`url(#${gradientId})`}
            animationDuration={500}
          />

          {/* Main sparkline */}
          <Line
            type="monotone"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={false}
            animationDuration={500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
