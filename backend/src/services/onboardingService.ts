/**
 * Onboarding Service
 *
 * First-session state for the dashboard wizard. "Completed" means either:
 *   - The user clicked "Done" on the wizard (POST /onboarding/complete), or
 *   - They already have meaningful data, so the wizard would be noise.
 *
 * Existing users from before this feature shipped are marked complete by the
 * migration's backfill; new signups start with NULL so the wizard shows.
 *
 * getOnboardingStatus is a PURE READ: it COMPUTES `completed` from the
 * heuristic but never writes. The durable `onboardingCompletedAt` stamp is
 * written only by completeOnboarding (POST /onboarding/complete), which is
 * CSRF-protected. (A GET must be a safe method — and CSRF double-submit is
 * skipped for GET — so stamping inside the status read was both an HTTP-
 * semantics violation and a CSRF-exempt write.) The client detects the
 * "has data but not yet stamped" state via completed:true + completedAt:null
 * and fires the explicit POST once to persist it.
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

    // `completed` is COMPUTED, never written here: true if the column is
    // already stamped (the explicit "user clicked Done" signal) OR the account
    // already has meaningful data (so the wizard would be noise — covers
    // pre-migration users who slipped through the backfill, and users who
    // uploaded before opening the wizard). The durable stamp is persisted only
    // by the CSRF-protected POST /onboarding/complete; this read has no side
    // effect, so a prefetch/retry/cache replay of the GET is benign. The client
    // sees completed:true + completedAt:null and fires that POST once.
    const completedAt = user?.onboardingCompletedAt ?? null;
    const completed = !!completedAt || hasMeaningfulData(steps);

    return {
      completed,
      completedAt: completedAt ? completedAt.toISOString() : null,
      steps,
      suggestedNextStep: completed ? null : pickSuggestedStep(steps),
      lastLabUploadAt: latestFile?.createdAt?.toISOString() ?? null,
    };
  });
}

export async function completeOnboarding(userId: string): Promise<Date> {
  return withRLSContext(userId, async (tx) => {
    const now = new Date();
    // Idempotent / race-safe stamp. updateMany with the `onboardingCompletedAt:
    // null` predicate compiles to a single atomic `UPDATE ... WHERE
    // onboarding_completed_at IS NULL`, so a second concurrent writer (another
    // tab / Cloud Run replica, or the dashboard auto-complete racing a "Done"
    // click) matches zero rows and is a no-op — the first writer's timestamp
    // wins, with no lost update and no re-stamp. Re-read so we always return the
    // PERSISTED value, not the local `now` that may have lost the race.
    await tx.user.updateMany({
      where: { id: userId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: now },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true },
    });
    return user?.onboardingCompletedAt ?? now;
  });
}
