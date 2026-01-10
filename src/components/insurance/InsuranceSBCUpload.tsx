/**
 * InsuranceSBCUpload Component
 *
 * A modal for uploading and processing Summary of Benefits and Coverage (SBC) documents.
 * Uploads PDFs to the backend where Claude Sonnet extracts plan details.
 *
 * Features:
 * - Drag-and-drop or click-to-upload interface for PDF files
 * - Multi-file upload support with individual processing status
 * - Real-time processing indicators (loading spinner, success checkmark, error alert)
 * - Expandable preview for each successfully processed plan showing:
 *   - Plan information (name, insurer, type, effective date)
 *   - Key benefits coverage (copays, coinsurance)
 *   - Cost summary grid (deductible, premium, OOP max)
 * - Import button to add extracted plan to user's insurance data
 *
 * Processing shows confidence score indicating extraction accuracy.
 *
 * @module components/insurance/InsuranceSBCUpload
 */

import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, Shield, DollarSign, Loader2, CheckCircle, AlertCircle, Eye } from 'lucide-react';
import type { InsurancePlan } from '../../types';
import { insuranceApi, InsurancePlanData } from '../../services/api/insurance';

interface UploadResult {
  success: boolean;
  plan?: InsurancePlanData;
  error?: string;
  confidence?: number;
}

interface InsuranceSBCUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanExtracted: (plan: InsurancePlan) => void;
}

