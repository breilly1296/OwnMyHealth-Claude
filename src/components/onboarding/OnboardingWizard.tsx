/**
 * OnboardingWizard
 *
 * First-session flow that replaces the empty-state dashboard. Four steps
 * (welcome / upload lab / set up health profile / done), every non-welcome
 * step is skippable, and any one completed step marks the wizard as useful
 * enough to dismiss on the backend.
 *
 * This component renders inline where the dashboard content goes — it's
 * intentionally *not* a modal. Parents pass `onComplete` so they can swap
 * the real dashboard in once the user is done.
 */

import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  Heart,
  FileText,
  UserCircle,
  CheckCircle2,
  ArrowRight,
  Shield,
  Loader2,
} from 'lucide-react';
import { onboardingApi } from '../../services/api';
import type { OnboardingStatus } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// LabUploadModal is lazy because this wizard only mounts for new users.
const LabUploadModal = lazy(() => import('../upload/LabUploadModal'));

interface ExtractedBiomarker {
  id: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  isOutOfRange: boolean;
}

export interface OnboardingWizardProps {
  status: OnboardingStatus;
  /** Called once the user finishes (or dismisses) the wizard. */
  onComplete: () => void;
  /** Navigate to Account Settings (where the Health Profile form lives). */
  onOpenHealthProfile: () => void;
}

type StepKey = 'welcome' | 'lab' | 'profile' | 'done';

interface LabSummary {
  total: number;
  outOfRange: number;
  labName?: string;
}

const STEP_ORDER: StepKey[] = ['welcome', 'lab', 'profile', 'done'];

