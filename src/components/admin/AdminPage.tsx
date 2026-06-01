/**
 * AdminPage — ADMIN-only operations console.
 *
 * Four tabs over the existing admin API (RLS-bypassing admin context on the
 * backend; this UI is gated to ADMIN in the dashboard nav, and every route is
 * independently RBAC-checked server-side):
 *   - Overview: system + data statistics
 *   - Users: search/filter, role/plan/active management, permanent delete
 *   - Audit Log: filterable, paginated HIPAA access trail
 *   - Relationships: provider–patient consent records (status + scopes)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Users as UsersIcon,
  ScrollText,
  Stethoscope,
  Gauge,
  Loader2,
  AlertTriangle,
  Check,
  Trash2,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  adminApi,
  type AdminUser,
  type SystemStats,
  type AdminAuditLog,
  type AdminProviderRelationship,
} from '../../services/api/admin';
import type { UserRole } from '../../services/api/provider';
import { extractErrorMessage } from '../../utils/errorHelpers';

type TabId = 'overview' | 'users' | 'audit' | 'relationships';
type Notify = (message: string, type: 'success' | 'error') => void;

const ROLES: UserRole[] = ['PATIENT', 'PROVIDER', 'ADMIN'];
const PLANS = ['FREE', 'PRO', 'TEAM'] as const;
const REL_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED'];

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================================ Overview tab
function OverviewTab({ onError }: { onError: Notify }) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await adminApi.getStats();
        if (!cancelled) setStats(s);
      } catch (err) {
        onError(extractErrorMessage(err, 'Failed to load stats'), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [onError]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-brand-500" /></div>;
  if (!stats) return <p className="text-sm text-slate-500 dark:text-slate-400">No statistics available.</p>;

  const cards = [
    { label: 'Total users', value: stats.users.total },
    { label: 'Active users', value: stats.users.active },
    { label: 'Logins (7d)', value: stats.users.recentLogins },
    { label: 'Biomarkers', value: stats.data.biomarkers },
    { label: 'Insurance plans', value: stats.data.insurancePlans },
    { label: 'Health needs', value: stats.data.healthNeeds },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <p className="text-sm text-slate-500 dark:text-slate-400">{c.label}</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{c.value.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Users by role</h3>
        <div className="space-y-2">
          {Object.entries(stats.users.byRole).map(([role, count]) => (
            <div key={role} className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300">{role}</span>
              <span className="font-medium text-slate-900 dark:text-white">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================ Users tab
function UsersTab({ onError, notify }: { onError: Notify; notify: Notify }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getUsers({
        page,
        limit: 20,
        search: search.trim() || undefined,
        role: (roleFilter || undefined) as UserRole | undefined,
      });
      setUsers(res.users);
      setTotalPages(res.pagination.totalPages || 1);
    } catch (err) {
      onError(extractErrorMessage(err, 'Failed to load users'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, onError]);

  useEffect(() => { load(); }, [load]);

  const mutate = async (id: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyId(id);
    try {
      await fn();
      notify(okMsg, 'success');
      await load();
    } catch (err) {
      notify(extractErrorMessage(err, 'Action failed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handlePermanentDelete = (u: AdminUser) => {
    const typed = window.prompt(`This permanently deletes ${u.email} and ALL their data. Type their email to confirm:`);
    if (!typed) return;
    if (typed.trim().toLowerCase() !== u.email.toLowerCase()) {
      notify('Email did not match — deletion cancelled', 'error');
      return;
    }
    mutate(u.id, () => adminApi.deleteUserPermanently(u.id, typed.trim()), 'User permanently deleted');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by email…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white text-sm"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white text-sm"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-brand-500" /></div>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No users match your filters.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const busy = busyId === u.id;
            return (
              <div key={u.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">{u.email}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {u.isActive ? 'Active' : 'Inactive'} · {u.emailVerified ? 'Verified' : 'Unverified'} · joined {formatDate(u.createdAt)} · last seen {formatDate(u.lastLoginAt)}
                      {u._count && ` · ${u._count.biomarkers} biomarkers`}
                    </p>
                  </div>
                  {busy && <Loader2 className="w-4 h-4 animate-spin text-brand-500" />}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <label className="text-xs text-slate-500 dark:text-slate-400">Role
                    <select
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => mutate(u.id, () => adminApi.updateUser(u.id, { role: e.target.value as UserRole }), 'Role updated')}
                      className="ml-1 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded dark:bg-slate-700 dark:text-white text-xs"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>

                  <label className="text-xs text-slate-500 dark:text-slate-400">Plan
                    <select
                      value={(u.plan as string) || 'FREE'}
                      disabled={busy}
                      onChange={(e) => mutate(u.id, () => adminApi.updateUserPlan(u.id, { plan: e.target.value as 'FREE' | 'PRO' | 'TEAM' }), 'Plan updated')}
                      className="ml-1 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded dark:bg-slate-700 dark:text-white text-xs"
                    >
                      {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>

                  <button
                    onClick={() => mutate(u.id, () => adminApi.updateUser(u.id, { isActive: !u.isActive }), u.isActive ? 'User deactivated' : 'User activated')}
                    disabled={busy}
                    className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </button>

                  <button
                    onClick={() => handlePermanentDelete(u)}
                    disabled={busy}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg disabled:opacity-40">Prev</button>
          <span className="text-sm text-slate-500 dark:text-slate-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

// ============================================================ Audit log tab
function AuditLogTab({ onError }: { onError: Notify }) {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getAuditLogs({
        page,
        limit: 50,
        action: action.trim() || undefined,
        resourceType: resourceType.trim() || undefined,
      });
      setLogs(res.logs);
      setTotalPages(res.pagination.totalPages || 1);
    } catch (err) {
      onError(extractErrorMessage(err, 'Failed to load audit logs'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, action, resourceType, onError]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Filter by action (e.g. LOGIN)" className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white text-sm" />
        <input value={resourceType} onChange={(e) => { setResourceType(e.target.value); setPage(1); }} placeholder="Filter by resource type" className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white text-sm" />
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-brand-500" /></div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No audit entries match your filters.</p>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {logs.map((log) => (
                  <tr key={log.id} className="text-slate-700 dark:text-slate-300">
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs">{formatDateTime(log.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs">{log.user?.email ?? log.actorType ?? '—'}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white text-xs">{log.action}</td>
                    <td className="px-4 py-2.5 text-xs">{log.resourceType}{log.resourceId ? ` · ${log.resourceId.slice(0, 8)}…` : ''}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {log.success ? (
                        <span className="text-emerald-600 dark:text-emerald-400">OK</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400" title={log.errorMessage ?? undefined}>Failed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg disabled:opacity-40">Prev</button>
          <span className="text-sm text-slate-500 dark:text-slate-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

// ============================================================ Relationships tab
function RelationshipsTab({ onError, notify }: { onError: Notify; notify: Notify }) {
  const [rels, setRels] = useState<AdminProviderRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRels(await adminApi.getProviderRelationships(statusFilter || undefined));
    } catch (err) {
      onError(extractErrorMessage(err, 'Failed to load relationships'), 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, onError]);

  useEffect(() => { load(); }, [load]);

  const patch = async (id: string, data: Parameters<typeof adminApi.updateProviderRelationship>[1], okMsg: string) => {
    setBusyId(id);
    try {
      await adminApi.updateProviderRelationship(id, data);
      notify(okMsg, 'success');
      await load();
    } catch (err) {
      notify(extractErrorMessage(err, 'Update failed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white text-sm">
          <option value="">All statuses</option>
          {REL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-brand-500" /></div>
      ) : rels.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No provider–patient relationships found.</p>
      ) : (
        <div className="space-y-2">
          {rels.map((r) => {
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    <div>provider {r.providerId.slice(0, 8)}… → patient {r.patientId.slice(0, 8)}…</div>
                    <div className="mt-0.5">{r.relationshipType} · created {formatDate(r.createdAt)}{r.consentExpiresAt ? ` · expires ${formatDate(r.consentExpiresAt)}` : ''}</div>
                  </div>
                  {busy && <Loader2 className="w-4 h-4 animate-spin text-brand-500" />}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <label className="text-xs text-slate-500 dark:text-slate-400">Status
                    <select
                      value={r.status}
                      disabled={busy}
                      onChange={(e) => patch(r.id, { status: e.target.value }, 'Status updated')}
                      className="ml-1 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded dark:bg-slate-700 dark:text-white text-xs"
                    >
                      {REL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  {([
                    ['canViewBiomarkers', 'Biomarkers'],
                    ['canViewInsurance', 'Insurance'],
                    ['canViewHealthNeeds', 'Needs'],
                    ['canEditData', 'Edit'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={r[key]}
                        disabled={busy}
                        onChange={(e) => patch(r.id, { [key]: e.target.checked }, 'Permissions updated')}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================ Shell
const TABS: { id: TabId; label: string; icon: typeof Gauge }[] = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'users', label: 'Users', icon: UsersIcon },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'relationships', label: 'Relationships', icon: Stethoscope },
];

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>('overview');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback<Notify>((message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast((cur) => (cur?.message === message ? null : cur)), 3500);
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-brand-600 dark:text-brand-400" />
          Admin
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage users, review the audit trail, and oversee provider–patient consent. All actions here are themselves audit-logged.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab onError={notify} />}
      {tab === 'users' && <UsersTab onError={notify} notify={notify} />}
      {tab === 'audit' && <AuditLogTab onError={notify} />}
      {tab === 'relationships' && <RelationshipsTab onError={notify} notify={notify} />}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {toast.type === 'success' ? <Check className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span className="font-medium text-sm">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
