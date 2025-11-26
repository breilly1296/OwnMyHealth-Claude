import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, Dna, Loader2, CheckCircle, AlertCircle, Eye, Download, Filter, Search } from 'lucide-react';
import type { DNAVariant, DNAFileInfo, DNAParsingResult, DNAUploadProgress } from '../types/dna';
import { DNAFileParser, analyzeDNAData, filterVariantsByChromosome, searchVariantsByRsid, exportVariantsToCSV } from '../utils/dnaParser';

interface DNAUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVariantsExtracted: (variants: DNAVariant[], fileInfo: DNAFileInfo) => void;
}

export default function DNAUploadModal({ isOpen, onClose, onVariantsExtracted }: DNAUploadModalProps) {
  const [uploadedFiles, setUploadedFiles] = useState<DNAParsingResult[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<DNAUploadProgress | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedChromosome, setSelectedChromosome] = useState('All');

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
      if (!file.name.toLowerCase().endsWith('.txt') && !file.name.toLowerCase().endsWith('.csv')) {
        continue; // Skip non-supported files
      }

      const parser = new DNAFileParser((progress) => {
        setUploadProgress(progress);
      });

      try {
        const result = await parser.parseFile(file);
        setUploadedFiles(prev => [...prev, result]);
        setUploadProgress(null);
      } catch (error) {
        console.error('DNA parsing failed:', error);
        setUploadProgress(null);
      }
    }
  };

  const handleImportVariants = (result: DNAParsingResult) => {
    onVariantsExtracted(result.variants, result.fileInfo);
    onClose();
    setUploadedFiles([]);
    setSelectedFile(null);
  };

  const getStatusIcon = (result: DNAParsingResult) => {
    if (result.success) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    } else {
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFilteredVariants = (variants: DNAVariant[]) => {
    let filtered = variants;
    
    if (selectedChromosome !== 'All') {
      filtered = filterVariantsByChromosome(filtered, selectedChromosome);
    }
    
    if (searchTerm) {
      filtered = searchVariantsByRsid(filtered, searchTerm);
    }
    
    return filtered.slice(0, 100); // Limit display for performance
  };

  const downloadCSV = (variants: DNAVariant[], fileName: string) => {
    const csv = exportVariantsToCSV(variants);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}_variants.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Dna className="w-6 h-6 text-green-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Upload DNA Data</h2>
              <p className="text-sm text-gray-600">
                Upload 23andMe or AncestryDNA files for genetic variant analysis
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Upload Progress */}
        {uploadProgress && (
          <div className="p-4 bg-blue-50 border-b border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-900">
                {uploadProgress.message}
              </span>
              <span className="text-sm text-blue-700">
                {uploadProgress.progress.toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${uploadProgress.progress}%` }}
              />
            </div>
            {uploadProgress.currentLine && uploadProgress.totalLines && (
              <div className="text-xs text-blue-600 mt-1">
                Processing line {uploadProgress.currentLine.toLocaleString()} of {uploadProgress.totalLines.toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* Upload Area */}
        <div className="p-6">
          <div
            className={`
              relative border-2 border-dashed rounded-lg p-8 transition-colors duration-200
              ${dragActive ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-gray-400'}
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              multiple
              accept=".txt,.csv"
              onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            
            <div className="text-center">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">
                Drop DNA files here or click to upload
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Supports .txt and .csv files from 23andMe and AncestryDNA
              </p>
              
              <div className="flex justify-center space-x-6 text-xs text-gray-500">
                <div className="flex items-center">
                  <Dna className="w-4 h-4 mr-1 text-green-500" />
                  23andMe Raw Data
                </div>
                <div className="flex items-center">
                  <FileText className="w-4 h-4 mr-1 text-blue-500" />
                  AncestryDNA Data
                </div>
                <div className="flex items-center">
                  <CheckCircle className="w-4 h-4 mr-1 text-purple-500" />
                  Auto-Detection
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* File List */}
        {uploadedFiles.length > 0 && (
          <div className="flex-1 overflow-hidden px-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Processed Files ({uploadedFiles.length})
            </h3>
            
            <div className="overflow-y-auto max-h-96 space-y-4">
              {uploadedFiles.map((result, index) => {
                const isExpanded = selectedFile === result.fileInfo.fileName;
                const analysis = result.success ? analyzeDNAData(result.variants) : null;
                
                return (
                  <div key={index} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* File Header */}
                    <div className="flex items-center justify-between p-4 bg-gray-50">
                      <div className="flex items-center space-x-3 flex-1">
                        <div className={`p-2 rounded-lg ${
                          result.fileInfo.source === '23andMe' ? 'bg-green-100 text-green-600' :
                          result.fileInfo.source === 'AncestryDNA' ? 'bg-blue-100 text-blue-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          <Dna className="w-5 h-5" />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {result.fileInfo.fileName}
                          </p>
                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                            <span>{formatFileSize(result.fileInfo.fileSize)}</span>
                            <span className={`px-2 py-1 rounded ${
                              result.fileInfo.source === '23andMe' ? 'bg-green-100 text-green-800' :
                              result.fileInfo.source === 'AncestryDNA' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {result.fileInfo.source}
                            </span>
                            {result.success && (
                              <span className="text-green-600">
                                {result.variants.length.toLocaleString()} variants
                              </span>
                            )}
                            <span className="text-gray-600">
                              {result.processingTime}ms
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        {result.success && (
                          <>
                            <button
                              onClick={() => downloadCSV(result.variants, result.fileInfo.fileName)}
                              className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                            >
                              <Download className="w-4 h-4 mr-1" />
                              Export
                            </button>
                            <button
                              onClick={() => setSelectedFile(isExpanded ? null : result.fileInfo.fileName)}
                              className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              {isExpanded ? 'Hide' : 'Analyze'}
                            </button>
                          </>
                        )}
                        
                        {getStatusIcon(result)}
                      </div>
                    </div>

                    {/* Expanded Analysis */}
                    {isExpanded && result.success && analysis && (
                      <div className="p-4 border-t border-gray-200 bg-white">
                        {/* Summary Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                            <div className="text-2xl font-bold text-green-700">
                              {analysis.totalVariants.toLocaleString()}
                            </div>
                            <div className="text-sm text-green-600">Total Variants</div>
                          </div>
                          
                          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                            <div className="text-2xl font-bold text-blue-700">
                              {Object.keys(analysis.chromosomeDistribution).length}
                            </div>
                            <div className="text-sm text-blue-600">Chromosomes</div>
                          </div>
                          
                          <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                            <div className="text-2xl font-bold text-purple-700">
                              {analysis.qualityMetrics.validVariants.toLocaleString()}
                            </div>
                            <div className="text-sm text-purple-600">Valid Variants</div>
                          </div>
                          
                          <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                            <div className="text-2xl font-bold text-orange-700">
                              {(analysis.qualityMetrics.averageConfidence * 100).toFixed(1)}%
                            </div>
                            <div className="text-sm text-orange-600">Avg Confidence</div>
                          </div>
                        </div>

                        {/* Search and Filter */}
                        <div className="flex flex-col sm:flex-row gap-4 mb-4">
                          <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                              type="text"
                              placeholder="Search by rsID (e.g., rs123456)"
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div className="relative">
                            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <select
                              value={selectedChromosome}
                              onChange={(e) => setSelectedChromosome(e.target.value)}
                              className="pl-10 pr-8 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="All">All Chromosomes</option>
                              {Object.keys(analysis.chromosomeDistribution)
                                .sort((a, b) => {
                                  if (a === 'X') return 1;
                                  if (b === 'X') return -1;
                                  if (a === 'Y') return 1;
                                  if (b === 'Y') return -1;
                                  if (a === 'MT' || a === 'M') return 1;
                                  if (b === 'MT' || b === 'M') return -1;
                                  return parseInt(a) - parseInt(b);
                                })
                                .map(chr => (
                                  <option key={chr} value={chr}>
                                    Chromosome {chr} ({analysis.chromosomeDistribution[chr].toLocaleString()})
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>

                        {/* Variant Preview */}
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                            <h5 className="font-medium text-gray-900">
                              Variant Preview ({getFilteredVariants(result.variants).length} shown)
                            </h5>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">rsID</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chr</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Position</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Genotype</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {getFilteredVariants(result.variants).map((variant, vIndex) => (
                                  <tr key={vIndex} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 text-sm font-mono text-gray-900">{variant.rsid}</td>
                                    <td className="px-4 py-2 text-sm text-gray-600">{variant.chromosome}</td>
                                    <td className="px-4 py-2 text-sm text-gray-600">{variant.position.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-sm font-mono text-gray-900">{variant.genotype}</td>
                                    <td className="px-4 py-2 text-sm text-gray-600">
                                      {variant.confidence ? (variant.confidence * 100).toFixed(1) + '%' : 'N/A'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Chromosome Distribution */}
                        <div className="mt-6">
                          <h5 className="font-medium text-gray-900 mb-3">Chromosome Distribution</h5>
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            {Object.entries(analysis.chromosomeDistribution)
                              .sort(([a], [b]) => {
                                if (a === 'X') return 1;
                                if (b === 'X') return -1;
                                if (a === 'Y') return 1;
                                if (b === 'Y') return -1;
                                if (a === 'MT' || a === 'M') return 1;
                                if (b === 'MT' || b === 'M') return -1;
                                return parseInt(a) - parseInt(b);
                              })
                              .map(([chr, count]) => (
                                <div key={chr} className="text-center p-2 bg-gray-50 rounded border border-gray-200">
                                  <div className="text-sm font-medium text-gray-900">Chr {chr}</div>
                                  <div className="text-xs text-gray-600">{count.toLocaleString()} variants</div>
                                </div>
                              ))}
                          </div>
                        </div>

                        {/* Warnings */}
                        {result.warnings && result.warnings.length > 0 && (
                          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <h5 className="text-sm font-medium text-yellow-800 mb-2">Processing Warnings:</h5>
                            <ul className="text-sm text-yellow-700 space-y-1">
                              {result.warnings.slice(0, 5).map((warning, wIndex) => (
                                <li key={wIndex} className="flex items-start">
                                  <AlertCircle className="w-4 h-4 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" />
                                  {warning}
                                </li>
                              ))}
                              {result.warnings.length > 5 && (
                                <li className="text-yellow-600">
                                  +{result.warnings.length - 5} more warnings
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        {/* Import Button */}
                        <div className="mt-6 flex justify-end">
                          <button
                            onClick={() => handleImportVariants(result)}
                            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200 flex items-center"
                          >
                            <Dna className="w-4 h-4 mr-2" />
                            Import Genetic Data
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Error Display */}
                    {!result.success && (
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
              {uploadedFiles.filter(f => f.success).length > 0 && (
                <span>
                  {uploadedFiles.filter(f => f.success).length} file(s) successfully processed
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