/**
 * HealthNeedsPage - dedicated view for health needs.
 *
 * Fetches via healthNeedsApi.getAll, groups cards by urgency (IMMEDIATE
 * first), supports status transitions, and wraps the analyze endpoint
 * in an accept/dismiss review panel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivitySquare,
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  PlayCircle,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type { Biomarker } from '../../types';
import {
  healthNeedsApi,
  type HealthNeedData,
  type CreateHealthNeedData,
} from '../../services/api';

interface HealthNeedsPageProps {
  biomarkers?: Biomarker[];
}

type Urgency = HealthNeedData['urgency'];
type NeedType = HealthNeedData['needType'];
type NeedStatus = HealthNeedData['status'];

const URGENCY_ORDER: Urgency[] = ['IMMEDIATE', 'URGENT', 'FOLLOW_UP', 'ROUTINE'];

const URGENCY_BADGE: Record<Urgency, string> = {
  IMMEDIATE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  URGENT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  FOLLOW_UP: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ROUTINE: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const URGENCY_LABEL: Record<Urgency, string> = {
  IMMEDIATE: 'Immediate',
  URGENT: 'Urgent',
  FOLLOW_UP: 'Follow-up',
  ROUTINE: 'Routine',
};

const TYPE_BADGE: Record<NeedType, string> = {
  CONDITION: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  ACTION: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  SERVICE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  FOLLOW_UP: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

const STATUS_BADGE: Record<NeedStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  IN_PROGRESS: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  DISMISSED: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
};

const STATUS_LABEL: Record<NeedStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DISMISSED: 'Dismissed',
};

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HealthNeedsPage({ biomarkers = [] }: HealthNeedsPageProps) {
  const [needs, setNeeds] = useState<HealthNeedData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<HealthNeedData[] | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const biomarkerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of biomarkers) map.set(b.id, b.name);
    return map;
  }, [biomarkers]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await healthNeedsApi.getAll();
      setNeeds(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health needs');
      setNeeds([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groupedByUrgency = useMemo(() => {
    const groups: Record<Urgency, HealthNeedData[]> = {
      IMMEDIATE: [],
      URGENT: [],
      FOLLOW_UP: [],
      ROUTINE: [],
    };
    for (const need of needs) {
      groups[need.urgency].push(need);
    }
    return groups;
  }, [needs]);

  const handleStatusChange = async (id: string, status: NeedStatus) => {
    setMutatingId(id);
    try {
      const updated = await healthNeedsApi.updateStatus(id, status);
      setNeeds((prev) => prev.map((n) => (n.id === id ? updated : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setMutatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this health need?')) return;
    setMutatingId(id);
    try {
      await healthNeedsApi.delete(id);
      setNeeds((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setMutatingId(null);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await healthNeedsApi.analyze();
      setSuggestions(result.detectedConditions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze biomarkers');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAccept = async (suggestion: HealthNeedData) => {
    setAcceptingId(suggestion.id);
    try {
      const payload: CreateHealthNeedData = {
        needType: suggestion.needType,
        name: suggestion.name,
        description: suggestion.description,
        urgency: suggestion.urgency,
        relatedBiomarkerIds: suggestion.relatedBiomarkerIds,
      };
      const created = await healthNeedsApi.create(payload);
      setNeeds((prev) => [created, ...prev]);
      setSuggestions((prev) => (prev ? prev.filter((s) => s.id !== suggestion.id) : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add need');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDismissSuggestion = (id: string) => {
    setSuggestions((prev) => (prev ? prev.filter((s) => s.id !== id) : null));
  };

  const handleDismissAllSuggestions = () => setSuggestions(null);

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ActivitySquare className="w-7 h-7 text-brand-500" />
            Health Needs
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Track conditions, recommended services, and follow-ups
          </p>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 transition-all"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Analyze from Biomarkers
            </>
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200 flex-1">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-600 dark:text-red-400 hover:opacity-80"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Suggestions review panel */}
      {suggestions !== null && (
        <div className="mb-6 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-2xl border border-purple-200 dark:border-purple-800/50 p-5">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                Suggested needs ({suggestions.length})
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                Derived from your out-of-range biomarkers. Review and accept the ones you want to track.
              </p>
            </div>
            <button
              onClick={handleDismissAllSuggestions}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              Dismiss all
            </button>
          </div>
          {suggestions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No new suggestions — your biomarkers look clean, or all suggestions have been actioned.
            </p>
          ) : (
            <div className="space-y-3">
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-start justify-between gap-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-xl border border-slate-200/60 dark:border-slate-700 p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-medium text-slate-900 dark:text-white">{s.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${URGENCY_BADGE[s.urgency]}`}>
                        {URGENCY_LABEL[s.urgency]}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_BADGE[s.needType]}`}>
                        {s.needType}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{s.description}</p>
                    {s.relatedBiomarkerIds.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-2">
                        {s.relatedBiomarkerIds.map((bid) => (
                          <span
                            key={bid}
                            className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                          >
                            {biomarkerNameById.get(bid) ?? 'biomarker'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleAccept(s)}
                      disabled={acceptingId === s.id}
                      className="p-2 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg disabled:opacity-50"
                      aria-label="Accept suggestion"
                    >
                      {acceptingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDismissSuggestion(s.id)}
                      className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                      aria-label="Dismiss suggestion"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading / empty */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        </div>
      ) : needs.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
          <ActivitySquare className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            No health needs tracked yet
          </h3>
          <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
            Run an analysis on your biomarkers to get started — we'll suggest conditions and
            follow-ups based on what's out of range.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            Analyze from Biomarkers
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {URGENCY_ORDER.map((urg) => {
            const group = groupedByUrgency[urg];
            if (group.length === 0) return null;
            return (
              <section key={urg}>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${URGENCY_BADGE[urg]}`}>
                    {URGENCY_LABEL[urg]}
                  </span>
                  <span>({group.length})</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {group.map((need) => {
                    const isMutating = mutatingId === need.id;
                    return (
                      <div
                        key={need.id}
                        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-5"
                      >
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <h3 className="font-semibold text-slate-900 dark:text-white flex-1">
                            {need.name}
                          </h3>
                          <div className="flex items-center gap-1 flex-wrap flex-shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_BADGE[need.needType]}`}>
                              {need.needType}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_BADGE[need.status]}`}>
                              {STATUS_LABEL[need.status]}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                          {need.description}
                        </p>

                        {need.relatedBiomarkerIds.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mb-3">
                            {need.relatedBiomarkerIds.map((bid) => (
                              <span
                                key={bid}
                                className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                              >
                                {biomarkerNameById.get(bid) ?? 'biomarker'}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                          <span className="text-xs text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(need.createdAt)}
                          </span>
                          <div className="flex items-center gap-1">
                            {need.status === 'PENDING' && (
                              <button
                                onClick={() => handleStatusChange(need.id, 'IN_PROGRESS')}
                                disabled={isMutating}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 rounded disabled:opacity-50"
                              >
                                <PlayCircle className="w-3 h-3" />
                                Start
                              </button>
                            )}
                            {need.status === 'IN_PROGRESS' && (
                              <button
                                onClick={() => handleStatusChange(need.id, 'COMPLETED')}
                                disabled={isMutating}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded disabled:opacity-50"
                              >
                                <Check className="w-3 h-3" />
                                Complete
                              </button>
                            )}
                            {(need.status === 'PENDING' || need.status === 'IN_PROGRESS') && (
                              <button
                                onClick={() => handleStatusChange(need.id, 'DISMISSED')}
                                disabled={isMutating}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded disabled:opacity-50"
                              >
                                <XCircle className="w-3 h-3" />
                                Dismiss
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(need.id)}
                              disabled={isMutating}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50"
                              aria-label="Delete"
                            >
                              {isMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

    </div>
  );
}
