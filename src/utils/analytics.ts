/**
 * Analytics Utility Functions
 *
 * Statistical functions for health trend analysis, correlation calculations,
 * and predictive modeling.
 */

export interface DataPoint {
  date: string;
  value: number;
}

export interface TrendResult {
  direction: 'improving' | 'declining' | 'stable';
  percentChange: number;
  slope: number;
  intercept: number;
  prediction30d: number;
  prediction60d: number;
  prediction90d: number;
}

export interface CorrelationResult {
  coefficient: number;
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  direction: 'positive' | 'negative' | 'none';
}

export interface RiskAlert {
  severity: 'low' | 'medium' | 'high';
  type: 'trending_out_of_range' | 'rapid_change' | 'sustained_abnormal' | 'correlation_warning';
  biomarkerName: string;
  message: string;
  recommendation: string;
  daysUntilOutOfRange?: number;
}

export interface HealthInsight {
  type: 'improvement' | 'concern' | 'goal_progress' | 'correlation' | 'recommendation';
  title: string;
  description: string;
  biomarkerNames: string[];
  icon: 'trending-up' | 'trending-down' | 'target' | 'link' | 'lightbulb' | 'alert';
}

/**
 * Calculate Pearson correlation coefficient between two datasets
 * Returns value between -1 (perfect negative) and 1 (perfect positive)
 */
export function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) {
    return 0;
  }

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
  const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));

  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Analyze correlation strength and direction
 */
export function analyzeCorrelation(coefficient: number): CorrelationResult {
  const absCoeff = Math.abs(coefficient);

  let strength: CorrelationResult['strength'];
  if (absCoeff >= 0.7) strength = 'strong';
  else if (absCoeff >= 0.4) strength = 'moderate';
  else if (absCoeff >= 0.2) strength = 'weak';
  else strength = 'none';

  let direction: CorrelationResult['direction'];
  if (coefficient > 0.1) direction = 'positive';
  else if (coefficient < -0.1) direction = 'negative';
  else direction = 'none';

  return { coefficient, strength, direction };
}

/**
 * Perform linear regression on data points
 * Returns slope, intercept, and predicted values
 */
export function linearRegression(data: DataPoint[]): { slope: number; intercept: number } {
  if (data.length < 2) {
    return { slope: 0, intercept: data[0]?.value || 0 };
  }

  // Convert dates to numeric values (days from first date)
  const firstDate = new Date(data[0].date).getTime();
  const points = data.map(d => ({
    x: (new Date(d.date).getTime() - firstDate) / (1000 * 60 * 60 * 24), // days
    y: d.value
  }));

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

/**
 * Analyze trend for a biomarker
 */
export function analyzeTrend(
  data: DataPoint[],
  normalMin: number,
  normalMax: number,
  isLowerBetter: boolean = false
): TrendResult {
  if (data.length < 2) {
    return {
      direction: 'stable',
      percentChange: 0,
      slope: 0,
      intercept: data[0]?.value || 0,
      prediction30d: data[0]?.value || 0,
      prediction60d: data[0]?.value || 0,
      prediction90d: data[0]?.value || 0,
    };
  }

  const { slope, intercept } = linearRegression(data);

  // Calculate days from first measurement to now
  const firstDate = new Date(data[0].date).getTime();
  const lastDate = new Date(data[data.length - 1].date).getTime();
  const currentDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);

  // Current and predictions
  const currentValue = data[data.length - 1].value;
  const prediction30d = intercept + slope * (currentDays + 30);
  const prediction60d = intercept + slope * (currentDays + 60);
  const prediction90d = intercept + slope * (currentDays + 90);

  // Calculate percent change
  const firstValue = data[0].value;
  const percentChange = firstValue !== 0
    ? ((currentValue - firstValue) / firstValue) * 100
    : 0;

  // Determine direction
  let direction: TrendResult['direction'];
  const slopeThreshold = 0.01 * currentValue; // 1% of current value per day

  if (Math.abs(slope) < slopeThreshold) {
    direction = 'stable';
  } else if (isLowerBetter) {
    direction = slope < 0 ? 'improving' : 'declining';
  } else {
    // For most biomarkers, staying in normal range is good
    const currentInRange = currentValue >= normalMin && currentValue <= normalMax;
    const trendingTowardRange =
      (currentValue < normalMin && slope > 0) ||
      (currentValue > normalMax && slope < 0);

    if (currentInRange) {
      direction = Math.abs(percentChange) < 10 ? 'stable' :
        (slope > 0 ? 'improving' : 'declining');
    } else {
      direction = trendingTowardRange ? 'improving' : 'declining';
    }
  }

  return {
    direction,
    percentChange,
    slope,
    intercept,
    prediction30d,
    prediction60d,
    prediction90d,
  };
}

