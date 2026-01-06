/**
 * healthAnalysisService.ts - Health Analysis Business Logic
 *
 * This service provides core health analysis functionality based on biomarker data.
 * It is used by multiple controllers and can be reused throughout the application.
 *
 * Key Features:
 * 1. Risk Assessment - Calculates risk levels based on biomarker deviations
 * 2. Trend Analysis - Tracks biomarker changes over time (future: historical comparison)
 * 3. Condition Detection - Identifies potential health conditions from out-of-range values
 * 4. Recommendations - Generates lifestyle and medical recommendations
 * 5. Priority Actions - Creates actionable items based on urgency
 *
 * Risk Level Calculation:
 * - Low: Within normal range
 * - Moderate: 10-30% deviation from normal
 * - High: 30-50% deviation from normal
 * - Critical: >50% deviation from normal
 *
 * Health Score Calculation:
 * - Score = (biomarkers in range / total biomarkers) * 100
 * - Score < 50% = High risk
 * - Score 50-80% = Moderate risk
 * - Score > 80% = Low risk
 *
 * Category-Based Recommendations:
 * - Lipids: Heart-healthy diet suggestions
 * - Metabolic: Blood sugar management
 * - Kidney: Nephrology referral
 * - Liver: Hepatology referral
 *
 * Usage:
 * ```typescript
 * import { performHealthAnalysis, getHealthAnalysisResult } from './healthAnalysisService';
 *
 * const analysis = performHealthAnalysis(biomarkers);
 * const frontendResult = getHealthAnalysisResult(biomarkers);
 * ```
 *
 * @module services/healthAnalysisService
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Decrypted biomarker data from the database */
export interface DecryptedBiomarker {
  id: string;
  userId: string;
  category: string;
  name: string;
  unit: string;
  value: number;
  notes?: string;
  normalRange: {
    min: number;
    max: number;
    source?: string;
  };
  date: string;
  isOutOfRange: boolean;
}

// Frontend-aligned types
export interface RiskAssessment {
  biomarkerId: string;
  biomarkerName: string;
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  riskScore: number;
  riskFactors: string[];
  recommendations: string[];
}

export interface TrendAnalysis {
  biomarkerId: string;
  biomarkerName: string;
  trend: 'improving' | 'stable' | 'declining';
  percentChange: number;
  prediction: string;
}

/** Historical biomarker value for trend analysis */
export interface HistoricalValue {
  value: number;
  date: string;
}

/** Biomarker with historical data for trend analysis */
export interface BiomarkerWithHistory extends DecryptedBiomarker {
  history?: HistoricalValue[];
}

export interface HealthAnalysisResult {
  overallHealthScore: number;
  riskAssessments: RiskAssessment[];
  trendAnalyses: TrendAnalysis[];
  priorityActions: string[];
}

// Internal analysis types
export interface DetectedCondition {
  name: string;
  severity: 'mild' | 'moderate' | 'severe';
  relatedBiomarkers: string[];
  description: string;
}

