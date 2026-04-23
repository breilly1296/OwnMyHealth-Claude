/**
 * Onboarding Service
 *
 * First-session state for the dashboard wizard. "Completed" means either:
 *   - The user clicked "Done" on the wizard (POST /onboarding/complete), or
 *   - They already have meaningful data, so the wizard would be noise.
 *
 * Existing users from before this feature shipped are marked complete by the
 * migration's backfill; new signups start with NULL so the wizard shows.
 */

import { withRLSContext } from './database.js';

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
  /**
   * Most recent `userFiles.createdAt` (or null if the user has never
   * uploaded). Used by the dashboard to decide whether to render the
   * "it's been a while since your last upload" banner post-onboarding.
   */
  lastLabUploadAt: string | null;
}

/**
 * Decide which step to suggest next. Priority order is: lab upload (highest
 * immediate value — biomarkers appear on the dashboard), then health profile
 * (AI personalization), then insurance (cost analysis). Once all three core
 * value-delivering actions are done we switch to 'explore' — the app already
 * has enough data to be useful, so the suggestion is just to look around.
 */
function pickSuggestedStep(steps: OnboardingSteps): SuggestedNextStep {
  if (!steps.hasLabReport && !steps.hasBiomarkers) return 'upload_lab';
  if (!steps.hasHealthProfile) return 'health_profile';
  if (!steps.hasInsurancePlan) return 'upload_insurance';
  return 'explore';
}

/**
 * Any one of these means the account is useful enough that the wizard
 * shouldn't render. We don't require all three — users who've uploaded a lab
 * and have biomarkers are already past the empty-state cliff.
 */
function hasMeaningfulData(steps: OnboardingSteps): boolean {
  return steps.hasLabReport || steps.hasBiomarkers || steps.hasInsurancePlan || steps.hasHealthProfile;
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  return withRLSContext(userId, async (tx) => {
    const [user, labReportCount, insurancePlanCount, biomarkerCount, latestFile] =
      await Promise.all([
        tx.user.findUnique({
          where: { id: userId },
          select: {
            emailVerified: true,
            healthProfileEncrypted: true,
            onboardingCompletedAt: true,
          },
        }),
        tx.userFile.count({ where: { userId } }),
        tx.insurancePlan.count({ where: { userId } }),
        tx.biomarker.count({ where: { userId } }),
        tx.userFile.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

    const steps: OnboardingSteps = {
      emailVerified: !!user?.emailVerified,
      hasLabReport: labReportCount > 0,
      hasHealthProfile: !!user?.healthProfileEncrypted,
      hasInsurancePlan: insurancePlanCount > 0,
      hasBiomarkers: biomarkerCount > 0,
    };

    // If the column is already stamped, trust it — that's the explicit
    // "user clicked Done" signal. Otherwise auto-complete when the account
    // has any meaningful data (covers pre-migration users who slipped
    // through the backfill, and users who uploaded before opening the
    // wizard for any reason).
    let completedAt = user?.onboardingCompletedAt ?? null;
    if (!completedAt && hasMeaningfulData(steps)) {
      const stamped = new Date();
      await tx.user.update({
        where: { id: userId },
        data: { onboardingCompletedAt: stamped },
      });
      completedAt = stamped;
    }

    return {
      completed: !!completedAt,
      completedAt: completedAt ? completedAt.toISOString() : null,
      steps,
      suggestedNextStep: completedAt ? null : pickSuggestedStep(steps),
      lastLabUploadAt: latestFile?.createdAt?.toISOString() ?? null,
    };
  });
}

export async function completeOnboarding(userId: string): Promise<Date> {
  return withRLSContext(userId, async (tx) => {
    const now = new Date();
    await tx.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: now },
    });
    return now;
  });
}
