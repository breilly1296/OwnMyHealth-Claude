import React, { useState, useCallback } from 'react';
import { X, Upload, FileText, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { insuranceApi } from '../../services/api/insurance';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface AddInsurancePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanAdded: () => void;
}

type TabType = 'manual' | 'upload';
type PlanType = 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';

interface FormData {
  planName: string;
  insurerName: string;
  planType: PlanType;
  planIdNumber: string;
  effectiveDate: string;
  terminationDate: string;
  premium: string;
  deductible: string;
  deductibleFamily: string;
  outOfPocketMax: string;
  outOfPocketMaxFamily: string;
  deductibleMetIndividual: string;
  deductibleMetFamily: string;
  oopMetIndividual: string;
  oopMetFamily: string;
  copayPrimaryCare: string;
  copaySpecialist: string;
  copayUrgentCare: string;
  copayEmergency: string;
  coinsuranceRate: string;
}

const initialFormData: FormData = {
  planName: '',
  insurerName: '',
  planType: 'PPO',
  planIdNumber: '',
  effectiveDate: new Date().toISOString().split('T')[0],
  terminationDate: '',
  premium: '',
  deductible: '',
  deductibleFamily: '',
  outOfPocketMax: '',
  outOfPocketMaxFamily: '',
  deductibleMetIndividual: '0',
  deductibleMetFamily: '0',
  oopMetIndividual: '0',
  oopMetFamily: '0',
  copayPrimaryCare: '',
  copaySpecialist: '',
  copayUrgentCare: '',
  copayEmergency: '',
  coinsuranceRate: '',
};

