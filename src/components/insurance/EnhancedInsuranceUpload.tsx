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
 * Uses the backend Claude Sonnet API for intelligent document extraction
 * with term importance classification (high/medium/low) and category tagging.
 *
 * @module components/insurance/EnhancedInsuranceUpload
 */

import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, Shield, DollarSign, Loader2, CheckCircle, AlertCircle, Eye, Brain, Tag, Search } from 'lucide-react';
import type { InsurancePlan, InsuranceBenefit, InsuranceCost, InsuranceLimitation } from '../../types';
import { insuranceApi } from '../../services/api/insurance';
import { logger } from '../../utils/logger';

const uploadLogger = logger.createLogger('InsuranceUpload');

// Legacy types kept local — these describe the shape this component builds
// from `insuranceApi.uploadSBC()` responses, not the richer parser output in
// utils/documents/documentParser.ts. Fields are marked optional where the
// producer may leave them unset.
interface ExtractedTerm {
  term: string;
  // Either `value` (producer-populated today) or `definition`/`context`
  // (canonical parser shape, read by the UI). Both optional so the type
  // covers both producers without forcing a migration.
  value?: string;
  definition?: string;
  context?: string;
  importance: 'high' | 'medium' | 'low';
  category: string;
}

interface ExtractedInsuranceData {
  planInformation?: {
    planName?: string;
    insurerName?: string;
    planType?: string;
    effectiveDate?: string;
  };
  costs?: Array<{
    type: string;
    amount: number;
    frequency?: string;
    category: string;
    description?: string;
    percentage?: number;
  }>;
  benefits?: Array<{
    serviceName: string;
    category: string;
    inNetworkCoverage: {
      covered: boolean;
      copay?: number;
      coinsurance?: number;
      deductibleApplies?: boolean;
      coveragePercentage?: number;
    };
    outOfNetworkCoverage?: {
      covered: boolean;
      copay?: number;
      coinsurance?: number;
      coveragePercentage?: number;
    };
    rawText?: string;
    priorAuthRequired?: boolean;
    referralRequired?: boolean;
  }>;
  limitations?: Array<{
    service: string;
    description: string;
    type: string;
    value?: number;
  }>;
  network?: {
    providerCount?: number;
    hospitalCount?: number;
    geographicCoverage?: string[];
    providerNetworkName?: string;
  };
  keyTerms?: ExtractedTerm[];
  extractedTerms?: ExtractedTerm[];
}

interface DocumentParsingResult {
  success: boolean;
  documentType: string;
  extractedData: ExtractedInsuranceData;
  confidence: number;
  processingTime: number;
  errors?: string[];
  warnings?: string[];
}

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
  /** Stable per-upload id. Used to match async results + as the React key,
   *  so two files with the same name don't collide (#27). */
  id: string;
  file: File;
  result?: DocumentParsingResult;
  isProcessing: boolean;
  /** The plan id assigned by the server when uploadSBC persisted this plan.
   *  Threaded into the import so we adopt the saved plan instead of re-creating it. */
  serverPlanId?: string;
}

