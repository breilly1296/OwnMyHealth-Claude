import React, { useMemo, useState, useCallback } from 'react';
import { Upload, X, FileText, Activity, Heart, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import type { ClinicalFile, ProcessingResult, Biomarker } from '../../types';
import { processClinicalFile } from '../../utils/documents/fileProcessing';
import ExtractionReviewStep, {
  type ExtractedBiomarkerPreview,
} from './ExtractionReviewStep';

interface ClinicalFileUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onExtract: (biomarkers: Partial<Biomarker>[]) => void;
}

const FILE_TYPE_ICONS = {
  'DEXA': Activity,
  'EKG': Heart,
  'Lab Report': FileText,
  'Other': FileText,
};

const FILE_TYPE_COLORS = {
  'DEXA': 'text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400',
  'EKG': 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  'Lab Report': 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  'Other': 'text-gray-600 bg-gray-100 dark:bg-slate-700 dark:text-slate-300',
};

function detectFileTypeFromBiomarkers(biomarkers: Partial<Biomarker>[]): ClinicalFile['type'] {
  const categories = biomarkers.map((b) => b.category);
  if (categories.includes('Body Composition')) return 'DEXA';
  if (categories.includes('EKG')) return 'EKG';
  return 'Lab Report';
}

function toPreview(
  b: Partial<Biomarker>,
  fileId: string,
  index: number
): ExtractedBiomarkerPreview {
  const value = typeof b.value === 'number' ? b.value : 0;
  const confidence = b.extractionConfidence ?? 0.85;
  const referenceRange = b.normalRange && typeof b.normalRange.min === 'number' && typeof b.normalRange.max === 'number'
    ? { min: b.normalRange.min, max: b.normalRange.max }
    : undefined;
  const isOutOfRange = referenceRange
    ? value < referenceRange.min || value > referenceRange.max
    : false;
  return {
    id: `${fileId}-${index}-${b.name ?? 'unknown'}`,
    name: b.name ?? 'Unknown',
    value,
    unit: b.unit ?? '',
    category: (b.category as string) ?? 'Other',
    isOutOfRange,
    referenceRange,
    confidence,
    selected: true,
    edited: false,
    source: 'claude',
  };
}

