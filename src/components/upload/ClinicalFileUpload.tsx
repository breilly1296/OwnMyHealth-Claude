import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, Activity, Dna, Heart, Loader2, CheckCircle, AlertCircle, Eye } from 'lucide-react';
import type { ClinicalFile, ProcessingResult, Biomarker } from '../../types';
import { processClinicalFile } from '../../utils/documents/fileProcessing';

interface ClinicalFileUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onExtract: (biomarkers: Partial<Biomarker>[]) => void;
}

const FILE_TYPE_ICONS = {
  'DEXA': Activity,
  '23andMe': Dna,
  'EKG': Heart,
  'Lab Report': FileText,
  'Other': FileText
};

const FILE_TYPE_COLORS = {
  'DEXA': 'text-purple-600 bg-purple-100',
  '23andMe': 'text-green-600 bg-green-100',
  'EKG': 'text-red-600 bg-red-100',
  'Lab Report': 'text-blue-600 bg-blue-100',
  'Other': 'text-gray-600 bg-gray-100'
};

export default function ClinicalFileUpload({ isOpen, onClose, onExtract }: ClinicalFileUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<ClinicalFile[]>([]);
  const [processingResults, setProcessingResults] = useState<Map<string, ProcessingResult>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFiles = async (files: File[]) => {
    for (const file of files) {
      const clinicalFile: ClinicalFile = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^/.]+$/, ""),
        type: 'Other',
        uploadDate: new Date().toISOString(),
        processingStatus: 'processing',
        originalFileName: file.name,
        fileSize: file.size
      };

      setUploadedFiles(prev => [...prev, clinicalFile]);

      try {
        const result = await processClinicalFile(file);
        
        setProcessingResults(prev => new Map(prev.set(clinicalFile.id, result)));
        
        setUploadedFiles(prev => prev.map(f => 
          f.id === clinicalFile.id 
            ? { 
                ...f, 
                processingStatus: result.success ? 'completed' : 'failed',
                type: result.extractedBiomarkers.length > 0 ? detectFileTypeFromBiomarkers(result.extractedBiomarkers) : 'Other'
              }
            : f
        ));

      } catch {
        setUploadedFiles(prev => prev.map(f =>
          f.id === clinicalFile.id
            ? { ...f, processingStatus: 'failed' }
            : f
        ));
      }
    }
  };

  const detectFileTypeFromBiomarkers = (biomarkers: Partial<Biomarker>[]): ClinicalFile['type'] => {
    const categories = biomarkers.map(b => b.category);
    
    if (categories.includes('Body Composition')) return 'DEXA';
    if (categories.includes('EKG')) return 'EKG';
    if (biomarkers.some(b => b.name?.includes('genetic') || b.name?.includes('SNP'))) return '23andMe';
    return 'Lab Report';
  };

  const handleExtractSelected = () => {
    const selectedResults = Array.from(processingResults.entries())
      .filter(([fileId]) => uploadedFiles.find(f => f.id === fileId && f.processingStatus === 'completed'))
      .flatMap(([, result]) => result.extractedBiomarkers);

    if (selectedResults.length > 0) {
      onExtract(selectedResults);
      onClose();
      setUploadedFiles([]);
      setProcessingResults(new Map());
    }
  };

  const getStatusIcon = (status: ClinicalFile['processingStatus']) => {
    switch (status) {
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Upload Clinical Files</h2>
            <p className="text-sm text-gray-600 mt-1">
              Upload DEXA scans, EKG reports, 23andMe data, and lab results for automatic data extraction
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Upload Area */}
        <div
          className={`
            relative border-2 border-dashed rounded-lg p-8 mb-6 transition-colors duration-200
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
              Drop files here or click to upload
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Supports PDF, PNG, JPG, JPEG, TIFF files up to 10MB
            </p>
            
            <div className="flex justify-center space-x-6 text-xs text-gray-500">
              <div className="flex items-center">
                <Activity className="w-4 h-4 mr-1 text-purple-500" />
                DEXA Scans
              </div>
              <div className="flex items-center">
                <Heart className="w-4 h-4 mr-1 text-red-500" />
                EKG Reports
              </div>
              <div className="flex items-center">
                <Dna className="w-4 h-4 mr-1 text-green-500" />
                23andMe Data
              </div>
              <div className="flex items-center">
                <FileText className="w-4 h-4 mr-1 text-blue-500" />
                Lab Reports
              </div>
            </div>
          </div>
        </div>

        {/* File List */}
        {uploadedFiles.length > 0 && (
          <div className="flex-1 overflow-hidden">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Uploaded Files ({uploadedFiles.length})
            </h3>
            
            <div className="overflow-y-auto max-h-64 space-y-3">
              {uploadedFiles.map((file) => {
                const Icon = FILE_TYPE_ICONS[file.type];
                const result = processingResults.get(file.id);
                
                return (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors duration-150"
                  >
                    <div className="flex items-center space-x-3 flex-1">
                      <div className={`p-2 rounded-lg ${FILE_TYPE_COLORS[file.type]}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {file.name}
                        </p>
                        <div className="flex items-center space-x-4 text-xs text-gray-500">
                          <span>{file.type}</span>
                          <span>{formatFileSize(file.fileSize)}</span>
                          {result && result.success && (
                            <span className="text-green-600">
                              {result.extractedBiomarkers.length} biomarkers found
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      {result && result.success && result.extractedBiomarkers.length > 0 && (
                        <button
                          onClick={() => setSelectedFile(selectedFile === file.id ? null : file.id)}
                          className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          Preview
                        </button>
                      )}
                      
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(file.processingStatus)}
                        {result && result.confidence > 0 && (
                          <span className="text-xs text-gray-500">
                            {Math.round(result.confidence * 100)}% confidence
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Preview Panel */}
            {selectedFile && processingResults.get(selectedFile) && (
              <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h4 className="font-medium text-blue-900 mb-3">Extracted Biomarkers Preview</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-32 overflow-y-auto">
                  {processingResults.get(selectedFile)!.extractedBiomarkers.map((biomarker, index) => (
                    <div key={index} className="text-sm">
                      <span className="font-medium text-blue-800">{biomarker.name}:</span>
                      <span className="text-blue-700 ml-2">
                        {biomarker.value} {biomarker.unit}
                      </span>
                      {biomarker.extractionConfidence && (
                        <span className="text-blue-600 ml-2 text-xs">
                          ({Math.round(biomarker.extractionConfidence * 100)}%)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between items-center pt-6 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            {uploadedFiles.filter(f => f.processingStatus === 'completed').length > 0 && (
              <span>
                {processingResults.size > 0 && 
                  Array.from(processingResults.values())
                    .reduce((total, result) => total + result.extractedBiomarkers.length, 0)
                } total biomarkers ready to import
              </span>
            )}
          </div>
          
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors duration-200"
            >
              Cancel
            </button>
            <button
              onClick={handleExtractSelected}
              disabled={uploadedFiles.filter(f => f.processingStatus === 'completed').length === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              Import Biomarkers
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}