export default function EnhancedInsuranceUpload({ isOpen, onClose, onPlanExtracted }: EnhancedInsuranceUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<ProcessedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
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
      if (!file.type.includes('pdf')) {
        continue; // Only PDF files supported for backend extraction
      }

      const processedFile: ProcessedFile = {
        id: crypto.randomUUID(),
        file,
        isProcessing: true
      };

      setUploadedFiles(prev => [...prev, processedFile]);

      try {
        // Upload to backend - Claude Sonnet extracts the data
        const planData = await insuranceApi.uploadSBC(file);

        // Convert backend response to DocumentParsingResult format
        const result: DocumentParsingResult = {
          success: true,
          documentType: 'SBC',
          confidence: planData.sbcExtractionConfidence ?? 0.85,
          processingTime: 0,
          extractedData: {
            planInformation: {
              planName: planData.planName,
              insurerName: planData.insurerName,
              planType: planData.planType,
              effectiveDate: planData.effectiveDate,
            },
            costs: [
              { type: 'Deductible', amount: planData.deductibleIndividual, category: 'Individual', frequency: 'Annual' },
              { type: 'Out-of-Pocket Maximum', amount: planData.oopMaxIndividual, category: 'Individual', frequency: 'Annual' },
              ...(planData.premiumMonthly ? [{ type: 'Premium', amount: planData.premiumMonthly, category: 'Individual', frequency: 'Monthly' }] : []),
            ],
            benefits: [],
            extractedTerms: [
              ...(planData.copayPrimaryCare !== undefined ? [{ term: 'Primary Care Copay', value: planData.copayPrimaryCare ? `$${planData.copayPrimaryCare}` : '--', importance: 'high' as const, category: 'Copays' }] : []),
              ...(planData.copaySpecialist !== undefined ? [{ term: 'Specialist Copay', value: planData.copaySpecialist ? `$${planData.copaySpecialist}` : '--', importance: 'high' as const, category: 'Copays' }] : []),
              ...(planData.copayEmergency !== undefined ? [{ term: 'Emergency Copay', value: planData.copayEmergency ? `$${planData.copayEmergency}` : '--', importance: 'high' as const, category: 'Copays' }] : []),
              ...(planData.coinsuranceRate !== undefined ? [{ term: 'Coinsurance Rate', value: `${planData.coinsuranceRate}%`, importance: 'medium' as const, category: 'Coverage' }] : []),
            ],
          },
        };

        setUploadedFiles(prev => prev.map(pf =>
          pf.id === processedFile.id
            ? { ...pf, result, serverPlanId: planData.id, isProcessing: false }
            : pf
        ));

      } catch (err) {
        // Handle both Error instances and ApiError objects
        let errorMessage = 'Failed to process file';
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (err && typeof err === 'object' && 'message' in err) {
          errorMessage = (err as { message: string }).message;
        }
        uploadLogger.error('SBC upload failed', {
          error: err instanceof Error ? err.message : errorMessage,
          filename: file.name,
        });
        setUploadedFiles(prev => prev.map(pf =>
          pf.id === processedFile.id
            ? {
                ...pf,
                isProcessing: false,
                result: {
                  success: false,
                  documentType: 'Unknown',
                  extractedData: {},
                  confidence: 0,
                  processingTime: 0,
                  errors: [errorMessage]
                }
              }
            : pf
        ));
      }
    }
  };

  const handleImportPlan = (extractedData: ExtractedInsuranceData, serverPlanId?: string) => {
    // Convert extracted data to InsurancePlan format
    const plan: InsurancePlan = {
      // uploadSBC ALREADY persisted this plan server-side (with its full extracted
      // benefits/coverage) and returned its id; thread that id through so
      // handleInsurancePlanExtracted adopts the existing record instead of calling
      // createPlan again — the re-create produced a DUPLICATE plan and dropped the
      // benefits. Fall back to an empty id for any path without a server id
      // (manual/legacy), which still routes through createPlan. A truthy id is also
      // required so a same-session delete targets the real server row (FB-8).
      id: serverPlanId ?? '',
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
        description: benefit.rawText ?? '',
        priorAuthRequired: benefit.priorAuthRequired,
        referralRequired: benefit.referralRequired
      })) || [],
      costs: extractedData.costs?.map(cost => ({
        id: crypto.randomUUID(),
        type: mapCostType(cost.type),
        amount: cost.amount || 0,
        frequency: mapFrequency(cost.frequency),
        description: cost.description ?? '',
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
    setSelectedFileId(null);
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
      // selectedCategory is one of the term categories themselves (dynamic
      // options), so an exact match is correct — the old toLowerCase() compare
      // never matched the capitalized producer categories (#26).
      filtered = filtered.filter(term => term.category === selectedCategory);
    }
    
    if (searchTerm) {
      const needle = searchTerm.toLowerCase();
      filtered = filtered.filter(term =>
        term.term.toLowerCase().includes(needle) ||
        (term.context?.toLowerCase().includes(needle) ?? false)
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
              {uploadedFiles.map((processedFile) => {
                const isExpanded = selectedFileId === processedFile.id;
                const result = processedFile.result;
                // Prefer keyTerms (canonical parser shape) but fall back to
                // extractedTerms (the SBC producer's field) so the panel renders (#26).
                const keyTermsList =
                  result?.extractedData.keyTerms ?? result?.extractedData.extractedTerms ?? [];

                return (
                  <div key={processedFile.id} className="border border-gray-200 rounded-lg overflow-hidden">
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
                            onClick={() => setSelectedFileId(isExpanded ? null : processedFile.id)}
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
                        {keyTermsList.length > 0 && (
                          <div className="mt-6">
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="font-medium text-gray-900 flex items-center">
                                <Brain className="w-4 h-4 mr-2 text-purple-600" />
                                AI-Extracted Key Terms ({keyTermsList.length})
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
                                  {/* Options derived from the actual term categories so the
                                      filter always matches what the producer emits (#26). */}
                                  <option value="All">All Categories</option>
                                  {Array.from(new Set(keyTermsList.map((t) => t.category))).map((cat) => (
                                    <option key={cat} value={cat}>{cat}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-64 overflow-y-auto">
                              {filteredKeyTerms(keyTermsList).map((term, termIndex) => (
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
                                  <p className="text-xs text-gray-600 mb-2">{term.definition ?? term.value}</p>
                                  {term.context && (
                                    <p className="text-xs text-gray-500 italic">"{term.context.substring(0, 100)}..."</p>
                                  )}
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
                                        {benefit.inNetworkCoverage.copay !== undefined && (benefit.inNetworkCoverage.copay ? ` - $${benefit.inNetworkCoverage.copay} copay` : ' - --')}
                                        {benefit.inNetworkCoverage.coinsurance !== undefined && (benefit.inNetworkCoverage.coinsurance ? ` - ${benefit.inNetworkCoverage.coinsurance}% coinsurance` : ' - --')}
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
                            onClick={() => handleImportPlan(result.extractedData, processedFile.serverPlanId)}
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