function mergePreviewIntoBiomarker(
  preview: ExtractedBiomarkerPreview,
  original: Partial<Biomarker>
): Partial<Biomarker> {
  return {
    ...original,
    name: preview.name,
    value: preview.value,
    unit: preview.unit,
    category: preview.category as Biomarker['category'],
    extractionConfidence: preview.confidence,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function ClinicalFileUpload({ isOpen, onClose, onExtract }: ClinicalFileUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<ClinicalFile[]>([]);
  const [processingResults, setProcessingResults] = useState<Map<string, ProcessingResult>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const clinicalFile: ClinicalFile = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^/.]+$/, ''),
        type: 'Other',
        uploadDate: new Date().toISOString(),
        processingStatus: 'processing',
        originalFileName: file.name,
        fileSize: file.size,
      };

      setUploadedFiles((prev) => [...prev, clinicalFile]);

      try {
        const result = await processClinicalFile(file);
        setProcessingResults((prev) => new Map(prev.set(clinicalFile.id, result)));
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === clinicalFile.id
              ? {
                  ...f,
                  processingStatus: result.success ? 'completed' : 'failed',
                  type:
                    result.extractedBiomarkers.length > 0
                      ? detectFileTypeFromBiomarkers(result.extractedBiomarkers)
                      : 'Other',
                }
              : f
          )
        );
      } catch {
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === clinicalFile.id ? { ...f, processingStatus: 'failed' } : f))
        );
      }
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFiles(Array.from(e.dataTransfer.files));
      }
    },
    [handleFiles]
  );

  // Flatten biomarkers across all completed files into previews + a
  // matching lookup so we can merge edits back into the original
  // partial-biomarker shape on confirm.
  const { previews, lookupByPreviewId } = useMemo(() => {
    const out: ExtractedBiomarkerPreview[] = [];
    const lookup = new Map<string, Partial<Biomarker>>();

    uploadedFiles
      .filter((f) => f.processingStatus === 'completed')
      .forEach((file) => {
        const result = processingResults.get(file.id);
        if (!result?.success) return;
        result.extractedBiomarkers.forEach((b, idx) => {
          const preview = toPreview(b, file.id, idx);
          out.push(preview);
          lookup.set(preview.id, b);
        });
      });

    return { previews: out, lookupByPreviewId: lookup };
  }, [uploadedFiles, processingResults]);

  const avgConfidence = useMemo(() => {
    if (previews.length === 0) return 0.85;
    return previews.reduce((acc, p) => acc + p.confidence, 0) / previews.length;
  }, [previews]);

  const handleConfirmImport = (selected: ExtractedBiomarkerPreview[]) => {
    setIsImporting(true);
    try {
      const merged = selected
        .map((preview) => {
          const original = lookupByPreviewId.get(preview.id);
          return original ? mergePreviewIntoBiomarker(preview, original) : null;
        })
        .filter((b): b is Partial<Biomarker> => b !== null);

      if (merged.length > 0) {
        onExtract(merged);
      }
      onClose();
      setUploadedFiles([]);
      setProcessingResults(new Map());
      setIsReviewing(false);
    } finally {
      setIsImporting(false);
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

  if (!isOpen) return null;

  const completedCount = uploadedFiles.filter((f) => f.processingStatus === 'completed').length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl p-4 md:p-6 w-full md:max-w-4xl max-h-[95vh] md:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">
              {isReviewing ? 'Review Extracted Biomarkers' : 'Upload Clinical Files'}
            </h2>
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
              {isReviewing
                ? `From ${completedCount} file${completedCount === 1 ? '' : 's'}`
                : 'Upload DEXA scans, EKG reports, and lab results for automatic data extraction'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isImporting}
            className="p-2 -mr-2 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {isReviewing ? (
          <div className="flex-1 overflow-y-auto">
            <ExtractionReviewStep
              biomarkers={previews}
              extractionConfidence={avgConfidence}
              onConfirmImport={handleConfirmImport}
              onCancel={() => setIsReviewing(false)}
              isImporting={isImporting}
            />
          </div>
        ) : (
          <>
            {/* Upload dropzone */}
            <div
              className={`
                relative border-2 border-dashed rounded-2xl p-8 mb-4 transition-colors duration-200
                ${dragActive
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}
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
                <Upload className="w-12 h-12 text-gray-400 dark:text-slate-500 mx-auto mb-3" />
                <p className="text-lg font-medium text-gray-900 dark:text-white mb-1">
                  Drop files here or click to upload
                </p>
                <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                  Supports PDF, PNG, JPG, JPEG, TIFF files up to 10MB
                </p>

                <div className="flex justify-center gap-6 text-xs text-gray-500 dark:text-slate-400">
                  <div className="flex items-center">
                    <Activity className="w-4 h-4 mr-1 text-purple-500" />
                    DEXA Scans
                  </div>
                  <div className="flex items-center">
                    <Heart className="w-4 h-4 mr-1 text-red-500" />
                    EKG Reports
                  </div>
                  <div className="flex items-center">
                    <FileText className="w-4 h-4 mr-1 text-blue-500" />
                    Lab Reports
                  </div>
                </div>
              </div>
            </div>

            {/* File list */}
            {uploadedFiles.length > 0 && (
              <div className="flex-1 overflow-hidden">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                  Uploaded Files ({uploadedFiles.length})
                </h3>

                <div className="overflow-y-auto max-h-64 space-y-2">
                  {uploadedFiles.map((file) => {
                    const Icon = FILE_TYPE_ICONS[file.type];
                    const result = processingResults.get(file.id);
                    return (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-900/40 rounded-xl"
                      >
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <div className={`p-2 rounded-lg ${FILE_TYPE_COLORS[file.type]}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {file.name}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                              <span>{file.type}</span>
                              <span>{formatFileSize(file.fileSize)}</span>
                              {result && result.success && (
                                <span className="text-green-600 dark:text-green-400">
                                  {result.extractedBiomarkers.length} biomarkers
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(file.processingStatus)}
                          {result && result.confidence > 0 && (
                            <span className="text-xs text-gray-500 dark:text-slate-400">
                              {Math.round(result.confidence * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action bar */}
            <div className="flex justify-between items-center pt-4 mt-4 border-t border-gray-200 dark:border-slate-700">
              <div className="text-sm text-gray-600 dark:text-slate-400">
                {completedCount > 0 && (
                  <span>{previews.length} total biomarkers ready to review</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setIsReviewing(true)}
                  disabled={completedCount === 0 || previews.length === 0}
                  className="px-5 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Review Biomarkers
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