export interface Recommendation {
  type: 'lifestyle' | 'medical' | 'monitoring';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface PriorityAction {
  action: string;
  urgency: 'immediate' | 'urgent' | 'follow-up' | 'routine';
  reason: string;
  relatedBiomarker?: string;
}

export interface InternalAnalysis {
  overallScore: number;
  riskLevel: 'low' | 'moderate' | 'high';
  conditions: DetectedCondition[];
  recommendations: Recommendation[];
  priorityActions: PriorityAction[];
}

/**
 * Calculate deviation percentage from normal range
 */
export function calculateDeviation(
  value: number,
  min: number,
  max: number
): { isOutOfRange: boolean; isLow: boolean; deviation: number } {
  const isLow = value < min;
  const isHigh = value > max;
  const isOutOfRange = isLow || isHigh;

  let deviation = 0;
  if (isOutOfRange) {
    deviation = isLow
      ? (min - value) / min
      : (value - max) / max;
  }

  return { isOutOfRange, isLow, deviation };
}

/**
 * Generate risk assessments for each biomarker
 */
export function generateRiskAssessments(biomarkers: DecryptedBiomarker[]): RiskAssessment[] {
  return biomarkers.map(biomarker => {
    const { isOutOfRange, isLow, deviation } = calculateDeviation(
      biomarker.value,
      biomarker.normalRange.min,
      biomarker.normalRange.max
    );

    // Determine risk level based on deviation
    let riskLevel: 'low' | 'moderate' | 'high' | 'critical' = 'low';
    let riskScore = 0;
    if (deviation > 0.5) {
      riskLevel = 'critical';
      riskScore = 90;
    } else if (deviation > 0.3) {
      riskLevel = 'high';
      riskScore = 70;
    } else if (deviation > 0.1) {
      riskLevel = 'moderate';
      riskScore = 40;
    } else if (isOutOfRange) {
      riskLevel = 'moderate';
      riskScore = 25;
    } else {
      riskScore = 10;
    }

    const riskFactors: string[] = [];
    const recommendations: string[] = [];

    if (isOutOfRange) {
      riskFactors.push(`${biomarker.name} is ${isLow ? 'below' : 'above'} normal range`);
      recommendations.push(`Consult with your healthcare provider about your ${biomarker.name} levels`);
    }

    return {
      biomarkerId: biomarker.id,
      biomarkerName: biomarker.name,
      riskLevel,
      riskScore,
      riskFactors,
      recommendations,
    };
  });
}

/**
 * Determine if a value change represents improvement
 * Improvement means moving toward the normal range
 */
function isImproving(
  currentValue: number,
  previousValue: number,
  normalMin: number,
  normalMax: number
): boolean {
  const normalMid = (normalMin + normalMax) / 2;
  const currentDistance = Math.abs(currentValue - normalMid);
  const previousDistance = Math.abs(previousValue - normalMid);
  return currentDistance < previousDistance;
}

/**
 * Generate prediction message based on trend and current status
 */
function generatePrediction(
  biomarkerName: string,
  trend: 'improving' | 'stable' | 'declining',
  isCurrentlyOutOfRange: boolean,
  percentChange: number
): string {
  if (trend === 'improving') {
    if (isCurrentlyOutOfRange) {
      return `${biomarkerName} is trending toward normal range. Continue current management.`;
    }
    return `${biomarkerName} is improving and within normal range. Maintain current lifestyle.`;
  }

  if (trend === 'declining') {
    if (isCurrentlyOutOfRange) {
      return `${biomarkerName} is moving further from normal range. Consider consulting your healthcare provider.`;
    }
    return `${biomarkerName} is declining (${Math.abs(percentChange).toFixed(1)}% change). Monitor closely.`;
  }

  // Stable
  if (isCurrentlyOutOfRange) {
    return `${biomarkerName} remains out of range. Follow up with your healthcare provider.`;
  }
  return `${biomarkerName} is stable and within normal range. Continue monitoring.`;
}

/**
 * Generate trend analyses for biomarkers
 * Compares current values to historical data to determine trends
 *
 * @param biomarkers - Current biomarker values, optionally with history
 * @returns Array of trend analyses for each biomarker
 */
export function generateTrendAnalyses(biomarkers: (DecryptedBiomarker | BiomarkerWithHistory)[]): TrendAnalysis[] {
  return biomarkers.map(biomarker => {
    const biomarkerWithHistory = biomarker as BiomarkerWithHistory;
    const history = biomarkerWithHistory.history;

    // If no historical data, return stable with appropriate message
    if (!history || history.length === 0) {
      return {
        biomarkerId: biomarker.id,
        biomarkerName: biomarker.name,
        trend: 'stable' as const,
        percentChange: 0,
        prediction: `Continue monitoring ${biomarker.name} levels. Add more readings for trend analysis.`,
      };
    }

    // Sort history by date (oldest first) and get the most recent previous value
    const sortedHistory = [...history].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Get the previous value (most recent in history)
    const previousValue = sortedHistory[sortedHistory.length - 1].value;
    const currentValue = biomarker.value;

    // Calculate percent change
    const percentChange = previousValue !== 0
      ? ((currentValue - previousValue) / previousValue) * 100
      : 0;

    // Determine trend based on direction relative to normal range
    const { normalRange } = biomarker;
    let trend: 'improving' | 'stable' | 'declining';

    // Use 5% threshold for "stable" classification
    const STABILITY_THRESHOLD = 5;

    if (Math.abs(percentChange) < STABILITY_THRESHOLD) {
      trend = 'stable';
    } else if (isImproving(currentValue, previousValue, normalRange.min, normalRange.max)) {
      trend = 'improving';
    } else {
      trend = 'declining';
    }

    // Check if currently out of range
    const isCurrentlyOutOfRange = currentValue < normalRange.min || currentValue > normalRange.max;

    // Generate contextual prediction
    const prediction = generatePrediction(
      biomarker.name,
      trend,
      isCurrentlyOutOfRange,
      percentChange
    );

    return {
      biomarkerId: biomarker.id,
      biomarkerName: biomarker.name,
      trend,
      percentChange: Math.round(percentChange * 10) / 10, // Round to 1 decimal
      prediction,
    };
  });
}

/**
 * Detect health conditions based on out-of-range biomarkers
 */
export function detectConditions(outOfRangeBiomarkers: DecryptedBiomarker[]): DetectedCondition[] {
  const conditions: DetectedCondition[] = [];

  for (const biomarker of outOfRangeBiomarkers) {
    const { isLow, deviation } = calculateDeviation(
      biomarker.value,
      biomarker.normalRange.min,
      biomarker.normalRange.max
    );

    let severity: 'mild' | 'moderate' | 'severe' = 'mild';
    if (deviation > 0.5) severity = 'severe';
    else if (deviation > 0.2) severity = 'moderate';

    conditions.push({
      name: `${isLow ? 'Low' : 'High'} ${biomarker.name}`,
      severity,
      relatedBiomarkers: [biomarker.name],
      description: `Your ${biomarker.name} level (${biomarker.value} ${biomarker.unit}) is ${isLow ? 'below' : 'above'} the normal range (${biomarker.normalRange.min}-${biomarker.normalRange.max} ${biomarker.unit}).`,
    });
  }

  return conditions;
}

/**
 * Generate health recommendations based on out-of-range biomarkers
 */
export function generateRecommendations(outOfRangeBiomarkers: DecryptedBiomarker[]): Recommendation[] {
  const recommendations: Recommendation[] = [];

  if (outOfRangeBiomarkers.length > 0) {
    recommendations.push({
      type: 'medical',
      title: 'Schedule a Follow-up',
      description:
        'Consider scheduling an appointment with your healthcare provider to discuss your results.',
      priority: 'high',
    });
  }

  // Add lifestyle recommendations based on categories
  const categories = [...new Set(outOfRangeBiomarkers.map((b) => b.category))];

  if (categories.includes('Lipids')) {
    recommendations.push({
      type: 'lifestyle',
      title: 'Heart-Healthy Diet',
      description:
        'Consider adopting a heart-healthy diet low in saturated fats and high in fiber.',
      priority: 'medium',
    });
  }

  if (categories.includes('Blood')) {
    recommendations.push({
      type: 'monitoring',
      title: 'Regular Monitoring',
      description: 'Continue to monitor your blood markers regularly.',
      priority: 'medium',
    });
  }

  if (categories.includes('Metabolic')) {
    recommendations.push({
      type: 'lifestyle',
      title: 'Blood Sugar Management',
      description:
        'Consider dietary changes to help manage blood sugar levels, such as reducing refined carbohydrates.',
      priority: 'medium',
    });
  }

  if (categories.includes('Kidney')) {
    recommendations.push({
      type: 'medical',
      title: 'Kidney Function Review',
      description:
        'Discuss your kidney function markers with your healthcare provider.',
      priority: 'high',
    });
  }

  if (categories.includes('Liver')) {
    recommendations.push({
      type: 'medical',
      title: 'Liver Health Review',
      description:
        'Discuss your liver function markers with your healthcare provider.',
      priority: 'high',
    });
  }

  return recommendations;
}

/**
 * Generate priority actions from out-of-range biomarkers
 */
export function generatePriorityActions(outOfRangeBiomarkers: DecryptedBiomarker[]): PriorityAction[] {
  return outOfRangeBiomarkers.map((biomarker) => {
    const { isLow, deviation } = calculateDeviation(
      biomarker.value,
      biomarker.normalRange.min,
      biomarker.normalRange.max
    );

    let urgency: 'immediate' | 'urgent' | 'follow-up' | 'routine' = 'routine';
    if (deviation > 0.5) urgency = 'immediate';
    else if (deviation > 0.3) urgency = 'urgent';
    else if (deviation > 0.1) urgency = 'follow-up';

    return {
      action: `Review ${biomarker.name} with healthcare provider`,
      urgency,
      reason: `${biomarker.name} is ${isLow ? 'low' : 'high'} at ${biomarker.value} ${biomarker.unit}`,
      relatedBiomarker: biomarker.name,
    };
  });
}

/**
 * Perform full health analysis on biomarkers
 */
export function performHealthAnalysis(biomarkers: DecryptedBiomarker[]): InternalAnalysis {
  if (biomarkers.length === 0) {
    return {
      overallScore: 100,
      riskLevel: 'low',
      conditions: [],
      recommendations: [
        {
          type: 'monitoring',
          title: 'Add Biomarker Data',
          description: 'Upload your lab results or add biomarkers manually to get health insights.',
          priority: 'medium',
        },
      ],
      priorityActions: [],
    };
  }

  const outOfRange = biomarkers.filter(
    (b) => b.value < b.normalRange.min || b.value > b.normalRange.max
  );

  const inRangePercentage =
    ((biomarkers.length - outOfRange.length) / biomarkers.length) * 100;

  // Calculate overall score
  const overallScore = Math.round(inRangePercentage);

  // Determine risk level
  let riskLevel: 'low' | 'moderate' | 'high' = 'low';
  if (inRangePercentage < 50) {
    riskLevel = 'high';
  } else if (inRangePercentage < 80) {
    riskLevel = 'moderate';
  }

  // Detect conditions based on out-of-range biomarkers
  const conditions = detectConditions(outOfRange);

  // Generate recommendations
  const recommendations = generateRecommendations(outOfRange);

  // Generate priority actions
  const priorityActions = generatePriorityActions(outOfRange);

  return {
    overallScore,
    riskLevel,
    conditions,
    recommendations,
    priorityActions,
  };
}

/**
 * Map severity to urgency level
 */
export function mapSeverityToUrgency(
  severity: string
): 'immediate' | 'urgent' | 'follow-up' | 'routine' {
  switch (severity) {
    case 'severe':
      return 'immediate';
    case 'moderate':
      return 'urgent';
    default:
      return 'follow-up';
  }
}

/**
 * Map health condition to recommended medical specialty
 */
export function mapConditionToSpecialty(condition: string): string {
  const conditionLower = condition.toLowerCase();

  if (conditionLower.includes('glucose') || conditionLower.includes('a1c')) {
    return 'Endocrinology';
  }
  if (conditionLower.includes('cholesterol') || conditionLower.includes('lipid')) {
    return 'Cardiology';
  }
  if (conditionLower.includes('vitamin')) {
    return 'Internal Medicine';
  }
  if (conditionLower.includes('kidney') || conditionLower.includes('creatinine')) {
    return 'Nephrology';
  }
  if (
    conditionLower.includes('liver') ||
    conditionLower.includes('alt') ||
    conditionLower.includes('ast')
  ) {
    return 'Hepatology';
  }
  if (conditionLower.includes('thyroid') || conditionLower.includes('tsh')) {
    return 'Endocrinology';
  }
  if (conditionLower.includes('iron') || conditionLower.includes('hemoglobin')) {
    return 'Hematology';
  }

  return 'Internal Medicine';
}

/**
 * Get frontend-formatted health analysis result
 */
export function getHealthAnalysisResult(biomarkers: DecryptedBiomarker[]): HealthAnalysisResult {
  const internalAnalysis = performHealthAnalysis(biomarkers);

  return {
    overallHealthScore: internalAnalysis.overallScore,
    riskAssessments: generateRiskAssessments(biomarkers),
    trendAnalyses: generateTrendAnalyses(biomarkers),
    priorityActions: internalAnalysis.priorityActions.map(a => a.action),
  };
}