export default function AddInsurancePlanModal({
  isOpen,
  onClose,
  onPlanAdded,
}: AddInsurancePlanModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('manual');
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ordered list of tab ids for ARIA keyboard navigation (Arrow/Home/End).
  const tabOrder: TabType[] = ['manual', 'upload'];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabOrder.indexOf(activeTab);
    let newIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % tabOrder.length;
    } else if (e.key === 'ArrowLeft') {
      newIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
    } else if (e.key === 'Home') {
      newIndex = 0;
    } else if (e.key === 'End') {
      newIndex = tabOrder.length - 1;
    }
    if (newIndex === null) return;
    e.preventDefault();
    const newTab = tabOrder[newIndex];
    setActiveTab(newTab);
    document.getElementById(`addplan-tab-${newTab}`)?.focus();
  };

  // Upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadResult, setUploadResult] = useState<{
    planName: string;
    insurerName: string;
    planType: string;
    deductible: number;
    outOfPocketMax: number;
    benefitsCount: number;
    extractionConfidence: number;
  } | null>(null);

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await insuranceApi.createPlan({
        planName: formData.planName,
        insurerName: formData.insurerName,
        planType: formData.planType,
        effectiveDate: formData.effectiveDate,
        terminationDate: formData.terminationDate || undefined,
        premium: formData.premium ? parseFloat(formData.premium) : undefined,
        // Backend expects 'deductible' and 'outOfPocketMax'
        deductible: parseFloat(formData.deductible) || 0,
        deductibleFamily: formData.deductibleFamily
          ? parseFloat(formData.deductibleFamily)
          : undefined,
        outOfPocketMax: parseFloat(formData.outOfPocketMax) || 0,
        outOfPocketMaxFamily: formData.outOfPocketMaxFamily
          ? parseFloat(formData.outOfPocketMaxFamily)
          : undefined,
        deductibleMetIndividual: parseFloat(formData.deductibleMetIndividual) || 0,
        deductibleMetFamily: parseFloat(formData.deductibleMetFamily) || 0,
        oopMetIndividual: parseFloat(formData.oopMetIndividual) || 0,
        oopMetFamily: parseFloat(formData.oopMetFamily) || 0,
        copayPrimaryCare: formData.copayPrimaryCare
          ? parseFloat(formData.copayPrimaryCare)
          : undefined,
        copaySpecialist: formData.copaySpecialist
          ? parseFloat(formData.copaySpecialist)
          : undefined,
        copayUrgentCare: formData.copayUrgentCare
          ? parseFloat(formData.copayUrgentCare)
          : undefined,
        copayEmergency: formData.copayEmergency
          ? parseFloat(formData.copayEmergency)
          : undefined,
        coinsuranceRate: formData.coinsuranceRate
          ? parseFloat(formData.coinsuranceRate)
          : undefined,
      });

      onPlanAdded();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create insurance plan');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      setUploadFile(file);
      setUploadStatus('idle');
      setUploadResult(null);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setUploadFile(file);
      setUploadStatus('idle');
      setUploadResult(null);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;

    setUploadStatus('uploading');
    setError(null);

    try {
      const result = await insuranceApi.uploadSBC(uploadFile);
      setUploadStatus('success');
      setUploadResult({
        planName: result.planName,
        insurerName: result.insurerName,
        planType: result.planType,
        deductible: result.deductibleIndividual,
        outOfPocketMax: result.oopMaxIndividual,
        benefitsCount: 0, // Will be populated from full response
        extractionConfidence: 0.85, // Default confidence
      });
      onPlanAdded();
    } catch (err) {
      setUploadStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to upload SBC document');
    }
  };

  const handleClose = () => {
    setFormData(initialFormData);
    setActiveTab('manual');
    setUploadFile(null);
    setUploadStatus('idle');
    setUploadResult(null);
    setError(null);
    onClose();
  };

  // Dialog a11y (Escape / focus trap / focus restore / scroll lock). Wire Escape
  // through handleClose — not the raw onClose — so an Escape-close resets the
  // form / active tab / upload state exactly like the X and Cancel buttons
  // (otherwise stale state reappears the next time the modal opens).
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, handleClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="addplan-modal-title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-lg w-full md:max-w-2xl max-h-[90vh] md:max-h-[85vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 md:p-6 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="addplan-modal-title"
            className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white"
          >
            Add Insurance Plan
          </h2>
          <button
            onClick={handleClose}
            className="p-2 -mr-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Add insurance plan method"
          className="flex border-b border-gray-200 dark:border-gray-700 px-4 md:px-6"
        >
          <button
            role="tab"
            id="addplan-tab-manual"
            aria-selected={activeTab === 'manual'}
            aria-controls="addplan-panel-manual"
            tabIndex={activeTab === 'manual' ? 0 : -1}
            onClick={() => setActiveTab('manual')}
            onKeyDown={handleTabKeyDown}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'manual'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <FileText className="w-4 h-4 inline-block mr-2" />
            Manual Entry
          </button>
          <button
            role="tab"
            id="addplan-tab-upload"
            aria-selected={activeTab === 'upload'}
            aria-controls="addplan-panel-upload"
            tabIndex={activeTab === 'upload' ? 0 : -1}
            onClick={() => setActiveTab('upload')}
            onKeyDown={handleTabKeyDown}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'upload'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Upload className="w-4 h-4 inline-block mr-2" />
            Upload SBC
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          {activeTab === 'manual' ? (
            <form
              role="tabpanel"
              id="addplan-panel-manual"
              aria-labelledby="addplan-tab-manual"
              tabIndex={0}
              onSubmit={handleManualSubmit}
              className="space-y-6"
            >
              {/* Plan Details */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                  Plan Details
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Plan Name *
                    </label>
                    <input
                      type="text"
                      value={formData.planName}
                      onChange={(e) => handleInputChange('planName', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Insurance Company *
                    </label>
                    <input
                      type="text"
                      value={formData.insurerName}
                      onChange={(e) => handleInputChange('insurerName', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Plan Type *
                    </label>
                    <select
                      value={formData.planType}
                      onChange={(e) => handleInputChange('planType', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      required
                    >
                      <option value="PPO">PPO</option>
                      <option value="HMO">HMO</option>
                      <option value="EPO">EPO</option>
                      <option value="POS">POS</option>
                      <option value="HDHP">HDHP</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Plan ID
                    </label>
                    <input
                      type="text"
                      value={formData.planIdNumber}
                      onChange={(e) => handleInputChange('planIdNumber', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Dates */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Dates</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Effective Date *
                    </label>
                    <input
                      type="date"
                      value={formData.effectiveDate}
                      onChange={(e) => handleInputChange('effectiveDate', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Termination Date
                    </label>
                    <input
                      type="date"
                      value={formData.terminationDate}
                      onChange={(e) => handleInputChange('terminationDate', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Costs */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                  Plan Costs
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Monthly Premium
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.premium}
                        onChange={(e) => handleInputChange('premium', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Coinsurance Rate (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formData.coinsuranceRate}
                      onChange={(e) => handleInputChange('coinsuranceRate', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Deductible (Individual) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.deductible}
                        onChange={(e) => handleInputChange('deductible', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Deductible (Family)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.deductibleFamily}
                        onChange={(e) => handleInputChange('deductibleFamily', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Out-of-Pocket Max (Individual) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.outOfPocketMax}
                        onChange={(e) => handleInputChange('outOfPocketMax', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Out-of-Pocket Max (Family)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.outOfPocketMaxFamily}
                        onChange={(e) => handleInputChange('outOfPocketMaxFamily', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress Tracking */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                  Current Progress
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Deductible Met (Individual)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.deductibleMetIndividual}
                        onChange={(e) =>
                          handleInputChange('deductibleMetIndividual', e.target.value)
                        }
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      OOP Met (Individual)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.oopMetIndividual}
                        onChange={(e) => handleInputChange('oopMetIndividual', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Copays */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Copays</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Primary Care
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.copayPrimaryCare}
                        onChange={(e) => handleInputChange('copayPrimaryCare', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Specialist
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.copaySpecialist}
                        onChange={(e) => handleInputChange('copaySpecialist', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Urgent Care
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.copayUrgentCare}
                        onChange={(e) => handleInputChange('copayUrgentCare', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                      Emergency
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.copayEmergency}
                        onChange={(e) => handleInputChange('copayEmergency', e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 pl-7 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Add Plan
                </button>
              </div>
            </form>
          ) : (
            <div
              role="tabpanel"
              id="addplan-panel-upload"
              aria-labelledby="addplan-tab-upload"
              tabIndex={0}
              className="space-y-6"
            >
              {/* Upload Area */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="sbc-upload"
                />
                <label htmlFor="sbc-upload" className="cursor-pointer">
                  <Upload className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-4" />
                  <p className="text-gray-600 dark:text-gray-400 mb-2">
                    {uploadFile ? uploadFile.name : 'Drag and drop your SBC PDF here'}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-500">
                    or click to select a file
                  </p>
                </label>
              </div>

              {/* Upload Status */}
              {uploadStatus === 'uploading' && (
                <div className="flex items-center justify-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <Loader2 className="w-5 h-5 mr-3 animate-spin text-blue-600" />
                  <span className="text-blue-700 dark:text-blue-300">
                    Extracting plan details...
                  </span>
                </div>
              )}

              {uploadStatus === 'success' && uploadResult && (
                <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="flex items-center mb-3">
                    <CheckCircle className="w-5 h-5 mr-2 text-green-600" />
                    <span className="font-medium text-green-700 dark:text-green-300">
                      Plan extracted successfully!
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-green-700 dark:text-green-300">
                    <div>Plan: {uploadResult.planName}</div>
                    <div>Insurer: {uploadResult.insurerName}</div>
                    <div>Type: {uploadResult.planType}</div>
                    <div>Deductible: ${uploadResult.deductible}</div>
                  </div>
                </div>
              )}

              {uploadStatus === 'error' && (
                <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertCircle className="w-5 h-5 mr-2 text-red-600" />
                  <span className="text-red-700 dark:text-red-300">{error}</span>
                </div>
              )}

              {/* Upload Button */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  {uploadStatus === 'success' ? 'Done' : 'Cancel'}
                </button>
                {uploadStatus !== 'success' && (
                  <button
                    onClick={handleUpload}
                    disabled={!uploadFile || uploadStatus === 'uploading'}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    {uploadStatus === 'uploading' && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    Upload & Extract
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
