/**
 * Onboarding API
 *
 * First-session wizard state. `getStatus()` is a pure read: the backend
 * reports `completed: true` for an account that already has data, but does NOT
 * persist the `onboardingCompletedAt` stamp (a GET must stay side-effect-free).
 * When status comes back `completed: true` with `completedAt: null`, the data
 * exists but the stamp hasn't been written yet — the dashboard calls
 * `complete()` once to persist it via the CSRF-protected POST.
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