function getGreetingName(email: string | undefined): string {
  if (!email) return 'there';
  const local = email.split('@')[0] ?? '';
  // local-parts often contain dots/underscores — take the leading word and
  // capitalize so "jane.doe" → "Jane".
  const first = local.split(/[._-]/)[0] ?? '';
  if (!first) return 'there';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default function OnboardingWizard({
  status,
  onComplete,
  onOpenHealthProfile,
}: OnboardingWizardProps) {
  const { user } = useAuth();

  // If the user already has some data (e.g. they uploaded before opening the
  // wizard), skip the welcome/upload steps that would feel redundant. The
  // backend status is the source of truth.
  const initialStep: StepKey = useMemo(() => {
    if (status.steps.hasLabReport || status.steps.hasBiomarkers) {
      if (!status.steps.hasHealthProfile) return 'profile';
      return 'done';
    }
    return 'welcome';
  }, [status]);

  const [step, setStep] = useState<StepKey>(initialStep);
  const [showLabModal, setShowLabModal] = useState(false);
  const [labSummary, setLabSummary] = useState<LabSummary | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const goNext = useCallback((current: StepKey) => {
    const idx = STEP_ORDER.indexOf(current);
    const next = STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
    setStep(next);
  }, []);

  const handleLabSuccess = useCallback((biomarkers: ExtractedBiomarker[]) => {
    const outOfRange = biomarkers.filter((b) => b.isOutOfRange).length;
    setLabSummary({ total: biomarkers.length, outOfRange });
    setShowLabModal(false);
    // Brief dwell on the summary, then advance. Immediate advance feels
    // jarring when the modal was just showing extraction results.
    setTimeout(() => goNext('lab'), 150);
  }, [goNext]);

  const handleFinish = useCallback(async () => {
    setFinalizing(true);
    setFinalizeError(null);
    try {
      await onboardingApi.complete();
      onComplete();
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Failed to finish onboarding');
    } finally {
      setFinalizing(false);
    }
  }, [onComplete]);

  const handleSetUpProfile = useCallback(async () => {
    // Mark onboarding done BEFORE navigating — otherwise the user lands on
    // settings, returns to the dashboard, and the wizard greets them again.
    try {
      await onboardingApi.complete();
    } catch {
      // Non-fatal — next dashboard visit will auto-complete via getStatus.
    }
    onComplete();
    onOpenHealthProfile();
  }, [onComplete, onOpenHealthProfile]);

  // Step number shown in the indicator. The welcome + done screens aren't
  // counted as "steps" for the user — they're bookends.
  const stepIndex = STEP_ORDER.indexOf(step);
  const progress: { current: number; total: number } | null =
    step === 'lab' || step === 'profile'
      ? { current: stepIndex, total: 2 }
      : null;

  const greetingName = getGreetingName(user?.email);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-start justify-center px-4 pt-12 pb-12">
      <div className="w-full max-w-[480px]">
        {progress && (
          <div className="mb-6 flex items-center justify-center gap-2" aria-label={`Step ${progress.current} of ${progress.total}`}>
            {Array.from({ length: progress.total }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-10 rounded-full transition-colors ${
                  i < progress.current
                    ? 'bg-brand-500'
                    : 'bg-slate-200 dark:bg-slate-700'
                }`}
              />
            ))}
            <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              Step {progress.current} of {progress.total}
            </span>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg shadow-slate-200/50 dark:shadow-slate-950/50 p-8">
          {step === 'welcome' && (
            <WelcomeStep
              name={greetingName}
              onContinue={() => goNext('welcome')}
            />
          )}
          {step === 'lab' && (
            <LabStep
              summary={labSummary}
              onUpload={() => setShowLabModal(true)}
              onSkip={() => goNext('lab')}
            />
          )}
          {step === 'profile' && (
            <ProfileStep
              onSetUp={handleSetUpProfile}
              onSkip={() => goNext('profile')}
            />
          )}
          {step === 'done' && (
            <DoneStep
              finalizing={finalizing}
              error={finalizeError}
              onFinish={handleFinish}
            />
          )}
        </div>
      </div>

      {showLabModal && (
        <Suspense fallback={null}>
          <LabUploadModal
            isOpen={showLabModal}
            onClose={() => setShowLabModal(false)}
            onSuccess={handleLabSuccess}
          />
        </Suspense>
      )}
    </div>
  );
}

// ============================================
// Step components (kept inline — small and coupled to the wizard)
// ============================================

function WelcomeStep({ name, onContinue }: { name: string; onContinue: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/25">
        <Heart className="h-7 w-7 text-white" />
      </div>
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        Welcome to OwnMyHealth, {name}!
      </h1>
      <p className="mt-3 text-slate-600 dark:text-slate-400">
        Let's set up your health dashboard in a few quick steps. Your data is
        encrypted and never shared without your consent.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Shield className="h-4 w-4" />
        HIPAA-compliant, end-to-end encrypted
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-3 text-white font-semibold shadow-lg shadow-brand-500/25 hover:from-brand-600 hover:to-brand-700 transition-colors"
      >
        Get Started
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function LabStep({
  summary,
  onUpload,
  onSkip,
}: {
  summary: LabSummary | null;
  onUpload: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-900/30">
        <FileText className="h-6 w-6 text-brand-600 dark:text-brand-400" />
      </div>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
        Upload a lab report
      </h2>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        Drop a PDF of your blood work, metabolic panel, or any lab results.
        We'll extract your biomarkers automatically.
      </p>

      {summary && (
        <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Found {summary.total} biomarker{summary.total === 1 ? '' : 's'}
            {summary.outOfRange > 0 && (
              <> · {summary.outOfRange} out of range</>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onSkip}
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={onUpload}
          className="flex-1 rounded-xl bg-brand-600 text-white px-4 py-2.5 font-medium hover:bg-brand-700 transition-colors"
        >
          Upload PDF
        </button>
      </div>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Supported: Quest Diagnostics, LabCorp, hospital lab reports
      </p>
    </div>
  );
}

function ProfileStep({
  onSetUp,
  onSkip,
}: {
  onSetUp: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
        <UserCircle className="h-6 w-6 text-purple-600 dark:text-purple-400" />
      </div>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
        Tell us about your health <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
      </h2>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        Adding conditions and medications helps the AI give more relevant guidance.
      </p>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onSkip}
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={onSetUp}
          className="flex-1 rounded-xl bg-brand-600 text-white px-4 py-2.5 font-medium hover:bg-brand-700 transition-colors"
        >
          Set Up Profile
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  finalizing,
  error,
  onFinish,
}: {
  finalizing: boolean;
  error: string | null;
  onFinish: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
        <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">You're all set!</h2>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        Your dashboard is ready.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        type="button"
        onClick={onFinish}
        disabled={finalizing}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-3 text-white font-semibold shadow-lg shadow-brand-500/25 hover:from-brand-600 hover:to-brand-700 transition-colors disabled:opacity-50"
      >
        {finalizing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Finishing…
          </>
        ) : (
          <>
            Go to Dashboard
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
