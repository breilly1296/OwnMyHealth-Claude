/**
 * API Service Layer
 *
 * Re-exports all domain APIs for backward compatibility.
 * Import from here or from individual domain files.
 */

// Core client exports
export {
  API_BASE_URL,
  apiFetch,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  setOnAuthFailure,
  attemptTokenRefresh,
  isPlanLimitError,
} from './client';
export type { ApiResponse, ApiError } from './client';

// Auth API
export { authApi } from './auth';
export type { LoginCredentials, RegisterData, AuthResponse } from './auth';

// Biomarkers API
export { biomarkersApi } from './biomarkers';
export type { BiomarkerData, BiomarkerHistory, CreateBiomarkerData } from './biomarkers';

// Insurance API
export { insuranceApi } from './insurance';
export type { InsurancePlanData, InsuranceBenefitData, CreateInsurancePlanData } from './insurance';

// Health Needs API
export { healthNeedsApi } from './healthNeeds';
export type { HealthNeedData, CreateHealthNeedData } from './healthNeeds';

// Health Goals API
export { healthGoalsApi } from './healthGoals';
export type {
  HealthGoalData,
  CreateHealthGoalData,
  UpdateHealthGoalData,
  GoalProgressUpdate,
  GoalsSummary,
  HealthGoalSuggestion,
} from './healthGoals';

// Upload API
export { uploadApi } from './upload';

// Provider API
export { providerApi } from './provider';
export type { UserRole, ProviderPatientRelationship } from './provider';

// Patient API
export { patientApi } from './patient';
export type { PatientProviderRelationship, PendingProviderRequest } from './patient';

// Admin API
export { adminApi } from './admin';
export type { AdminUser, SystemStats } from './admin';

// AI Health Guide
export { aiApi } from './ai';
export type { ConversationMessage, ChatUsage, ChatStreamCallbacks } from './ai';

// Settings API
export { settingsApi } from './settings';
export type {
  ExportBiomarker,
  ExportInsurancePlan,
  UserExportData,
  NotificationPreferences,
  EmailNotificationPreferences,
  UserProfile,
  UserHealthProfile,
  UpdateHealthProfileData,
  HealthCondition,
  Medication,
  BiologicalSex,
  AgeRange,
  ConditionStatus,
  SmokingStatus,
  ExerciseLevel,
} from './settings';

// Files API
export { filesApi } from './files';
export type { UserFileData } from './files';

// Onboarding API
export { onboardingApi } from './onboarding';
export type { OnboardingStatus, OnboardingSteps, SuggestedNextStep } from './onboarding';

// Plan API
export { planApi, isUnlimited as isPlanLimitUnlimited } from './plan';
export type {
  PlanTier,
  PlanLimits,
  PlanConfig,
  PlanUsage,
  CurrentPlanData,
} from './plan';

// FHIR / Lab Connections API
export { fhirApi } from './fhir';
export type { LabConnectionSummary, LabSyncResult } from './fhir';

// Expenses API
export { expensesApi } from './expenses';
export type {
  ExpenseProjectionData,
  ExpenseActualData,
  CostAnalysisData,
  CreateExpenseProjectionData,
  UpdateExpenseProjectionData,
  CreateExpenseActualData,
  UpdateExpenseActualData,
  ClaimStatus,
  AnalyzeCostsRequest,
  UpdateCurrentSpendingData,
} from './expenses';
