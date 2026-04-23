/**
 * Onboarding API
 *
 * First-session wizard state. `getStatus()` is the single source of truth —
 * the backend auto-completes onboarding when the account already has data,
 * so the client doesn't need to duplicate that heuristic.
 */

import { apiFetch } from './client';

export interface OnboardingSteps {
  emailVerified: boolean;
  hasLabReport: boolean;
  hasHealthProfile: boolean;
  hasInsurancePlan: boolean;
  hasBiomarkers: boolean;
}

export type SuggestedNextStep =
  | 'upload_lab'
  | 'health_profile'
  | 'upload_insurance'
  | 'explore'
  | null;

export interface OnboardingStatus {
  completed: boolean;
  completedAt: string | null;
  steps: OnboardingSteps;
  suggestedNextStep: SuggestedNextStep;
  /** ISO string of the most recent upload, or null if the user never uploaded. */
  lastLabUploadAt: string | null;
}

export const onboardingApi = {
  async getStatus(): Promise<OnboardingStatus> {
    const response = await apiFetch<OnboardingStatus>('/onboarding/status');
    return response.data;
  },

  async complete(): Promise<{ completed: true; completedAt: string }> {
    const response = await apiFetch<{ completed: true; completedAt: string }>(
      '/onboarding/complete',
      { method: 'POST' }
    );
    return response.data;
  },
};