export default function InsuranceSBCUpload({ isOpen, onClose, onPlanExtracted }: InsuranceSBCUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ file: File; result?: UploadResult }>>([]);
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFiles = async (files: File[]) => {
    for (const file of files) {
      if (file.type !== 'application/pdf') {
        continue; // Skip non-PDF files
      }

      const fileEntry = { file };
      setUploadedFiles(prev => [...prev, fileEntry]);
      setProcessingFiles(prev => new Set(prev.add(file.name)));

      try {
        // Upload directly to backend - Claude Sonnet extracts the data
        const planData = await insuranceApi.uploadSBC(file);

        setUploadedFiles(prev => prev.map(entry =>
          entry.file.name === file.name
            ? {
                ...entry,
                result: {
                  success: true,
                  plan: planData,
                  confidence: planData.sbcExtractionConfidence ?? 0.85
                }
              }
            : entry
        ));

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to process file';
        setUploadedFiles(prev => prev.map(entry =>
          entry.file.name === file.name
            ? {
                ...entry,
                result: {
                  success: false,
                  error: errorMessage
                }
              }
            : entry
        ));
      } finally {
        setProcessingFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(file.name);
          return newSet;
        });
      }
    }
  };

  const handleImportPlan = (planData: InsurancePlanData) => {
    // Convert InsurancePlanData to InsurancePlan for the callback
    const plan: InsurancePlan = {
      id: planData.id,
      planName: planData.planName,
      insurerName: planData.insurerName,
      planType: planData.planType,
      planIdNumber: planData.planIdNumber,
      effectiveDate: planData.effectiveDate,
      terminationDate: planData.terminationDate,
      uploadDate: new Date().toISOString(),
      sourceFile: 'SBC Upload',
      extractionConfidence: planData.sbcExtractionConfidence ?? 0.85,
      deductibleMetIndividual: planData.deductibleMetIndividual,
      deductibleMetFamily: planData.deductibleMetFamily,
      oopMetIndividual: planData.oopMetIndividual,
      oopMetFamily: planData.oopMetFamily,
      copayPrimaryCare: planData.copayPrimaryCare,
      copaySpecialist: planData.copaySpecialist,
      copayUrgentCare: planData.copayUrgentCare,
      copayEmergency: planData.copayEmergency,
      coinsuranceRate: planData.coinsuranceRate,
      extractedFromSbc: planData.extractedFromSbc,
      sbcExtractionConfidence: planData.sbcExtractionConfidence,
      benefits: [],
      costs: [
        {
          id: '1',
          type: 'Deductible',
          amount: planData.deductibleIndividual,
          frequency: 'Annual',
          description: 'Individual deductible',
          appliesTo: 'Individual'
        },
        {
          id: '2',
          type: 'Out-of-Pocket Maximum',
          amount: planData.oopMaxIndividual,
          frequency: 'Annual',
          description: 'Individual out-of-pocket maximum',
          appliesTo: 'Individual'
        },
        ...(planData.premiumMonthly ? [{
          id: '3',
          type: 'Premium' as const,
          amount: planData.premiumMonthly,
          frequency: 'Monthly' as const,
          description: 'Monthly premium',
          appliesTo: 'Individual' as const
        }] : [])
      ],
      limitations: [],
      network: {
        geographicCoverage: []
      }
    };
    onPlanExtracted(plan);
    onClose();
    setUploadedFiles([]);
    setSelectedPlan(null);
  };

  const getStatusIcon = (result?: UploadResult, isProcessing?: boolean) => {
    if (isProcessing) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    }
    if (result?.success) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    if (result && !result.success) {
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
    return null;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Upload Insurance Summary of Benefits</h2>
            <p className="text-sm text-gray-600 mt-1">
              Upload your SBC documents to automatically extract plan features and coverage details
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Upload Area */}
        <div className="p-6">
          <div
            className={`
              relative border-2 border-dashed rounded-lg p-8 transition-colors duration-200
              ${dragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              multiple
              accept=".pdf"
              onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            
            <div className="text-center">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">
                Drop SBC files here or click to upload
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Supports PDF files up to 10MB
              </p>
              
              <div className="flex justify-center space-x-6 text-xs text-gray-500">
                <div className="flex items-center">
                  <Shield className="w-4 h-4 mr-1 text-blue-500" />
                  Plan Coverage
                </div>
                <div className="flex items-center">
                  <DollarSign className="w-4 h-4 mr-1 text-green-500" />
                  Cost Details
                </div>
                <div className="flex items-center">
                  <FileText className="w-4 h-4 mr-1 text-purple-500" />
                  Benefits Summary
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* File List */}
        {uploadedFiles.length > 0 && (
          <div className="flex-1 overflow-hidden px-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Uploaded Files ({uploadedFiles.length})
            </h3>
            
            <div className="overflow-y-auto max-h-96 space-y-4">
              {uploadedFiles.map((fileEntry, index) => {
                const isProcessing = processingFiles.has(fileEntry.file.name);
                const result = fileEntry.result;
                const plan = result?.plan;
                const isExpanded = selectedPlan === fileEntry.file.name;

                return (
                  <div key={index} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* File Header */}
                    <div className="flex items-center justify-between p-4 bg-gray-50">
                      <div className="flex items-center space-x-3 flex-1">
                        <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                          <FileText className="w-5 h-5" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {fileEntry.file.name}
                          </p>
                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                            <span>{formatFileSize(fileEntry.file.size)}</span>
                            {result && result.success && plan && (
                              <span className="text-green-600">
                                Plan extracted successfully
                              </span>
                            )}
                            {result && result.confidence && (
                              <span className="text-blue-600">
                                {Math.round(result.confidence * 100)}% confidence
                              </span>
                            )}
                            {result && result.success && plan && (
                              <span className={plan.usedClaudeExtraction ? 'text-purple-600' : 'text-orange-600'}>
                                {plan.usedClaudeExtraction ? 'AI extracted' : 'Regex fallback'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        {result && result.success && plan && (
                          <button
                            onClick={() => setSelectedPlan(isExpanded ? null : fileEntry.file.name)}
                            className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            {isExpanded ? 'Hide' : 'Preview'}
                          </button>
                        )}

                        {getStatusIcon(result, isProcessing)}
                      </div>
                    </div>

                    {/* Plan Preview */}
                    {isExpanded && result?.success && plan && (
                      <div className="p-4 border-t border-gray-200 bg-white">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {/* Plan Information */}
                          <div>
                            <h4 className="font-medium text-gray-900 mb-3">Plan Information</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Plan Name:</span>
                                <span className="font-medium">{plan.planName}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Insurer:</span>
                                <span className="font-medium">{plan.insurerName}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Plan Type:</span>
                                <span className="font-medium">{plan.planType}</span>
                              </div>
                              {plan.planIdNumber && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Plan ID:</span>
                                  <span className="font-medium">{plan.planIdNumber}</span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-gray-600">Effective Date:</span>
                                <span className="font-medium">{new Date(plan.effectiveDate).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>

                          {/* Copays & Coverage */}
                          <div>
                            <h4 className="font-medium text-gray-900 mb-3">Copays & Coverage</h4>
                            <div className="space-y-2 text-sm">
                              {plan.copayPrimaryCare !== undefined && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Primary Care:</span>
                                  <span className="font-medium">${plan.copayPrimaryCare} copay</span>
                                </div>
                              )}
                              {plan.copaySpecialist !== undefined && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Specialist:</span>
                                  <span className="font-medium">${plan.copaySpecialist} copay</span>
                                </div>
                              )}
                              {plan.copayUrgentCare !== undefined && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Urgent Care:</span>
                                  <span className="font-medium">${plan.copayUrgentCare} copay</span>
                                </div>
                              )}
                              {plan.copayEmergency !== undefined && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Emergency Room:</span>
                                  <span className="font-medium">${plan.copayEmergency} copay</span>
                                </div>
                              )}
                              {plan.coinsuranceRate !== undefined && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Coinsurance:</span>
                                  <span className="font-medium">{plan.coinsuranceRate}%</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Costs Summary */}
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <h4 className="font-medium text-gray-900 mb-3">Cost Summary</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center p-3 bg-gray-50 rounded-lg">
                              <p className="text-xs text-gray-600 mb-1">Deductible (Individual)</p>
                              <p className="text-lg font-bold text-gray-900">
                                ${plan.deductibleIndividual.toLocaleString()}
                              </p>
                              <p className="text-xs text-gray-500">Annual</p>
                            </div>
                            {plan.deductibleFamily > 0 && (
                              <div className="text-center p-3 bg-gray-50 rounded-lg">
                                <p className="text-xs text-gray-600 mb-1">Deductible (Family)</p>
                                <p className="text-lg font-bold text-gray-900">
                                  ${plan.deductibleFamily.toLocaleString()}
                                </p>
                                <p className="text-xs text-gray-500">Annual</p>
                              </div>
                            )}
                            <div className="text-center p-3 bg-gray-50 rounded-lg">
                              <p className="text-xs text-gray-600 mb-1">OOP Max (Individual)</p>
                              <p className="text-lg font-bold text-gray-900">
                                ${plan.oopMaxIndividual.toLocaleString()}
                              </p>
                              <p className="text-xs text-gray-500">Annual</p>
                            </div>
                            {plan.oopMaxFamily > 0 && (
                              <div className="text-center p-3 bg-gray-50 rounded-lg">
                                <p className="text-xs text-gray-600 mb-1">OOP Max (Family)</p>
                                <p className="text-lg font-bold text-gray-900">
                                  ${plan.oopMaxFamily.toLocaleString()}
                                </p>
                                <p className="text-xs text-gray-500">Annual</p>
                              </div>
                            )}
                            {plan.premiumMonthly && (
                              <div className="text-center p-3 bg-gray-50 rounded-lg">
                                <p className="text-xs text-gray-600 mb-1">Premium</p>
                                <p className="text-lg font-bold text-gray-900">
                                  ${plan.premiumMonthly.toLocaleString()}
                                </p>
                                <p className="text-xs text-gray-500">Monthly</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Import Button */}
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => handleImportPlan(plan)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                          >
                            Import This Plan
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Error Display */}
                    {result && !result.success && (
                      <div className="p-4 border-t border-gray-200 bg-red-50">
                        <h4 className="font-medium text-red-800 mb-2">Processing Failed</h4>
                        {result.error && (
                          <p className="text-sm text-red-700">
                            {result.error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              {uploadedFiles.filter(f => f.result?.success).length > 0 && (
                <span>
                  {uploadedFiles.filter(f => f.result?.success).length} plan(s) ready to import
                </span>
              )}
            </p>
            
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors duration-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}