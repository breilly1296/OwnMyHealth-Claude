/**
 * InsuranceSBCUpload Component
 *
 * A modal for uploading and processing Summary of Benefits and Coverage (SBC) documents.
 * Extracts insurance plan details from PDF documents using the sbcParser utility.
 *
 * Features:
 * - Drag-and-drop or click-to-upload interface for PDF files
 * - Multi-file upload support with individual processing status
 * - Real-time processing indicators (loading spinner, success checkmark, error alert)
 * - Expandable preview for each successfully processed plan showing:
 *   - Plan information (name, insurer, type, effective date)
 *   - Key benefits coverage (specialist, imaging, ER, preventive)
 *   - Cost summary grid (deductible, premium, OOP max)
 *   - Extraction warnings if any fields couldn't be parsed
 * - Import button to add extracted plan to user's insurance data
 *
 * Processing shows confidence score indicating extraction accuracy.
 *
 * @module components/insurance/InsuranceSBCUpload
 */

import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, Shield, DollarSign, Loader2, CheckCircle, AlertCircle, Eye } from 'lucide-react';
import type { InsurancePlan, SBCProcessingResult } from '../../types';
import { processSBCFile, getKeyPlanFeatures, formatCoverageDisplay } from '../../utils/insurance/sbcParser';

interface InsuranceSBCUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanExtracted: (plan: InsurancePlan) => void;
}

export default function InsuranceSBCUpload({ isOpen, onClose, onPlanExtracted }: InsuranceSBCUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ file: File; result?: SBCProcessingResult }>>([]);
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
        const result = await processSBCFile(file);
        
        setUploadedFiles(prev => prev.map(entry => 
          entry.file.name === file.name 
            ? { ...entry, result }
            : entry
        ));

      } catch {
        setUploadedFiles(prev => prev.map(entry =>
          entry.file.name === file.name
            ? {
                ...entry,
                result: {
                  success: false,
                  errors: ['Failed to process file'],
                  processingTime: 0,
                  confidence: 0
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

  const handleImportPlan = (plan: InsurancePlan) => {
    onPlanExtracted(plan);
    onClose();
    setUploadedFiles([]);
    setSelectedPlan(null);
  };

  const getStatusIcon = (result?: SBCProcessingResult, isProcessing?: boolean) => {
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
                const plan = result?.extractedPlan;
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
                                {plan.benefits.length} benefits found
                              </span>
                            )}
                            {result && result.confidence && (
                              <span className="text-blue-600">
                                {Math.round(result.confidence * 100)}% confidence
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
                              <div className="flex justify-between">
                                <span className="text-gray-600">Effective Date:</span>
                                <span className="font-medium">{new Date(plan.effectiveDate).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>

                          {/* Key Benefits */}
                          <div>
                            <h4 className="font-medium text-gray-900 mb-3">Key Benefits</h4>
                            <div className="space-y-2 text-sm">
                              {(() => {
                                const keyFeatures = getKeyPlanFeatures(plan);
                                return (
                                  <>
                                    {keyFeatures.specialistCoverage && (
                                      <div className="flex justify-between">
                                        <span className="text-gray-600">Specialist Visits:</span>
                                        <span className="font-medium">
                                          {formatCoverageDisplay(keyFeatures.specialistCoverage.inNetworkCoverage)}
                                        </span>
                                      </div>
                                    )}
                                    {keyFeatures.imagingCoverage.length > 0 && (
                                      <div className="flex justify-between">
                                        <span className="text-gray-600">Imaging:</span>
                                        <span className="font-medium">
                                          {formatCoverageDisplay(keyFeatures.imagingCoverage[0].inNetworkCoverage)}
                                        </span>
                                      </div>
                                    )}
                                    {keyFeatures.emergencyCoverage && (
                                      <div className="flex justify-between">
                                        <span className="text-gray-600">Emergency Room:</span>
                                        <span className="font-medium">
                                          {formatCoverageDisplay(keyFeatures.emergencyCoverage.inNetworkCoverage)}
                                        </span>
                                      </div>
                                    )}
                                    {keyFeatures.preventiveCoverage && (
                                      <div className="flex justify-between">
                                        <span className="text-gray-600">Preventive Care:</span>
                                        <span className="font-medium">
                                          {formatCoverageDisplay(keyFeatures.preventiveCoverage.inNetworkCoverage)}
                                        </span>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>

                        {/* Costs Summary */}
                        {plan.costs.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <h4 className="font-medium text-gray-900 mb-3">Cost Summary</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              {plan.costs.map((cost, costIndex) => (
                                <div key={costIndex} className="text-center p-3 bg-gray-50 rounded-lg">
                                  <p className="text-xs text-gray-600 mb-1">{cost.type}</p>
                                  <p className="text-lg font-bold text-gray-900">
                                    ${cost.amount.toLocaleString()}
                                  </p>
                                  {cost.frequency && (
                                    <p className="text-xs text-gray-500">{cost.frequency}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Warnings */}
                        {result.warnings && result.warnings.length > 0 && (
                          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <h5 className="text-sm font-medium text-yellow-800 mb-2">Extraction Warnings:</h5>
                            <ul className="text-sm text-yellow-700 space-y-1">
                              {result.warnings.map((warning, wIndex) => (
                                <li key={wIndex} className="flex items-start">
                                  <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                  {warning}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

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
                        {result.errors && (
                          <ul className="text-sm text-red-700 space-y-1">
                            {result.errors.map((error, errorIndex) => (
                              <li key={errorIndex} className="flex items-start">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                {error}
                              </li>
                            ))}
                          </ul>
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