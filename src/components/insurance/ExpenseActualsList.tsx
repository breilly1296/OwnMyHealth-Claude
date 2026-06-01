/**
 * ExpenseActualsList - recorded claims/EOBs for a plan.
 *
 * Fetches via expensesApi.getActuals on mount. Rows sorted by service
 * date descending (backend already orders this way). Shows a claim-status
 * badge, running totals at the bottom, and an "Add claim" button that
 * opens ExpenseActualModal. Parent owns the modal state (so one modal
 * instance can serve projection-vs-actual comparison links too).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Receipt, Trash2 } from 'lucide-react';
import { expensesApi, type ExpenseActualData, type ClaimStatus } from '../../services/api';
import ExpenseActualModal from './ExpenseActualModal';

interface ExpenseActualsListProps {
  planId: string;
  /** Optional — parent can provide the list to reuse it for comparison. */
  onActualsChange?: (actuals: ExpenseActualData[]) => void;
  /** Render prop hook to inject a shared parent modal; when provided, the
   *  list delegates opening to the parent instead of using its own modal. */
  openExternalModal?: () => void;
  /** Fired only after a real mutation (create/delete), not on load. Lets the
   *  parent refetch the plan whose deductible/OOP met-amounts the backend
   *  recomputes from claims. */
  onMutated?: () => void;
}

const STATUS_BADGE: Record<ClaimStatus, string> = {
  processed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  denied: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  appealed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const STATUS_LABEL: Record<ClaimStatus, string> = {
  processed: 'Processed',
  pending: 'Pending',
  denied: 'Denied',
  appealed: 'Appealed',
};

function formatCurrency(value: number | null): string {
  if (value === null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ExpenseActualsList({
  planId,
  onActualsChange,
  openExternalModal,
  onMutated,
}: ExpenseActualsListProps) {
  const [actuals, setActuals] = useState<ExpenseActualData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await expensesApi.getActuals(planId);
      setActuals(data || []);
      onActualsChange?.(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load claims');
      setActuals([]);
      onActualsChange?.([]);
    } finally {
      setIsLoading(false);
    }
  }, [planId, onActualsChange]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    return actuals.reduce(
      (acc, a) => ({
        billed: acc.billed + (a.billedAmount ?? 0),
        insurance: acc.insurance + (a.insurancePaid ?? 0),
        patient: acc.patient + (a.patientPaid ?? 0),
      }),
      { billed: 0, insurance: 0, patient: 0 }
    );
  }, [actuals]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this claim entry?')) return;
    setDeletingId(id);
    try {
      await expensesApi.deleteActual(id);
      await load();
      onMutated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete claim');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddClick = () => {
    if (openExternalModal) {
      openExternalModal();
    } else {
      setIsModalOpen(true);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recorded Claims</h3>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Actual amounts from your EOBs and claim summaries
          </p>
        </div>
        <button
          onClick={handleAddClick}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add claim</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
        </div>
      ) : actuals.length === 0 ? (
        <div className="text-center py-12">
          <Receipt className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-gray-600 dark:text-slate-400 mb-4">
            No claims recorded yet — add actuals from your EOB statements.
          </p>
          <button
            onClick={handleAddClick}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add your first claim
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Desktop table header */}
          <div className="hidden md:grid md:grid-cols-[1fr_2fr_1fr_1fr_1fr_0.8fr_auto] gap-3 px-3 py-2 text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
            <div>Date</div>
            <div>Service</div>
            <div className="text-right">Billed</div>
            <div className="text-right">Insurance</div>
            <div className="text-right">Patient</div>
            <div>Status</div>
            <div></div>
          </div>

          {actuals.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-2 md:grid-cols-[1fr_2fr_1fr_1fr_1fr_0.8fr_auto] gap-3 px-3 py-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200 dark:border-slate-600 items-center text-sm"
            >
              <div className="text-gray-600 dark:text-slate-300 md:col-span-1">
                <span className="md:hidden text-xs text-gray-400 mr-2">Date</span>
                {formatDate(a.serviceDate)}
              </div>
              <div className="text-gray-900 dark:text-white font-medium col-span-2 md:col-span-1 truncate">
                {a.serviceType}
                {a.providerName && (
                  <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">· {a.providerName}</span>
                )}
                {!a.isInNetwork && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded">
                    OON
                  </span>
                )}
              </div>
              <div className="text-right text-gray-700 dark:text-slate-300">
                <span className="md:hidden text-xs text-gray-400 mr-1">Billed</span>
                {formatCurrency(a.billedAmount)}
              </div>
              <div className="text-right text-gray-700 dark:text-slate-300">
                <span className="md:hidden text-xs text-gray-400 mr-1">Ins.</span>
                {formatCurrency(a.insurancePaid)}
              </div>
              <div className="text-right text-gray-900 dark:text-white font-medium">
                <span className="md:hidden text-xs text-gray-400 mr-1">Pt.</span>
                {formatCurrency(a.patientPaid)}
              </div>
              <div>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_BADGE[a.claimStatus]}`}>
                  {STATUS_LABEL[a.claimStatus]}
                </span>
              </div>
              <div className="flex items-center gap-1 justify-end">
                <button
                  onClick={() => handleDelete(a.id)}
                  disabled={deletingId === a.id}
                  className="p-1.5 text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
                  aria-label="Delete claim"
                >
                  {deletingId === a.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}

          {/* Running totals */}
          <div className="grid grid-cols-2 md:grid-cols-[1fr_2fr_1fr_1fr_1fr_0.8fr_auto] gap-3 px-3 py-3 mt-2 border-t-2 border-gray-200 dark:border-slate-600 text-sm font-semibold text-gray-900 dark:text-white">
            <div className="col-span-2 md:col-span-2">Totals</div>
            <div className="text-right">{formatCurrency(totals.billed)}</div>
            <div className="text-right">{formatCurrency(totals.insurance)}</div>
            <div className="text-right">{formatCurrency(totals.patient)}</div>
            <div></div>
            <div></div>
          </div>
        </div>
      )}

      {/* Self-owned modal, only used when parent doesn't supply one. */}
      {!openExternalModal && (
        <ExpenseActualModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            load();
            onMutated?.();
          }}
          planId={planId}
        />
      )}
    </div>
  );
}
