/**
 * ExpenseActualModal - add or edit a recorded expense (claim/EOB entry).
 *
 * Modal form matching the styling of ExpenseProjectionModal. Fields map
 * to CreateExpenseActualData from the API. All dollar fields use a `$`
 * prefix and blur-format to two decimal places. Patient paid auto-fills
 * from billed minus insurance paid (user can override).
 */

import { useState, useEffect } from 'react';
import { Receipt } from 'lucide-react';
import Modal from '../common/Modal';
import {
  expensesApi,
  type ExpenseActualData,
  type CreateExpenseActualData,
  type UpdateExpenseActualData,
  type ClaimStatus,
} from '../../services/api';

interface ExpenseActualModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  planId: string;
  actual?: ExpenseActualData | null;
  /** Pre-fill projectionId + optionally pre-fill serviceType from a projection row. */
  defaultProjectionId?: string;
  defaultServiceType?: string;
}

interface FormData {
  serviceType: string;
  serviceDate: string;
  providerName: string;
  billedAmount: string;
  insurancePaid: string;
  patientPaid: string;
  appliedToDeductible: string;
  appliedToOop: string;
  isInNetwork: boolean;
  claimStatus: ClaimStatus;
  notes: string;
}

const emptyForm: FormData = {
  serviceType: '',
  serviceDate: '',
  providerName: '',
  billedAmount: '',
  insurancePaid: '',
  patientPaid: '',
  appliedToDeductible: '',
  appliedToOop: '',
  isInNetwork: true,
  claimStatus: 'processed',
  notes: '',
};

function formatMoneyOnBlur(v: string): string {
  if (!v) return '';
  const n = parseFloat(v);
  if (Number.isNaN(n)) return '';
  return n.toFixed(2);
}

function parseOptionalNumber(v: string): number | undefined {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

interface MoneyInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  hint?: string;
}