/**
 * Detect risk alerts based on biomarker trends
 */
export function detectRisks(
  biomarkerName: string,
  data: DataPoint[],
  normalMin: number,
  normalMax: number,
  trend: TrendResult
): RiskAlert[] {
  const alerts: RiskAlert[] = [];

  if (data.length < 2) return alerts;

  const currentValue = data[data.length - 1].value;
  const isOutOfRange = currentValue < normalMin || currentValue > normalMax;

  // Risk 1: Trending toward out of range
  if (!isOutOfRange) {
    const daysUntilLow = trend.slope < 0
      ? (normalMin - currentValue) / trend.slope
      : Infinity;
    const daysUntilHigh = trend.slope > 0
      ? (normalMax - currentValue) / trend.slope
      : Infinity;
    const daysUntilOutOfRange = Math.min(
      daysUntilLow > 0 ? daysUntilLow : Infinity,
      daysUntilHigh > 0 ? daysUntilHigh : Infinity
    );

    if (daysUntilOutOfRange <= 90 && daysUntilOutOfRange > 0) {
      alerts.push({
        severity: daysUntilOutOfRange <= 30 ? 'high' : daysUntilOutOfRange <= 60 ? 'medium' : 'low',
        type: 'trending_out_of_range',
        biomarkerName,
        message: `${biomarkerName} may move out of normal range in ~${Math.round(daysUntilOutOfRange)} days`,
        recommendation: 'Consider discussing with your healthcare provider',
        daysUntilOutOfRange: Math.round(daysUntilOutOfRange),
      });
    }
  }

  // Risk 2: Rapid change (>20% in recent data)
  if (data.length >= 2) {
    const recentData = data.slice(-5); // Last 5 measurements
    if (recentData.length >= 2) {
      const recentFirst = recentData[0].value;
      const recentLast = recentData[recentData.length - 1].value;
      const recentChange = Math.abs((recentLast - recentFirst) / recentFirst) * 100;

      if (recentChange > 20) {
        alerts.push({
          severity: recentChange > 40 ? 'high' : 'medium',
          type: 'rapid_change',
          biomarkerName,
          message: `${biomarkerName} has changed ${recentChange.toFixed(1)}% recently`,
          recommendation: 'Monitor closely and discuss significant changes with your doctor',
        });
      }
    }
  }

  // Risk 3: Sustained abnormal (3+ consecutive out of range)
  if (data.length >= 3) {
    const lastThree = data.slice(-3);
    const allOutOfRange = lastThree.every(d => d.value < normalMin || d.value > normalMax);

    if (allOutOfRange) {
      alerts.push({
        severity: 'high',
        type: 'sustained_abnormal',
        biomarkerName,
        message: `${biomarkerName} has been out of range for ${lastThree.length} consecutive measurements`,
        recommendation: 'Schedule a follow-up with your healthcare provider',
      });
    }
  }

  return alerts;
}

/**
 * Generate personalized health insights
 */
