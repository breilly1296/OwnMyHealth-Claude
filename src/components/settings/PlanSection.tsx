/**
 * PlanSection
 *
 * Shows the user's current subscription tier, usage against numeric limits,
 * and the feature list for their plan. "Upgrade" is intentionally a
 * placeholder — no Stripe integration yet, so the CTA only surfaces a
 * "Contact us" hint. When billing lands, swap the onClick to kick off checkout.
 */

import { useEffect, useMemo, useState } from 'react';
import { CreditCard, CheckCircle, XCircle, Loader2, AlertTriangle, Sparkles } from 'lucide-react';
import { planApi, isPlanLimitUnlimited } from '../../services/api';
import type { CurrentPlanData, PlanLimits, PlanUsage, PlanTier } from '../../services/api';

interface PlanSectionProps {
  onError?: (message: string) => void;
}

// Map PlanLimits numeric-limit keys → the PlanUsage counter that backs them,
// plus a user-facing label and the period the count resets on. Boolean
// features are rendered in a separate feature list below.
interface UsageRow {
  label: string;
  period: 'today' | 'this month' | 'total';
  limitKey: keyof PlanLimits;
  usageKey: keyof PlanUsage;
}

const USAGE_ROWS: UsageRow[] = [
  { label: 'AI Health Guide chats', period: 'today', limitKey: 'aiChatsPerDay', usageKey: 'aiChatsToday' },
  { label: 'Biomarker AI guidance', period: 'today', limitKey: 'aiGuidancePerDay', usageKey: 'aiGuidanceToday' },
  { label: 'PDF uploads', period: 'this month', limitKey: 'pdfUploadsPerMonth', usageKey: 'pdfUploadsThisMonth' },
  { label: 'Cost analyses', period: 'this month', limitKey: 'costAnalysisPerMonth', usageKey: 'costAnalysesThisMonth' },
  { label: 'Biomarkers stored', period: 'total', limitKey: 'maxBiomarkers', usageKey: 'totalBiomarkers' },
  { label: 'Active insurance plans', period: 'total', limitKey: 'insurancePlans', usageKey: 'activeInsurancePlans' },
];

interface FeatureRow {
  label: string;
  key: keyof PlanLimits;
}

const FEATURE_ROWS: FeatureRow[] = [
  { label: 'Health profile', key: 'healthProfile' },
  { label: 'Provider sharing', key: 'providerSharing' },
  { label: 'Quest FHIR integration', key: 'questFhirIntegration' },
  { label: 'Data export', key: 'dataExport' },
];

const TIER_BADGE_CLASSES: Record<PlanTier, string> = {
  FREE: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  PRO: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300',
  TEAM: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
};

export default function PlanSection({ onError }: PlanSectionProps) {
  const [data, setData] = useState<CurrentPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await planApi.getCurrentPlan();
        if (cancelled) return;
        setData(current);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load plan';
        setLoadError(message);
        onError?.(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const body = useMemo(() => {
    if (loading) {
      return (
        <div className="flex items-center space-x-2 text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading plan…</span>
        </div>
      );
    }
    if (loadError) {
      return (
        <div className="flex items-center space-x-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        </div>
      );
    }
    if (!data) return null;

    return (
      <div className="space-y-6">
        {/* Current tier banner */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${TIER_BADGE_CLASSES[data.currentPlan]}`}>
              {data.planName}
            </span>
            {data.expiresAt && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Expires {new Date(data.expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {data.upgradeAvailable && (
            <button
              type="button"
              onClick={() => {
                // TODO: wire to Stripe checkout when billing goes live.
                onError?.('Upgrades are not available yet. Contact us to upgrade manually.');
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Upgrade
            </button>
          )}
        </div>

        {/* Usage bars */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Usage</h3>
          {USAGE_ROWS.map((row) => {
            const limit = data.limits[row.limitKey];
            if (typeof limit !== 'number') return null;
            const usage = data.usage[row.usageKey];
            const unlimited = isPlanLimitUnlimited(limit);
            const ratio = unlimited || limit === 0 ? 0 : Math.min(1, usage / limit);
            return (
              <div key={row.limitKey}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-700 dark:text-slate-300">{row.label}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {unlimited ? `${usage} · unlimited` : `${usage} / ${limit} ${row.period}`}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      unlimited
                        ? 'bg-emerald-500'
                        : ratio >= 1
                        ? 'bg-red-500'
                        : ratio > 0.8
                        ? 'bg-amber-500'
                        : 'bg-brand-500'
                    }`}
                    style={{ width: unlimited ? '100%' : `${Math.max(2, ratio * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Feature list */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Included</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FEATURE_ROWS.map((row) => {
              const enabled = data.limits[row.key] === true;
              return (
                <li key={row.key} className="flex items-center gap-2 text-sm">
                  {enabled ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  )}
                  <span className={enabled ? 'text-slate-700 dark:text-slate-300' : 'text-slate-500 dark:text-slate-500 line-through'}>
                    {row.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }, [data, loading, loadError, onError]);

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-brand-100 dark:bg-brand-900/30 rounded-xl flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Plan &amp; Usage</h2>
        </div>
      </div>
      <div className="p-6">{body}</div>
    </section>
  );
}