function MoneyInput({ id, label, value, onChange, onBlur, hint }: MoneyInputProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
        {label}
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <span className="text-gray-500 dark:text-slate-400">$</span>
        </div>
        <input
          type="number"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            onChange(formatMoneyOnBlur(value));
            onBlur?.();
          }}
          className="w-full pl-7 pr-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
          placeholder="0.00"
          step="0.01"
          min="0"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export default function ExpenseActualModal({
  isOpen,
  onClose,
  onSuccess,
  planId,
  actual,
  defaultProjectionId,
  defaultServiceType,
}: ExpenseActualModalProps) {
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track whether the user has manually touched patientPaid so auto-fill
  // doesn't clobber their override.
  const [patientPaidTouched, setPatientPaidTouched] = useState(false);

  useEffect(() => {
    if (actual) {
      setFormData({
        serviceType: actual.serviceType,
        serviceDate: actual.serviceDate ?? '',
        providerName: actual.providerName ?? '',
        billedAmount: actual.billedAmount !== null ? actual.billedAmount.toFixed(2) : '',
        insurancePaid: actual.insurancePaid !== null ? actual.insurancePaid.toFixed(2) : '',
        patientPaid: actual.patientPaid !== null ? actual.patientPaid.toFixed(2) : '',
        appliedToDeductible: actual.appliedToDeductible !== null ? actual.appliedToDeductible.toFixed(2) : '',
        appliedToOop: actual.appliedToOop !== null ? actual.appliedToOop.toFixed(2) : '',
        isInNetwork: actual.isInNetwork,
        claimStatus: actual.claimStatus,
        notes: actual.notes ?? '',
      });
      setPatientPaidTouched(true);
    } else {
      setFormData({
        ...emptyForm,
        serviceType: defaultServiceType ?? '',
      });
      setPatientPaidTouched(false);
    }
    setError(null);
  }, [actual, defaultServiceType, isOpen]);

  const updateField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-fill patientPaid = billedAmount - insurancePaid, unless user has overridden it.
      if ((field === 'billedAmount' || field === 'insurancePaid') && !patientPaidTouched) {
        const billed = parseFloat(String(next.billedAmount));
        const insured = parseFloat(String(next.insurancePaid));
        if (Number.isFinite(billed) && Number.isFinite(insured)) {
          const diff = Math.max(0, billed - insured);
          next.patientPaid = diff.toFixed(2);
        }
      }
      return next;
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.serviceType.trim()) {
      setError('Service type is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload: CreateExpenseActualData = {
        planId,
        projectionId: defaultProjectionId,
        serviceType: formData.serviceType.trim(),
        serviceDate: formData.serviceDate || undefined,
        providerName: formData.providerName.trim() || undefined,
        billedAmount: parseOptionalNumber(formData.billedAmount),
        insurancePaid: parseOptionalNumber(formData.insurancePaid),
        patientPaid: parseOptionalNumber(formData.patientPaid),
        appliedToDeductible: parseOptionalNumber(formData.appliedToDeductible),
        appliedToOop: parseOptionalNumber(formData.appliedToOop),
        isInNetwork: formData.isInNetwork,
        claimStatus: formData.claimStatus,
        notes: formData.notes.trim() || undefined,
      };

      if (actual) {
        const update: UpdateExpenseActualData = { ...payload };
        delete (update as { planId?: string }).planId;
        delete (update as { projectionId?: string }).projectionId;
        await expensesApi.updateActual(actual.id, update);
      } else {
        await expensesApi.createActual(payload);
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense actual');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={actual ? 'Edit Claim Entry' : 'Add Claim Entry'}
      subtitle="Record an actual claim or EOB line so your tracking reflects real spending"
      icon={<Receipt className="w-6 h-6 text-emerald-600" />}
      size="md"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {/* Service type */}
        <div>
          <label htmlFor="actualServiceType" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Service type *
          </label>
          <input
            type="text"
            id="actualServiceType"
            value={formData.serviceType}
            onChange={(e) => updateField('serviceType', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
            placeholder="e.g., Primary Care Visit"
            required
          />
        </div>

        {/* Service date + provider */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="serviceDate" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Date of service
            </label>
            <input
              type="date"
              id="serviceDate"
              value={formData.serviceDate}
              onChange={(e) => updateField('serviceDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="providerName" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Provider name
            </label>
            <input
              type="text"
              id="providerName"
              value={formData.providerName}
              onChange={(e) => updateField('providerName', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
              placeholder="Optional"
            />
          </div>
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MoneyInput
            id="billedAmount"
            label="Billed amount"
            value={formData.billedAmount}
            onChange={(v) => updateField('billedAmount', v)}
          />
          <MoneyInput
            id="insurancePaid"
            label="Insurance paid"
            value={formData.insurancePaid}
            onChange={(v) => updateField('insurancePaid', v)}
          />
          <MoneyInput
            id="patientPaid"
            label="Patient paid"
            value={formData.patientPaid}
            onChange={(v) => {
              setPatientPaidTouched(true);
              updateField('patientPaid', v);
            }}
            hint={patientPaidTouched ? undefined : 'Auto-filled from billed − insurance paid. Edit to override.'}
          />
          <MoneyInput
            id="appliedToDeductible"
            label="Applied to deductible"
            value={formData.appliedToDeductible}
            onChange={(v) => updateField('appliedToDeductible', v)}
          />
          <MoneyInput
            id="appliedToOop"
            label="Applied to out-of-pocket"
            value={formData.appliedToOop}
            onChange={(v) => updateField('appliedToOop', v)}
          />
        </div>

        {/* Network + status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center space-x-3 cursor-pointer pt-8">
              <input
                type="checkbox"
                checked={formData.isInNetwork}
                onChange={(e) => updateField('isInNetwork', e.target.checked)}
                className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-700"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-slate-300">In-network provider</span>
            </label>
          </div>
          <div>
            <label htmlFor="claimStatus" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Claim status
            </label>
            <select
              id="claimStatus"
              value={formData.claimStatus}
              onChange={(e) => updateField('claimStatus', e.target.value as ClaimStatus)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
            >
              <option value="pending">Pending</option>
              <option value="processed">Processed</option>
              <option value="denied">Denied</option>
              <option value="appealed">Appealed</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="actualNotes" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Notes (optional)
          </label>
          <textarea
            id="actualNotes"
            value={formData.notes}
            onChange={(e) => updateField('notes', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
            placeholder="EOB reference number, claim details, etc."
          />
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Saving...' : actual ? 'Update Entry' : 'Add Entry'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