export function generateInsights(
  biomarkers: Array<{
    name: string;
    data: DataPoint[];
    normalMin: number;
    normalMax: number;
    trend: TrendResult;
  }>,
  goals?: Array<{
    biomarkerName: string;
    targetValue: number;
    currentValue: number;
    startValue: number;
  }>
): HealthInsight[] {
  const insights: HealthInsight[] = [];

  // Insight 1: Improvements
  biomarkers.forEach(b => {
    if (b.trend.direction === 'improving' && Math.abs(b.trend.percentChange) > 10) {
      insights.push({
        type: 'improvement',
        title: `${b.name} Improving`,
        description: `Your ${b.name} has improved by ${Math.abs(b.trend.percentChange).toFixed(1)}% over the tracking period.`,
        biomarkerNames: [b.name],
        icon: 'trending-up',
      });
    }
  });

  // Insight 2: Concerns
  biomarkers.forEach(b => {
    if (b.trend.direction === 'declining' && Math.abs(b.trend.percentChange) > 10) {
      const currentValue = b.data[b.data.length - 1]?.value;
      const isOutOfRange = currentValue < b.normalMin || currentValue > b.normalMax;

      if (isOutOfRange) {
        insights.push({
          type: 'concern',
          title: `${b.name} Needs Attention`,
          description: `Your ${b.name} is trending ${b.trend.percentChange > 0 ? 'up' : 'down'} and is currently out of the normal range.`,
          biomarkerNames: [b.name],
          icon: 'alert',
        });
      }
    }
  });

  // Insight 3: Goal progress
  goals?.forEach(goal => {
    const progress = ((goal.currentValue - goal.startValue) / (goal.targetValue - goal.startValue)) * 100;
    if (progress >= 50 && progress < 100) {
      insights.push({
        type: 'goal_progress',
        title: `Halfway to Your ${goal.biomarkerName} Goal`,
        description: `You're ${progress.toFixed(0)}% of the way to your ${goal.biomarkerName} target of ${goal.targetValue}.`,
        biomarkerNames: [goal.biomarkerName],
        icon: 'target',
      });
    } else if (progress >= 100) {
      insights.push({
        type: 'goal_progress',
        title: `${goal.biomarkerName} Goal Achieved!`,
        description: `Congratulations! You've reached your ${goal.biomarkerName} target.`,
        biomarkerNames: [goal.biomarkerName],
        icon: 'target',
      });
    }
  });

  // Insight 4: Stable biomarkers in range
  const stableInRange = biomarkers.filter(b => {
    const currentValue = b.data[b.data.length - 1]?.value;
    return b.trend.direction === 'stable' &&
      currentValue >= b.normalMin &&
      currentValue <= b.normalMax;
  });

  if (stableInRange.length >= 3) {
    insights.push({
      type: 'improvement',
      title: 'Maintaining Good Health',
      description: `${stableInRange.length} of your biomarkers are stable and within normal range.`,
      biomarkerNames: stableInRange.map(b => b.name),
      icon: 'trending-up',
    });
  }

  return insights.slice(0, 6); // Limit to 6 insights
}

/**
 * Format percentage for display
 */
export function formatPercentChange(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * Get color class based on trend direction
 */
export function getTrendColor(direction: TrendResult['direction']): string {
  switch (direction) {
    case 'improving':
      return 'text-emerald-500';
    case 'declining':
      return 'text-rose-500';
    case 'stable':
    default:
      return 'text-slate-500';
  }
}

/**
 * Get background color class based on trend direction
 */
export function getTrendBgColor(direction: TrendResult['direction']): string {
  switch (direction) {
    case 'improving':
      return 'bg-emerald-50';
    case 'declining':
      return 'bg-rose-50';
    case 'stable':
    default:
      return 'bg-slate-50';
  }
}

/**
 * Get color for correlation coefficient
 */
export function getCorrelationColor(coefficient: number): string {
  if (coefficient > 0.5) return 'bg-emerald-500';
  if (coefficient > 0.2) return 'bg-emerald-300';
  if (coefficient > -0.2) return 'bg-slate-200';
  if (coefficient > -0.5) return 'bg-rose-300';
  return 'bg-rose-500';
}

/**
 * Get severity color for risk alerts
 */
export function getRiskSeverityColor(severity: RiskAlert['severity']): {
  bg: string;
  text: string;
  border: string;
} {
  switch (severity) {
    case 'high':
      return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' };
    case 'medium':
      return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' };
    case 'low':
    default:
      return { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' };
  }
}
