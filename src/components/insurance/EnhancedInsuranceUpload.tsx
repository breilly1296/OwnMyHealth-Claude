/**
 * EnhancedInsuranceUpload Component
 *
 * An advanced document upload modal with AI-powered NLP extraction for insurance documents.
 * Supports multiple document types including SBCs, EOBs, and plan documents.
 *
 * Features:
 * - Drag-and-drop or click upload for PDF and image files
 * - AI-powered document type detection (SBC, EOB, Plan_Document, Benefits_Summary)
 * - Intelligent data extraction with confidence scoring
 * - Expandable analysis view for each processed document showing:
 *   - Plan information (name, insurer, type, dates)
 *   - Cost information (premiums, deductibles, copays)
 *   - AI-extracted key terms with searchable/filterable interface
 *   - Benefits summary with coverage status
 *   - Extraction warnings for uncertain fields
 * - Import functionality to convert extracted data to InsurancePlan format
 *
 * Uses the documentParser utility which simulates NLP-based extraction
 * with term importance classification (high/medium/low) and category tagging.
 *
 * @module components/insurance/EnhancedInsuranceUpload
 */

import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, Shield, DollarSign, Loader2, CheckCircle, AlertCircle, Eye, Brain, Tag, Search } from 'lucide-react';
import type { InsurancePlan, InsuranceBenefit, InsuranceCost, InsuranceLimitation } from '../../types';
import { parseInsuranceDocument, type DocumentParsingResult, type ExtractedInsuranceData, type ExtractedTerm } from '../../utils/documents/documentParser';

// Helper functions to map extracted data to proper types
function mapPlanType(planType?: string): InsurancePlan['planType'] {
  if (!planType) return 'Other';
  const upper = planType.toUpperCase();
  if (upper.includes('HMO')) return 'HMO';
  if (upper.includes('PPO')) return 'PPO';
  if (upper.includes('EPO')) return 'EPO';
  if (upper.includes('POS')) return 'POS';
  if (upper.includes('HDHP') || upper.includes('HIGH DEDUCTIBLE')) return 'HDHP';
  return 'Other';
}

function mapBenefitCategory(category: string): InsuranceBenefit['category'] {
  const categoryMap: Record<string, InsuranceBenefit['category']> = {
    'primary_care': 'Primary Care',
    'specialist_care': 'Specialist Care',
    'emergency_care': 'Emergency Care',
    'urgent_care': 'Urgent Care',
    'preventive_care': 'Preventive Care',
    'diagnostic_tests': 'Diagnostic Tests',
    'imaging': 'Imaging',
    'lab_tests': 'Lab Tests',
    'prescription_drugs': 'Prescription Drugs',
    'mental_health': 'Mental Health',
    'maternity': 'Maternity',
    'surgery': 'Surgery',
    'hospital_stay': 'Hospital Stay',
    'rehabilitation': 'Rehabilitation'
  };
  return categoryMap[category.toLowerCase().replace(/ /g, '_')] || 'Other';
}

function mapCostType(type: string): InsuranceCost['type'] {
  const typeMap: Record<string, InsuranceCost['type']> = {
    'premium': 'Premium',
    'deductible': 'Deductible',
    'out_of_pocket_max': 'Out-of-Pocket Maximum',
    'out-of-pocket maximum': 'Out-of-Pocket Maximum',
    'copay': 'Copay',
    'coinsurance': 'Coinsurance'
  };
  return typeMap[type.toLowerCase()] || 'Copay';
}

function mapFrequency(frequency?: string): InsuranceCost['frequency'] {
  if (!frequency) return 'Annual';
  const lower = frequency.toLowerCase();
  if (lower.includes('monthly')) return 'Monthly';
  if (lower.includes('visit')) return 'Per Visit';
  if (lower.includes('service')) return 'Per Service';
  return 'Annual';
}

function mapAppliesTo(category: string): InsuranceCost['appliesTo'] {
  const lower = category.toLowerCase();
  if (lower.includes('family')) return 'Family';
  if (lower.includes('out') && lower.includes('network')) return 'Out-of-Network';
  if (lower.includes('in') && lower.includes('network')) return 'In-Network';
  return 'Individual';
}

