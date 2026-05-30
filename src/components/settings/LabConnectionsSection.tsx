/**
 * LabConnectionsSection
 *
 * Surfaces the SMART-on-FHIR lab-sync backend (fhirRoutes.ts / fhir services)
 * into the UI — previously fully built but unreachable. Lets the user:
 *   - connect a lab account (Quest) via the OAuth flow,
 *   - see connection + last-sync status,
 *   - trigger an on-demand sync, and
 *   - disconnect (revokes tokens server-side).
 *
 * The OAuth callback redirects the browser back to /settings?labConnected=quest
 * (or ?error=...). Because /settings deep-links to this Account Settings page,
 * this component reads those markers on mount, surfaces a toast, refreshes the
 * list, and strips the markers from the URL.
 *
 * @module components/settings/LabConnectionsSection
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  FlaskConical,
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { fhirApi } from '../../services/api';
import type { LabConnectionSummary, ApiError } from '../../services/api';

interface LabConnectionsSectionProps {
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  quest: 'Quest Diagnostics',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Friendly message for an OAuth `?error=` marker on the callback redirect. */
function oauthCallbackMessage(error: string): string {
  switch (error) {
    case 'access_denied':
      return 'Connection cancelled — you declined access at the lab provider.';
    case 'connection_failed':
      return 'The lab connection could not be completed. Please try again.';
    default:
      return `Lab connection failed (${error}). Please try again.`;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface StatusBadge {
  label: string;
  className: string;
  Icon: typeof CheckCircle;
}

function statusBadge(connection: LabConnectionSummary): StatusBadge {
  if (!connection.isActive) {
    return {
      label: 'Inactive',
      className: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
      Icon: Clock,
    };
  }
  switch (connection.syncStatus) {
    case 'syncing':
      return {
        label: 'Syncing…',
        className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
        Icon: Loader2,
      };
    case 'error':
      return {
        label: 'Sync error',
        className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
        Icon: AlertTriangle,
      };
    default:
      return {
        label: 'Connected',
        className: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
        Icon: CheckCircle,
      };
  }
}

export default function LabConnectionsSection({ onError, onSuccess }: LabConnectionsSectionProps) {
  const [connections, setConnections] = useState<LabConnectionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Stable refs so the mount effect doesn't re-run when the parent passes new
  // inline callback arrows on each render.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const loadConnections = useCallback(async (): Promise<LabConnectionSummary[]> => {
    const list = await fhirApi.listConnections();
    setConnections(list);
    return list;
  }, []);

  // Initial load + OAuth callback handling. Re-runs when reloadKey bumps.
  useEffect(() => {
    let cancelled = false;

    // Read and strip the OAuth callback markers (only meaningful on the first
    // load after a redirect; subsequent reloadKey bumps won't see them).
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('labConnected');
    const oauthError = params.get('error');
    if (connected || oauthError) {
      const url = new URL(window.location.href);
      url.searchParams.delete('labConnected');
      url.searchParams.delete('error');
      window.history.replaceState({}, document.title, url.pathname + url.search);
    }

    (async () => {
      try {
        await loadConnections();
        if (cancelled) return;
        if (oauthError) {
          onErrorRef.current?.(oauthCallbackMessage(oauthError));
        } else if (connected) {
          onSuccessRef.current?.(
            `${providerLabel(connected)} connected. Use "Sync now" to import your latest results.`
          );
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load lab connections');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadConnections, reloadKey]);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const { redirectUrl } = await fhirApi.connectQuest();
      // Full-page navigation to the provider's OAuth consent screen.
      window.location.href = redirectUrl;
      // Intentionally leave isConnecting=true — we're navigating away.
    } catch (err) {
      const status = (err as ApiError)?.status;
      if (status === 503) {
        onErrorRef.current?.('Lab connections are not available on this server yet.');
      } else if (status === 403) {
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Lab connections require a plan upgrade.'
        );
      } else {
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Could not start the lab connection.'
        );
      }
      setIsConnecting(false);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      const result = await fhirApi.syncConnection(id);
      await loadConnections();
      const skipped = result.skipped ? `, skipped ${result.skipped}` : '';
      onSuccessRef.current?.(
        `Imported ${result.imported} result${result.imported === 1 ? '' : 's'}${skipped}.`
      );
      if (result.errors.length > 0) {
        onErrorRef.current?.(
          `Sync finished with ${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}.`
        );
      }
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : 'Sync failed.');
      // Refresh so the card reflects the server-side error status.
      await loadConnections().catch(() => undefined);
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    setDisconnectingId(id);
    try {
      await fhirApi.disconnect(id);
      setConfirmDisconnectId(null);
      await loadConnections();
      onSuccessRef.current?.('Lab disconnected.');
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : 'Could not disconnect the lab.');
    } finally {
      setDisconnectingId(null);
    }
  };

  const renderBody = () => {
    if (connections === null && !loadError) {
      return (
        <div className="flex items-center space-x-2 text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading lab connections…</span>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setConnections(null);
              setReloadKey((k) => k + 1);
            }}
            className="text-sm font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 underline whitespace-nowrap"
          >
            Try again
          </button>
        </div>
      );
    }

    const list = connections ?? [];

    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Securely import your lab results directly from your provider. Your connection uses
          OAuth — OwnMyHealth never sees your lab portal password, and you can disconnect at any
          time.
        </p>

        {list.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
            <div className="w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <FlaskConical className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">No labs connected yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {list.map((connection) => {
              const badge = statusBadge(connection);
              const isSyncing = syncingId === connection.id || connection.syncStatus === 'syncing';
              const isDisconnecting = disconnectingId === connection.id;
              const isConfirming = confirmDisconnectId === connection.id;
              return (
                <li
                  key={connection.id}
                  className="border border-slate-200 dark:border-slate-700 rounded-xl p-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-900 dark:text-white">
                          {providerLabel(connection.provider)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                        >
                          <badge.Icon
                            className={`w-3 h-3 ${badge.label === 'Syncing…' ? 'animate-spin' : ''}`}
                          />
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Last sync: {formatDateTime(connection.lastSyncAt)}
                        {connection.lastImportedCount > 0 &&
                          ` · ${connection.lastImportedCount} result${
                            connection.lastImportedCount === 1 ? '' : 's'
                          } imported`}
                      </p>
                      {connection.syncStatus === 'error' && connection.syncError && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {connection.syncError}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSync(connection.id)}
                        disabled={isSyncing || isDisconnecting}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSyncing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        {isSyncing ? 'Syncing…' : 'Sync now'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnectId(connection.id)}
                        disabled={isSyncing || isDisconnecting}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {isConfirming && (
                    <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <p className="text-sm text-red-700 dark:text-red-300">
                        Disconnect {providerLabel(connection.provider)}? Already-imported results
                        stay in your account.
                      </p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmDisconnectId(null)}
                          disabled={isDisconnecting}
                          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDisconnect(connection.id)}
                          disabled={isDisconnecting}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {isDisconnecting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                          Disconnect
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isConnecting ? 'Starting…' : 'Connect Quest Diagnostics'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-cyan-100 dark:bg-cyan-900/30 rounded-xl flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Connected Labs</h2>
        </div>
      </div>
      <div className="p-6">{renderBody()}</div>
    </section>
  );
}
