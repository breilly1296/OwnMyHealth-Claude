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
import {
  performHealthAnalysis,
  getHealthAnalysisResult,
  mapSeverityToUrgency,
  mapConditionToSpecialty,
  type HealthAnalysisResult,
} from '../services/healthAnalysisService.js';

const RESOURCE_TYPE = 'HealthAnalysis';

// Analyze user's health based on biomarkers
export async function analyzeHealth(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  // Get decrypted biomarkers
  const biomarkers = await getDecryptedBiomarkersForUser(userId);

  const internalAnalysis = performHealthAnalysis(biomarkers);

  // Get frontend-formatted analysis result
  const analysisResult = getHealthAnalysisResult(biomarkers);

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

