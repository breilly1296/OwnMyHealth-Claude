/**
 * Health Analysis Service
 *
 * Shared business logic for health analysis based on biomarkers.
 * Extracted from healthController for reusability across the application.
 */

// Types for biomarker input
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
 * Generate trend analyses for biomarkers
 * Note: Simplified version - returns stable trends since historical comparison not yet implemented
 */
export function generateTrendAnalyses(biomarkers: DecryptedBiomarker[]): TrendAnalysis[] {
  return biomarkers.map(biomarker => ({
    biomarkerId: biomarker.id,
    biomarkerName: biomarker.name,
    trend: 'stable' as const,
    percentChange: 0,
    prediction: `Continue monitoring ${biomarker.name} levels`,
  }));
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
