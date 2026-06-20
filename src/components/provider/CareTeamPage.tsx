/**
 * CareTeamPage — patient-facing provider consent management.
 *
 * Lets a patient review incoming provider access requests (approve with
 * granular scopes + a consent duration, or deny), and manage already-granted
 * providers (edit permissions, revoke, remove). Backed by patientApi, which
 * wraps the /patient/providers/* endpoints. All access is consent-first: a
 * provider sees nothing until the patient approves here.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Users,
  ShieldCheck,
  Clock,
  Check,
  X,
  Loader2,
  Trash2,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import {
  patientApi,
  type PatientProviderRelationship,
  type PendingProviderRequest,
} from '../../services/api/patient';
import { extractErrorMessage } from '../../utils/errorHelpers';

interface CareTeamPageProps {
  onBack?: () => void;
}

interface PermissionState {
  canViewBiomarkers: boolean;
  canViewInsurance: boolean;
  canViewHealthNeeds: boolean;
  canEditData: boolean;
}

// M3: `canEditData` is intentionally NOT offered as a toggle — providers are
// read-only (there is no provider write route), so presenting an "Edit data"
// consent would overstate the provider's actual capability. The field still
// exists in PermissionState and is sent as its default (false) on approve/update
// so the DB contract is unchanged; it is simply not patient-settable until a
// real provider-write feature is designed. Re-add a row here when that ships.
const PERMISSION_LABELS: { key: keyof PermissionState; label: string; hint: string }[] = [
  { key: 'canViewBiomarkers', label: 'Biomarkers & lab results', hint: 'View your tracked measurements and history' },
  { key: 'canViewInsurance', label: 'Insurance & coverage', hint: 'View your plans and benefits' },
  { key: 'canViewHealthNeeds', label: 'Health needs', hint: 'View conditions, follow-ups, and recommended services' },
];

const DURATION_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Reusable permission checkbox grid. */
function PermissionToggles({
  value,
  onChange,
  disabled,
}: {
  value: PermissionState;
  onChange: (next: PermissionState) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {PERMISSION_LABELS.map(({ key, label, hint }) => (
        <label
          key={key}
          className={`flex items-start gap-2 p-2 rounded-lg border ${
            value[key]
              ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/20'
              : 'border-slate-200 dark:border-slate-700'
          } ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            checked={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-900 dark:text-white">{label}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export default function CareTeamPage({ onBack }: CareTeamPageProps) {
  const [pending, setPending] = useState<PendingProviderRequest[]>([]);
  const [providers, setProviders] = useState<PatientProviderRelationship[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Per-request approval draft (scopes + duration), keyed by requestId.
  const [approvalDraft, setApprovalDraft] = useState<
    Record<string, PermissionState & { durationDays: number }>
  >({});
  // Per-relationship permission edits, keyed by relationshipId.
  const [permEdits, setPermEdits] = useState<Record<string, PermissionState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast((cur) => (cur?.message === message ? null : cur)), 3500);
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [pendingRes, providersRes] = await Promise.all([
        patientApi.getPendingRequests(),
        patientApi.getProviders(),
      ]);
      setPending(pendingRes);
      setProviders(providersRes);
    } catch (err) {
      setLoadError(extractErrorMessage(err, 'Failed to load your care team'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const draftFor = (requestId: string) =>
    approvalDraft[requestId] ?? {
      canViewBiomarkers: true,
      canViewInsurance: false,
      canViewHealthNeeds: true,
      canEditData: false,
      durationDays: 90,
    };

  const handleApprove = async (requestId: string) => {
    const draft = draftFor(requestId);
    setBusyId(requestId);
    try {
      await patientApi.approveProvider(requestId, {
        canViewBiomarkers: draft.canViewBiomarkers,
        canViewInsurance: draft.canViewInsurance,
        canViewHealthNeeds: draft.canViewHealthNeeds,
        canEditData: draft.canEditData,
        consentDurationDays: draft.durationDays,
      });
      showToast('Provider access approved', 'success');
      await load();
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to approve provider'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeny = async (requestId: string) => {
    setBusyId(requestId);
    try {
      await patientApi.denyProvider(requestId);
      showToast('Request denied', 'success');
      await load();
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to deny request'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSavePermissions = async (rel: PatientProviderRelationship) => {
    const edits = permEdits[rel.relationshipId] ?? rel.permissions;
    setBusyId(rel.relationshipId);
    try {
      await patientApi.updateProviderPermissions(rel.relationshipId, edits);
      showToast('Permissions updated', 'success');
      await load();
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to update permissions'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (rel: PatientProviderRelationship) => {
    if (!confirm(`Revoke ${rel.provider?.email ?? 'this provider'}'s access? They will no longer be able to view your data.`)) return;
    setBusyId(rel.relationshipId);
    try {
      await patientApi.revokeProvider(rel.relationshipId);
      showToast('Access revoked', 'success');
      await load();
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to revoke access'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (rel: PatientProviderRelationship) => {
    if (!confirm(`Remove ${rel.provider?.email ?? 'this provider'} from your care team entirely?`)) return;
    setBusyId(rel.relationshipId);
    try {
      await patientApi.removeProvider(rel.relationshipId);
      showToast('Provider removed', 'success');
      await load();
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to remove provider'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors mb-2"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              <span className="hidden sm:inline">Back to Dashboard</span>
            </button>
          )}
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-600 dark:text-brand-400" />
            Care Team
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Control which providers can access your health data. Access is granted only with your explicit consent.
          </p>
        </div>
        <button
          onClick={load}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
        </div>
      ) : (
        <>
          {/* Pending requests */}
          <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Pending requests {pending.length > 0 && `(${pending.length})`}
              </h2>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              {pending.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No pending provider requests.</p>
              ) : (
                pending.map((req) => {
                  const draft = draftFor(req.requestId);
                  const busy = busyId === req.requestId;
                  return (
                    <div key={req.requestId} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">
                            {req.provider?.email ?? 'Unknown provider'}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {req.relationshipType || 'Provider'} · requested {formatDate(req.requestedAt)}
                          </p>
                        </div>
                      </div>

                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
                        Choose what this provider can access:
                      </p>
                      <PermissionToggles
                        value={draft}
                        disabled={busy}
                        onChange={(next) =>
                          setApprovalDraft((cur) => ({ ...cur, [req.requestId]: { ...draft, ...next } }))
                        }
                      />

                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-3">
                        <label className="text-sm text-slate-600 dark:text-slate-300">
                          Access for:
                          <select
                            value={draft.durationDays}
                            disabled={busy}
                            onChange={(e) =>
                              setApprovalDraft((cur) => ({
                                ...cur,
                                [req.requestId]: { ...draft, durationDays: parseInt(e.target.value, 10) },
                              }))
                            }
                            className="ml-2 px-2 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white text-sm"
                          >
                            {DURATION_OPTIONS.map((o) => (
                              <option key={o.days} value={o.days}>{o.label}</option>
                            ))}
                          </select>
                        </label>
                        <div className="flex gap-2 sm:ml-auto">
                          <button
                            onClick={() => handleDeny(req.requestId)}
                            disabled={busy}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                          >
                            <X className="w-4 h-4" /> Deny
                          </button>
                          <button
                            onClick={() => handleApprove(req.requestId)}
                            disabled={busy}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Approve
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Active providers */}
          <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Providers with access {providers.length > 0 && `(${providers.length})`}
              </h2>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              {providers.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No providers currently have access to your data.
                </p>
              ) : (
                providers.map((rel) => {
                  const edits = permEdits[rel.relationshipId] ?? rel.permissions;
                  const busy = busyId === rel.relationshipId;
                  const expired =
                    !!rel.consentExpiresAt && new Date(rel.consentExpiresAt).getTime() < Date.now();
                  return (
                    <div key={rel.relationshipId} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">
                            {rel.provider?.email ?? 'Unknown provider'}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {rel.relationshipType || 'Provider'} · granted {formatDate(rel.consentGrantedAt)}
                            {rel.consentExpiresAt && ` · expires ${formatDate(rel.consentExpiresAt)}`}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            expired
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          }`}
                        >
                          {expired ? 'Expired' : rel.status || 'Active'}
                        </span>
                      </div>

                      <PermissionToggles
                        value={edits}
                        disabled={busy || expired}
                        onChange={(next) =>
                          setPermEdits((cur) => ({ ...cur, [rel.relationshipId]: next }))
                        }
                      />

                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          onClick={() => handleSavePermissions(rel)}
                          disabled={busy || expired}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          Save permissions
                        </button>
                        <button
                          onClick={() => handleRevoke(rel)}
                          disabled={busy}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                        >
                          Revoke access
                        </button>
                        <button
                          onClick={() => handleRemove(rel)}
                          disabled={busy}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" /> Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white ${
              toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            {toast.type === 'success' ? <Check className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span className="font-medium text-sm">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