function mapLimitType(type: string): InsuranceLimitation['limitType'] {
  const lower = type.toLowerCase().replace(/_/g, ' ');
  if (lower.includes('lifetime')) return 'Lifetime';
  if (lower.includes('per visit') || lower.includes('per_visit')) return 'Per Visit';
  if (lower.includes('per service') || lower.includes('per_service')) return 'Per Service';
  return 'Annual';
}

interface EnhancedInsuranceUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanExtracted: (plan: InsurancePlan) => void;
}

interface ProcessedFile {
  file: File;
  result?: DocumentParsingResult;
  isProcessing: boolean;
}

export default function EnhancedInsuranceUpload({ isOpen, onClose, onPlanExtracted }: EnhancedInsuranceUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<ProcessedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

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
      if (!file.type.includes('pdf') && !file.type.includes('image')) {
        continue; // Skip non-supported files
      }

      const processedFile: ProcessedFile = {
        file,
        isProcessing: true
      };

      setUploadedFiles(prev => [...prev, processedFile]);

      try {
        const result = await parseInsuranceDocument(file);
        
        setUploadedFiles(prev => prev.map(pf => 
          pf.file.name === file.name 
            ? { ...pf, result, isProcessing: false }
            : pf
        ));

      } catch {
        setUploadedFiles(prev => prev.map(pf =>
          pf.file.name === file.name
            ? {
                ...pf,
                isProcessing: false,
                result: {
                  success: false,
                  documentType: 'Unknown',
                  extractedData: {},
                  confidence: 0,
                  processingTime: 0,
                  errors: ['Failed to process file']
                }
              }
            : pf
        ));
      }
    }
  };

  const handleImportPlan = (extractedData: ExtractedInsuranceData) => {
    // Convert extracted data to InsurancePlan format
    const plan: InsurancePlan = {
      id: crypto.randomUUID(),
      planName: extractedData.planInformation?.planName || 'Extracted Plan',
      insurerName: extractedData.planInformation?.insurerName || 'Unknown Insurer',
      planType: mapPlanType(extractedData.planInformation?.planType),
      effectiveDate: extractedData.planInformation?.effectiveDate || new Date().toISOString().split('T')[0],
      uploadDate: new Date().toISOString(),
      sourceFile: 'Enhanced Parser',
      extractionConfidence: 0.9,
      benefits: extractedData.benefits?.map(benefit => ({
        id: crypto.randomUUID(),
        category: mapBenefitCategory(benefit.category),
        serviceName: benefit.serviceName,
        inNetworkCoverage: {
          covered: benefit.inNetworkCoverage.covered,
          copay: benefit.inNetworkCoverage.copay,
          coinsurance: benefit.inNetworkCoverage.coinsurance,
          deductible: benefit.inNetworkCoverage.deductibleApplies ? 0 : undefined,
          coveragePercentage: benefit.inNetworkCoverage.coveragePercentage
        },
        outOfNetworkCoverage: benefit.outOfNetworkCoverage ? {
          covered: benefit.outOfNetworkCoverage.covered,
          copay: benefit.outOfNetworkCoverage.copay,
          coinsurance: benefit.outOfNetworkCoverage.coinsurance,
          coveragePercentage: benefit.outOfNetworkCoverage.coveragePercentage
        } : undefined,
        description: benefit.rawText,
        priorAuthRequired: benefit.priorAuthRequired,
        referralRequired: benefit.referralRequired
      })) || [],
      costs: extractedData.costs?.map(cost => ({
        id: crypto.randomUUID(),
        type: mapCostType(cost.type),
        amount: cost.amount || 0,
        frequency: mapFrequency(cost.frequency),
        description: cost.description,
        appliesTo: mapAppliesTo(cost.category)
      })) || [],
      limitations: extractedData.limitations?.map(limitation => ({
        id: crypto.randomUUID(),
        category: limitation.service,
        description: limitation.description,
        limitType: mapLimitType(limitation.type),
        limitValue: limitation.value
      })) || [],
      network: {
        providerCount: extractedData.network?.providerCount,
        hospitalCount: extractedData.network?.hospitalCount,
        geographicCoverage: extractedData.network?.geographicCoverage || ['Unknown'],
        networkName: extractedData.network?.providerNetworkName
      }
    };

    onPlanExtracted(plan);
    onClose();
    setUploadedFiles([]);
    setSelectedFile(null);
  };

  const getStatusIcon = (processedFile: ProcessedFile) => {
    if (processedFile.isProcessing) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    }
    if (processedFile.result?.success) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    if (processedFile.result && !processedFile.result.success) {
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

  const getDocumentTypeColor = (type: string) => {
    switch (type) {
      case 'SBC': return 'bg-blue-100 text-blue-800';
      case 'EOB': return 'bg-green-100 text-green-800';
      case 'Plan_Document': return 'bg-purple-100 text-purple-800';
      case 'Benefits_Summary': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredKeyTerms = (terms: ExtractedTerm[]) => {
    if (!terms) return [];
    
    let filtered = terms;
    
    if (selectedCategory !== 'All') {
      filtered = filtered.filter(term => term.category === selectedCategory.toLowerCase());
    }
    
    if (searchTerm) {
      filtered = filtered.filter(term => 
        term.term.toLowerCase().includes(searchTerm.toLowerCase()) ||
        term.context.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    return filtered;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Enhanced Insurance Document Parser</h2>
            <p className="text-sm text-gray-600 mt-1">
              Upload SBCs, EOBs, and plan documents for intelligent data extraction with NLP analysis
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
              accept=".pdf,.png,.jpg,.jpeg,.tiff"
              onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            
            <div className="text-center">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">
                Drop insurance documents here or click to upload
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Supports PDF and image files up to 10MB
              </p>
              
              <div className="flex justify-center space-x-6 text-xs text-gray-500">
                <div className="flex items-center">
                  <Shield className="w-4 h-4 mr-1 text-blue-500" />
                  SBC Documents
                </div>
                <div className="flex items-center">
                  <FileText className="w-4 h-4 mr-1 text-green-500" />
                  EOB Reports
                </div>
                <div className="flex items-center">
                  <DollarSign className="w-4 h-4 mr-1 text-purple-500" />
                  Plan Documents
                </div>
                <div className="flex items-center">
                  <Brain className="w-4 h-4 mr-1 text-orange-500" />
                  AI-Powered Extraction
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* File List */}
        {uploadedFiles.length > 0 && (
          <div className="flex-1 overflow-hidden px-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Processed Documents ({uploadedFiles.length})
            </h3>
            
            <div className="overflow-y-auto max-h-96 space-y-4">
              {uploadedFiles.map((processedFile, index) => {
                const isExpanded = selectedFile === processedFile.file.name;
                const result = processedFile.result;
                
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
                            {processedFile.file.name}
                          </p>
                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                            <span>{formatFileSize(processedFile.file.size)}</span>
                            {result && (
                              <>
                                <span className={`px-2 py-1 rounded ${getDocumentTypeColor(result.documentType)}`}>
                                  {result.documentType.replace('_', ' ')}
                                </span>
                                <span className="text-blue-600">
                                  {Math.round(result.confidence * 100)}% confidence
                                </span>
                                <span className="text-gray-600">
                                  {result.processingTime}ms
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        {result && result.success && (
                          <button
                            onClick={() => setSelectedFile(isExpanded ? null : processedFile.file.name)}
                            className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            {isExpanded ? 'Hide' : 'Analyze'}
                          </button>
                        )}
                        
                        {getStatusIcon(processedFile)}
                      </div>
                    </div>

                    {/* Expanded Analysis */}
                    {isExpanded && result?.success && (
                      <div className="p-4 border-t border-gray-200 bg-white">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {/* Plan Information */}
                          {result.extractedData.planInformation && (
                            <div>
                              <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                                <Shield className="w-4 h-4 mr-2 text-blue-600" />
                                Plan Information
                              </h4>
                              <div className="space-y-2 text-sm">
                                {Object.entries(result.extractedData.planInformation).map(([key, value]) => (
                                  value && (
                                    <div key={key} className="flex justify-between">
                                      <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span>
                                      <span className="font-medium">{value}</span>
                                    </div>
                                  )
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Extracted Costs */}
                          {result.extractedData.costs && result.extractedData.costs.length > 0 && (
                            <div>
                              <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                                <DollarSign className="w-4 h-4 mr-2 text-green-600" />
                                Cost Information
                              </h4>
                              <div className="space-y-2">
                                {result.extractedData.costs.slice(0, 4).map((cost, costIndex) => (
                                  <div key={costIndex} className="flex justify-between items-center text-sm">
                                    <span className="text-gray-600 capitalize">{cost.type.replace('_', ' ')}</span>
                                    <div className="text-right">
                                      <span className="font-medium">
                                        {cost.amount ? `$${cost.amount.toLocaleString()}` : `${cost.percentage}%`}
                                      </span>
                                      <div className="text-xs text-gray-500">{cost.category}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Key Terms Analysis */}
                        {result.extractedData.keyTerms && result.extractedData.keyTerms.length > 0 && (
                          <div className="mt-6">
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="font-medium text-gray-900 flex items-center">
                                <Brain className="w-4 h-4 mr-2 text-purple-600" />
                                AI-Extracted Key Terms ({result.extractedData.keyTerms.length})
                              </h4>
                              
                              <div className="flex space-x-2">
                                <div className="relative">
                                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                  <input
                                    type="text"
                                    placeholder="Search terms..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 pr-4 py-1 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                  />
                                </div>
                                <select
                                  value={selectedCategory}
                                  onChange={(e) => setSelectedCategory(e.target.value)}
                                  className="text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                >
                                  <option value="All">All Categories</option>
                                  <option value="cost">Cost</option>
                                  <option value="coverage">Coverage</option>
                                  <option value="network">Network</option>
                                  <option value="procedure">Procedure</option>
                                </select>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-64 overflow-y-auto">
                              {filteredKeyTerms(result.extractedData.keyTerms).map((term, termIndex) => (
                                <div key={termIndex} className="border border-gray-200 rounded-lg p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <h5 className="font-medium text-gray-900 text-sm">{term.term}</h5>
                                    <div className="flex items-center space-x-2">
                                      <span className={`px-2 py-1 rounded text-xs ${
                                        term.importance === 'high' ? 'bg-red-100 text-red-800' :
                                        term.importance === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-green-100 text-green-800'
                                      }`}>
                                        {term.importance}
                                      </span>
                                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                        {term.category}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-600 mb-2">{term.definition}</p>
                                  <p className="text-xs text-gray-500 italic">"{term.context.substring(0, 100)}..."</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Benefits Summary */}
                        {result.extractedData.benefits && result.extractedData.benefits.length > 0 && (
                          <div className="mt-6">
                            <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                              <Tag className="w-4 h-4 mr-2 text-indigo-600" />
                              Extracted Benefits ({result.extractedData.benefits.length})
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto">
                              {result.extractedData.benefits.slice(0, 8).map((benefit, benefitIndex) => (
                                <div key={benefitIndex} className="border border-gray-200 rounded p-3">
                                  <div className="flex justify-between items-start mb-2">
                                    <h6 className="text-sm font-medium text-gray-900">{benefit.serviceName}</h6>
                                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                                      {benefit.category}
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    {benefit.inNetworkCoverage.covered ? (
                                      <div className="flex items-center text-green-600">
                                        <CheckCircle className="w-3 h-3 mr-1" />
                                        Covered
                                        {benefit.inNetworkCoverage.copay && ` - $${benefit.inNetworkCoverage.copay} copay`}
                                        {benefit.inNetworkCoverage.coinsurance && ` - ${benefit.inNetworkCoverage.coinsurance}% coinsurance`}
                                      </div>
                                    ) : (
                                      <div className="flex items-center text-red-600">
                                        <X className="w-3 h-3 mr-1" />
                                        Not Covered
                                      </div>
                                    )}
                                  </div>
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
                                  <AlertCircle className="w-4 h-4 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" />
                                  {warning}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Import Button */}
                        <div className="mt-6 flex justify-end">
                          <button
                            onClick={() => handleImportPlan(result.extractedData)}
                            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200 flex items-center"
                          >
                            <Shield className="w-4 h-4 mr-2" />
                            Import Insurance Plan
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
                                <AlertCircle className="w-4 h-4 text-red-600 mr-2 mt-0.5 flex-shrink-0" />
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
                  {uploadedFiles.filter(f => f.result?.success).length} document(s) successfully processed
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