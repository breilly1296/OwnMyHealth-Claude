/**
 * ExpenseProjectionModal - Add or edit expense projections
 *
 * Modal form for creating and editing expected healthcare expenses
 * for cost optimization and out-of-pocket planning.
 */

import React, { useState, useEffect } from 'react';
import { DollarSign } from 'lucide-react';
import Modal from '../common/Modal';
import { expensesApi, ExpenseProjectionData, CreateExpenseProjectionData } from '../../services/api';

interface ExpenseProjectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  planId: string;
  projection?: ExpenseProjectionData | null;
}

interface FormData {
  serviceType: string;
  estimatedCost: string;
  frequencyPerYear: string;
  isInNetwork: boolean;
  notes: string;
}

const initialFormData: FormData = {
  serviceType: '',
  estimatedCost: '',
  frequencyPerYear: '1',
  isInNetwork: true,
  notes: '',
};

const commonServiceTypes = [
  'Primary Care Visit',
  'Specialist Visit',
  'Urgent Care Visit',
  'Emergency Room Visit',
  'Lab Work',
  'X-Ray',
  'MRI/CT Scan',
  'Physical Therapy',
  'Mental Health Counseling',
  'Prescription Medication',
  'Surgery',
  'Hospital Stay',
  'Other',
];

export default function ExpenseProjectionModal({
  isOpen,
  onClose,
  onSuccess,
  planId,
  projection,
}: ExpenseProjectionModalProps) {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when editing existing projection
  useEffect(() => {
    if (projection) {
      setFormData({
        serviceType: projection.serviceType,
        estimatedCost: projection.estimatedCost.toString(),
        frequencyPerYear: projection.frequencyPerYear.toString(),
        isInNetwork: projection.isInNetwork,
        notes: projection.notes || '',
      });
    } else {
      setFormData(initialFormData);
    }
    setError(null);
  }, [projection, isOpen]);

  const handleInputChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const validateForm = (): boolean => {
    if (!formData.serviceType.trim()) {
      setError('Service type is required');
      return false;
    }

    const cost = parseFloat(formData.estimatedCost);
    if (isNaN(cost) || cost < 0) {
      setError('Please enter a valid cost');
      return false;
    }

    const frequency = parseInt(formData.frequencyPerYear);
    if (isNaN(frequency) || frequency < 1 || frequency > 365) {
      setError('Frequency must be between 1 and 365 per year');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const data: CreateExpenseProjectionData = {
        planId,
        serviceType: formData.serviceType.trim(),
        estimatedCost: parseFloat(formData.estimatedCost),
        frequencyPerYear: parseInt(formData.frequencyPerYear),
        isInNetwork: formData.isInNetwork,
        notes: formData.notes.trim() || undefined,
      };

      if (projection) {
        // Update existing projection
        await expensesApi.updateProjection(projection.id, data);
      } else {
        // Create new projection
        await expensesApi.createProjection(data);
      }

      setFormData(initialFormData);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense projection');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setFormData(initialFormData);
      setError(null);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={projection ? 'Edit Expense Projection' : 'Add Expense Projection'}
      subtitle="Estimate your expected healthcare costs for better financial planning"
      icon={<DollarSign className="w-6 h-6 text-emerald-600" />}
      size="md"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* Service Type */}
        <div>
          <label htmlFor="serviceType" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Service Type *
          </label>
          <input
            type="text"
            id="serviceType"
            list="serviceTypeOptions"
            value={formData.serviceType}
            onChange={(e) => handleInputChange('serviceType', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
            placeholder="e.g., Primary Care Visit"
            required
          />
          <datalist id="serviceTypeOptions">
            {commonServiceTypes.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Select from common services or enter your own
          </p>
        </div>

        {/* Estimated Cost */}
        <div>
          <label htmlFor="estimatedCost" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Estimated Cost *
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 dark:text-slate-400">$</span>
            </div>
            <input
              type="number"
              id="estimatedCost"
              value={formData.estimatedCost}
              onChange={(e) => handleInputChange('estimatedCost', e.target.value)}
              className="w-full pl-7 pr-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
              placeholder="0.00"
              step="0.01"
              min="0"
              required
            />
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Your estimated out-of-pocket cost per visit
          </p>
        </div>

        {/* Frequency Per Year */}
        <div>
          <label htmlFor="frequencyPerYear" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Frequency Per Year *
          </label>
          <input
            type="number"
            id="frequencyPerYear"
            value={formData.frequencyPerYear}
            onChange={(e) => handleInputChange('frequencyPerYear', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
            min="1"
            max="365"
            required
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            How many times per year do you expect this service?
          </p>
        </div>

        {/* In-Network Toggle */}
        <div>
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.isInNetwork}
              onChange={(e) => handleInputChange('isInNetwork', e.target.checked)}
              className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-700"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
              In-Network Provider
            </span>
          </label>
          <p className="mt-1 ml-7 text-xs text-gray-500 dark:text-slate-400">
            Check if you plan to use in-network providers
          </p>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Notes (Optional)
          </label>
          <textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-700 dark:text-white"
            placeholder="Add any additional details about this expense..."
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
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
            {isSubmitting ? 'Saving...' : projection ? 'Update Projection' : 'Add Projection'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
