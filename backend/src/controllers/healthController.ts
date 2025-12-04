/**
 * Health Controller
 *
 * Handles health analysis and recommendations based on biomarkers.
 * Uses decrypted biomarker values from the biomarkerController.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse, HealthNeed } from '../types/index.js';
import { getDecryptedBiomarkersForUser } from './biomarkerController.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';

const RESOURCE_TYPE = 'HealthAnalysis';

// Frontend-aligned health analysis types
interface HealthAnalysisResult {
  overallHealthScore: number;
  riskAssessments: RiskAssessment[];
  trendAnalyses: TrendAnalysis[];
  priorityActions: string[];
}

interface RiskAssessment {
  biomarkerId: string;
  biomarkerName: string;
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  riskScore: number;
  riskFactors: string[];
  recommendations: string[];
}

interface TrendAnalysis {
  biomarkerId: string;
  biomarkerName: string;
  trend: 'improving' | 'stable' | 'declining';
  percentChange: number;
  prediction: string;
}

// Internal types for analysis
interface DetectedCondition {
  name: string;
  severity: 'mild' | 'moderate' | 'severe';
  relatedBiomarkers: string[];
  description: string;
}

interface Recommendation {
  type: 'lifestyle' | 'medical' | 'monitoring';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

interface PriorityAction {
  action: string;
  urgency: 'immediate' | 'urgent' | 'follow-up' | 'routine';
  reason: string;
  relatedBiomarker?: string;
}

// Internal analysis result (used for other endpoints)
interface InternalAnalysis {
  overallScore: number;
  riskLevel: 'low' | 'moderate' | 'high';
  conditions: DetectedCondition[];
  recommendations: Recommendation[];
  priorityActions: PriorityAction[];
}

// Biomarker type from decrypted response
interface DecryptedBiomarker {
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

// Analyze user's health based on biomarkers
export async function analyzeHealth(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  // Get decrypted biomarkers
  const biomarkers = await getDecryptedBiomarkersForUser(userId);

  const internalAnalysis = performHealthAnalysis(biomarkers);

  // Transform to frontend-expected format
  const analysisResult: HealthAnalysisResult = {
    overallHealthScore: internalAnalysis.overallScore,
    riskAssessments: generateRiskAssessments(biomarkers),
    trendAnalyses: generateTrendAnalyses(biomarkers),
    priorityActions: internalAnalysis.priorityActions.map(a => a.action),
  };

  // Audit log: READ access to health analysis
  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'FULL_ANALYSIS',
    biomarkerCount: biomarkers.length,
    conditionsDetected: internalAnalysis.conditions.length,
    riskLevel: internalAnalysis.riskLevel,
  });

  const response: ApiResponse<HealthAnalysisResult> = {
    success: true,
    data: analysisResult,
  };

  res.json(response);
}

// Get health needs (conditions + actions)
export async function getHealthNeeds(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  // Get decrypted biomarkers
  const biomarkers = await getDecryptedBiomarkersForUser(userId);

  const analysis = performHealthAnalysis(biomarkers);

  const healthNeeds: HealthNeed[] = [
    ...analysis.conditions.map((c, i) => ({
      id: `condition-${i}`,
      userId,
      type: 'condition' as const,
      name: c.name,
      description: c.description,
      urgency: mapSeverityToUrgency(c.severity),
      status: 'pending' as const,
      relatedBiomarkers: c.relatedBiomarkers,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    ...analysis.priorityActions.map((a, i) => ({
      id: `action-${i}`,
      userId,
      type: 'action' as const,
      name: a.action,
      description: a.reason,
      urgency: a.urgency,
      status: 'pending' as const,
      relatedBiomarkers: a.relatedBiomarker ? [a.relatedBiomarker] : [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  ];

  // Audit log: READ access to health needs analysis
  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'HEALTH_NEEDS',
    conditionsCount: analysis.conditions.length,
    actionsCount: analysis.priorityActions.length,
  });

  const response: ApiResponse<HealthNeed[]> = {
    success: true,
    data: healthNeeds,
  };

  res.json(response);
}

// Get provider recommendations based on health needs
export async function getProviderRecommendations(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  // Get decrypted biomarkers
  const biomarkers = await getDecryptedBiomarkersForUser(userId);

  const analysis = performHealthAnalysis(biomarkers);

  // Generate provider recommendations based on detected conditions
  const recommendations = analysis.conditions.map((condition) => ({
    specialty: mapConditionToSpecialty(condition.name),
    reason: condition.description,
    urgency: mapSeverityToUrgency(condition.severity),
    relatedConditions: [condition.name],
  }));

  // Audit log: READ access to provider recommendations
  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'PROVIDER_RECOMMENDATIONS',
    recommendationsCount: recommendations.length,
  });

  const response: ApiResponse<typeof recommendations> = {
    success: true,
    data: recommendations,
  };

  res.json(response);
}

// Get health score
export async function getHealthScore(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  // Get decrypted biomarkers
  const biomarkers = await getDecryptedBiomarkersForUser(userId);

  const analysis = performHealthAnalysis(biomarkers);

  // Audit log: READ access to health score
  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'HEALTH_SCORE',
    score: analysis.overallScore,
    riskLevel: analysis.riskLevel,
  });

  const response: ApiResponse<{ score: number; riskLevel: string }> = {
    success: true,
    data: {
      score: analysis.overallScore,
      riskLevel: analysis.riskLevel,
    },
  };

  res.json(response);
}

// Helper functions

// Generate risk assessments for frontend
function generateRiskAssessments(biomarkers: DecryptedBiomarker[]): RiskAssessment[] {
  return biomarkers.map(biomarker => {
    const isOutOfRange = biomarker.value < biomarker.normalRange.min ||
                         biomarker.value > biomarker.normalRange.max;
    const isLow = biomarker.value < biomarker.normalRange.min;

    // Calculate deviation percentage
    let deviation = 0;
    if (isOutOfRange) {
      deviation = isLow
        ? (biomarker.normalRange.min - biomarker.value) / biomarker.normalRange.min
        : (biomarker.value - biomarker.normalRange.max) / biomarker.normalRange.max;
    }

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

// Generate trend analyses for frontend (simplified - no historical data yet)
function generateTrendAnalyses(biomarkers: DecryptedBiomarker[]): TrendAnalysis[] {
  // For now, return stable trends since we don't have historical comparison
  // In future, this would compare against previous readings
  return biomarkers.map(biomarker => ({
    biomarkerId: biomarker.id,
    biomarkerName: biomarker.name,
    trend: 'stable' as const,
    percentChange: 0,
    prediction: `Continue monitoring ${biomarker.name} levels`,
  }));
}

function performHealthAnalysis(biomarkers: DecryptedBiomarker[]): InternalAnalysis {
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

function detectConditions(outOfRangeBiomarkers: DecryptedBiomarker[]): DetectedCondition[] {
  const conditions: DetectedCondition[] = [];

  for (const biomarker of outOfRangeBiomarkers) {
    const isLow = biomarker.value < biomarker.normalRange.min;
    const deviation = isLow
      ? (biomarker.normalRange.min - biomarker.value) / biomarker.normalRange.min
      : (biomarker.value - biomarker.normalRange.max) / biomarker.normalRange.max;

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

function generateRecommendations(outOfRangeBiomarkers: DecryptedBiomarker[]): Recommendation[] {
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

function generatePriorityActions(outOfRangeBiomarkers: DecryptedBiomarker[]): PriorityAction[] {
  return outOfRangeBiomarkers.map((biomarker) => {
    const isLow = biomarker.value < biomarker.normalRange.min;
    const deviation = isLow
      ? (biomarker.normalRange.min - biomarker.value) / biomarker.normalRange.min
      : (biomarker.value - biomarker.normalRange.max) / biomarker.normalRange.max;

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

function mapSeverityToUrgency(
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

function mapConditionToSpecialty(condition: string): string {
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
