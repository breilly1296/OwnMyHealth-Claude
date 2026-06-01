/**
 * MyPatientsPage — provider-facing patient roster and detail.
 *
 * Providers can request access to a patient by email, see the patients who
 * have shared data with them (status + granted scopes), and open a consent-
 * gated detail view (biomarkers / health needs, shown only where the patient
 * granted the corresponding permission). Backed by providerApi.
 *
 * Rendered only for PROVIDER/ADMIN roles (see Dashboard nav gating). The
 * backend independently enforces consent + RLS, so this UI is a convenience
 * layer, not the security boundary.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Stethoscope,
  UserPlus,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Check,
  Trash2,
  Activity,
  ClipboardList,
  RefreshCw,
} from 'lucide-react';
import {
  providerApi,
  type ProviderPatientRelationship,
} from '../../services/api/provider';
import type { BiomarkerData } from '../../services/api/biomarkers';
import type { HealthNeedData } from '../../services/api/healthNeeds';
import { extractErrorMessage } from '../../utils/errorHelpers';

const RELATIONSHIP_TYPES = [
  { value: 'PRIMARY_CARE', label: 'Primary care' },
  { value: 'SPECIALIST', label: 'Specialist' },
  { value: 'CONSULTANT', label: 'Consultant' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'OTHER', label: 'Other' },
];

const URGENCY_BADGE: Record<string, string> = {
  IMMEDIATE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  URGENT: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  FOLLOW_UP: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  ROUTINE: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface PatientDetail {
  patient: { id: string; email: string; createdAt: string; lastLoginAt: string | null };
  relationship: {
    id: string;
    relationshipType: string;
    permissions: {
      canViewBiomarkers: boolean;
      canViewInsurance: boolean;
      canViewHealthNeeds: boolean;
      canEditData: boolean;
    };
  };
}

export default function MyPatientsPage() {
  const [patients, setPatients] = useState<ProviderPatientRelationship[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Request-access form
  const [email, setEmail] = useState('');
  const [relType, setRelType] = useState('PRIMARY_CARE');
  const [message, setMessage] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);

  // Detail view
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [biomarkers, setBiomarkers] = useState<BiomarkerData[]>([]);
  const [healthNeeds, setHealthNeeds] = useState<HealthNeedData[]>([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast((cur) => (cur?.message === msg ? null : cur)), 3500);
  }, []);

  const loadRoster = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPatients(await providerApi.getPatients());
    } catch (err) {
      setLoadError(extractErrorMessage(err, 'Failed to load your patients'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setIsRequesting(true);
    try {
      await providerApi.requestPatientAccess(trimmed, relType, message.trim() || undefined);
      // The backend returns a uniform response whether or not the email maps to
      // a real account (enumeration defense), so we show a neutral confirmation.
      showToast('Request sent. The patient will see it when they sign in.', 'success');
      setEmail('');
      setMessage('');
      await loadRoster();
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to send request'), 'error');
    } finally {
      setIsRequesting(false);
    }
  };

  const openDetail = useCallback(async (patientId: string) => {
    setSelectedId(patientId);
    setIsDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setBiomarkers([]);
    setHealthNeeds([]);
    try {
      const d = await providerApi.getPatient(patientId);
      setDetail(d as PatientDetail);
      const tasks: Promise<void>[] = [];
      if (d.relationship.permissions.canViewBiomarkers) {
        tasks.push(providerApi.getPatientBiomarkers(patientId).then((b) => setBiomarkers(b)).catch(() => undefined));
      }
      if (d.relationship.permissions.canViewHealthNeeds) {
        tasks.push(providerApi.getPatientHealthNeeds(patientId).then((n) => setHealthNeeds(n)).catch(() => undefined));
      }
      await Promise.all(tasks);
    } catch (err) {
      setDetailError(extractErrorMessage(err, 'Failed to load patient. You may not have active consent.'));
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  const handleRemove = async (rel: ProviderPatientRelationship) => {
    if (!confirm(`Remove ${rel.patient?.email ?? 'this patient'} from your roster?`)) return;
    try {
      await providerApi.removePatient(rel.patientId);
      showToast('Patient removed', 'success');
      if (selectedId === rel.patientId) setSelectedId(null);
      await loadRoster();
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to remove patient'), 'error');
    }
  };

  // ---- Detail view ----
  if (selectedId) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <button
          onClick={() => setSelectedId(null)}
          className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Back to patients
        </button>

        {isDetailLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
          </div>
        ) : detailError ? (
          <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{detailError}</p>
          </div>
        ) : detail ? (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">{detail.patient.email}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {RELATIONSHIP_TYPES.find((r) => r.value === detail.relationship.relationshipType)?.label ??
                  detail.relationship.relationshipType}{' '}
                · patient since {formatDate(detail.patient.createdAt)} · last seen{' '}
                {formatDate(detail.patient.lastLoginAt)}
              </p>
            </div>

            {/* Biomarkers */}
            {detail.relationship.permissions.canViewBiomarkers ? (
              <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-brand-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Biomarkers {biomarkers.length > 0 && `(${biomarkers.length})`}
                  </h2>
                </div>
                <div className="p-4 sm:p-6">
                  {biomarkers.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No biomarkers recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {biomarkers.map((b) => (
                        <div
                          key={b.id}
                          className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-700"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{b.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {b.category} · {formatDate(b.date)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${b.isOutOfRange ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {b.value} {b.unit}
                            </p>
                            <p className="text-xs text-slate-400">
                              ref {b.normalRange.min}–{b.normalRange.max}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400 px-1">
                The patient hasn&apos;t shared biomarkers with you.
              </p>
            )}

            {/* Health needs */}
            {detail.relationship.permissions.canViewHealthNeeds ? (
              <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-brand-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Health needs {healthNeeds.length > 0 && `(${healthNeeds.length})`}
                  </h2>
                </div>
                <div className="p-4 sm:p-6">
                  {healthNeeds.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No health needs recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {healthNeeds.map((n) => (
                        <div key={n.id} className="p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{n.name}</p>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_BADGE[n.urgency] ?? URGENCY_BADGE.ROUTINE}`}>
                              {n.urgency.replace('_', ' ')}
                            </span>
                          </div>
                          {n.description && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{n.description}</p>
                          )}
                          <p className="text-xs text-slate-400 mt-1">{n.needType} · {n.status}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400 px-1">
                The patient hasn&apos;t shared health needs with you.
              </p>
            )}
          </>
        ) : null}
      </div>
    );
  }

  // ---- Roster view ----
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Stethoscope className="w-6 h-6 text-brand-600 dark:text-brand-400" />
            My Patients
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Request access to a patient, then view the data they choose to share.
          </p>
        </div>
        <button
          onClick={loadRoster}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Request access */}
      <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-brand-500" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Request patient access</h2>
        </div>
        <form onSubmit={handleRequest} className="p-4 sm:p-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Patient email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="patient@example.com"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Relationship</label>
              <select
                value={relType}
                onChange={(e) => setRelType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white"
              >
                {RELATIONSHIP_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Message <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={message}
              maxLength={500}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Brief note for the patient"
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={isRequesting || !email.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {isRequesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Send request
          </button>
        </form>
      </section>

      {/* Roster */}
      <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Patients {patients.length > 0 && `(${patients.length})`}
          </h2>
        </div>
        <div className="p-4 sm:p-6">
          {loadError ? (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
            </div>
          ) : patients.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No patients yet. Send a request above to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {patients.map((rel) => {
                const active = (rel.status || '').toUpperCase() === 'ACTIVE' || (rel.status || '').toUpperCase() === 'APPROVED';
                return (
                  <div
                    key={rel.relationshipId}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-700"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {rel.patient?.email ?? 'Pending patient'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {rel.relationshipType || 'Provider'} · {rel.status}
                        {rel.consentExpiresAt && ` · expires ${formatDate(rel.consentExpiresAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {active && rel.patient && (
                        <button
                          onClick={() => openDetail(rel.patientId)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700"
                        >
                          <Check className="w-4 h-4" /> View
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(rel)}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                        aria-label="Remove patient"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

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
