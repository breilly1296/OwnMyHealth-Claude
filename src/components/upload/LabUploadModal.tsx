/**
 * LabUploadModal Component
 *
 * Uploads lab PDFs/images to the server-side OCR endpoint
 * (Google Document AI) and then renders ExtractionReviewStep so the user
 * can review the extraction before the dashboard refresh is triggered.
 *
 * The OCR endpoint persists every extracted biomarker server-side during
 * upload, so on confirm we reconcile that auto-saved set against the user's
 * review (M21): rows they deselected are deleted and rows they edited are
 * updated via the biomarkers API, then the parent refresh pulls authoritative
 * data from the server. (Previously the review was a placebo — deselects and
 * edits were silently discarded.)
 *
 * @module components/upload/LabUploadModal
 */

import React, { useState, useCallback } from 'react';
import { X, Loader2, AlertTriangle, FileText, Image, Building2, Calendar, CheckCircle } from 'lucide-react';
import { uploadFile } from '../../services/uploadUtils';
import { formatDateOnly } from '../../utils/format';
import { biomarkersApi } from '../../services/api';
import { planExtractionReview } from '../../utils/extractionReview';
import ExtractionReviewStep, {
  type ExtractedBiomarkerPreview,
} from './ExtractionReviewStep';

interface ExtractedBiomarker {
  id: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  isOutOfRange: boolean;
}

interface LabOCRResponse {
  biomarkersCreated: number;
  biomarkers: ExtractedBiomarker[];
  labName?: string;
  reportDate?: string;
  extractionConfidence: number;
  ocrMetadata: {
    processingTimeMs: number;
    pageCount: number;
    documentType: string;
  };
}

interface LabUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (biomarkers: ExtractedBiomarker[]) => void;
}

function toPreview(
  b: ExtractedBiomarker,
  overallConfidence: number
): ExtractedBiomarkerPreview {
  return {
    id: b.id,
    name: b.name,
    value: b.value,
    unit: b.unit,
    category: b.category,
    isOutOfRange: b.isOutOfRange,
    confidence: overallConfidence,
    selected: true,
    edited: false,
    source: 'ocr',
  };
}

function previewToBiomarker(preview: ExtractedBiomarkerPreview): ExtractedBiomarker {
  return {
    id: preview.id,
    name: preview.name,
    value: preview.value,
    unit: preview.unit,
    category: preview.category,
    isOutOfRange: preview.isOutOfRange,
  };
}

export default function LabUploadModal({ isOpen, onClose, onSuccess }: LabUploadModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabOCRResponse | null>(null);
  const [previews, setPreviews] = useState<ExtractedBiomarkerPreview[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const resetState = useCallback(() => {
    setIsProcessing(false);
    setUploadProgress(0);
    setProgressMessage('');
    setError(null);
    setResult(null);
    setPreviews([]);
    setIsImporting(false);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    resetState();
  }, [onClose, resetState]);

  const backToDropzone = useCallback(() => {
    setResult(null);
    setPreviews([]);
    setError(null);
  }, []);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setPreviews([]);
    setProgressMessage('Preparing upload...');
    setUploadProgress(10);

    // Declared outside the try so the catch/finally can clear it — otherwise an
    // OCR/upload error leaves this interval running, mutating state after the
    // modal has closed.
    let progressInterval: ReturnType<typeof setInterval> | undefined;

    try {
      const validTypes = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/tiff',
        'image/gif',
        'image/webp',
      ];
      if (!validTypes.includes(file.type)) {
        throw new Error('Unsupported file type. Please upload a PDF or image file (PNG, JPG, TIFF).');
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error('File is too large. Maximum file size is 10MB.');
      }

      setProgressMessage('Uploading file...');
      setUploadProgress(30);

      progressInterval = setInterval(() => {
        setUploadProgress((prev) => (prev < 80 ? prev + 5 : prev));
      }, 500);

      setProgressMessage('Processing with OCR...');

      const response = await uploadFile<LabOCRResponse>(
        '/upload/lab-results-ocr',
        file,
        {
          timeoutMs: 120000,
          timeoutMessage: 'OCR processing took too long. Please try again with a clearer image.',
        }
      );

      setUploadProgress(100);
      setProgressMessage('Processing complete!');

      setResult(response);
      setPreviews(response.biomarkers.map((b) => toPreview(b, response.extractionConfidence)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process file. Please try again.');
      setUploadProgress(0);
      setProgressMessage('');
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsProcessing(false);
    }
  }, []);

  const handleConfirmImport = useCallback(async (selected: ExtractedBiomarkerPreview[]) => {
    setIsImporting(true);
    setError(null);
    try {
      // The OCR endpoint already auto-saved every extracted biomarker. Reconcile
      // that set with the user's review: delete the rows they deselected and
      // update the ones they edited (M21 — previously these were silently lost).
      if (result) {
        const plan = planExtractionReview(result.biomarkers, selected);
        const ops = [
          ...plan.deselectedIds.map((id) => biomarkersApi.delete(id)),
          ...plan.edits.map((e) => biomarkersApi.update(e.id, e.data)),
        ];
        const settled = await Promise.allSettled(ops);
        const failures = settled.filter((r) => r.status === 'rejected').length;
        // Refresh authoritative data from the server either way.
        onSuccess(selected.map(previewToBiomarker));
        if (failures > 0) {
          setError(
            `${failures} of your change${failures === 1 ? '' : 's'} could not be applied. ` +
              'Your imported data has been refreshed from the server.'
          );
          return;
        }
      } else {
        onSuccess(selected.map(previewToBiomarker));
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply your review. Please try again.');
    } finally {
      setIsImporting(false);
    }
  }, [result, onSuccess, handleClose]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isProcessing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [isProcessing, processFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (!isOpen) return null;

  const showReview = result !== null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className={`bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl p-4 md:p-6 w-full ${showReview ? 'md:max-w-4xl' : 'md:max-w-md'} max-h-[95vh] md:max-h-[90vh] overflow-y-auto`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">
            {showReview ? 'Review Extracted Biomarkers' : 'Upload Lab Results'}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 -mr-2 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            disabled={isProcessing || isImporting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {showReview && result ? (
          <>
            <div className="p-3 mb-4 bg-green-100 dark:bg-green-900/30 rounded-xl border border-green-200 dark:border-green-800">
              <div className="flex flex-wrap items-center gap-3 text-sm text-green-800 dark:text-green-300">
                <div className="flex items-center gap-1.5 font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Extracted {result.biomarkersCreated} biomarker{result.biomarkersCreated !== 1 ? 's' : ''}
                </div>
                {result.labName && (
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-4 h-4" />
                    {result.labName}
                  </div>
                )}
                {result.reportDate && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {formatDateOnly(result.reportDate, {})}
                  </div>
                )}
              </div>
            </div>

            <ExtractionReviewStep
              biomarkers={previews}
              labName={result.labName}
              reportDate={result.reportDate}
              extractionConfidence={result.extractionConfidence}
              onConfirmImport={handleConfirmImport}
              onCancel={backToDropzone}
              isImporting={isImporting}
            />
          </>
        ) : (
          <div className="mb-6">
            <label
              htmlFor="lab-upload"
              className={`
                flex flex-col items-center justify-center w-full h-44
                border-2 border-dashed rounded-lg
                transition-colors duration-200
                ${isProcessing ? 'bg-gray-50 dark:bg-slate-700 border-gray-300 dark:border-slate-600 cursor-wait' : 'hover:bg-blue-50 dark:hover:bg-slate-700 border-blue-300 dark:border-blue-600 cursor-pointer'}
              `}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <div className="flex flex-col items-center justify-center py-6">
                {isProcessing ? (
                  <>
                    <Loader2 className="w-10 h-10 text-blue-500 dark:text-blue-400 animate-spin mb-3" />
                    <p className="text-sm font-medium text-gray-700 dark:text-slate-200">{progressMessage}</p>
                    <div className="w-48 h-2 bg-gray-200 dark:bg-slate-600 rounded-full mt-3 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">{uploadProgress}% complete</p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-6 h-6 text-blue-500 dark:text-blue-400" />
                      <Image className="w-6 h-6 text-blue-500 dark:text-blue-400" />
                    </div>
                    <p className="text-sm text-gray-700 dark:text-slate-200 font-medium">Upload Lab Results</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Click to upload or drag and drop</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">PDF or image files supported</p>
                  </>
                )}
              </div>
              <input
                id="lab-upload"
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                disabled={isProcessing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                  e.target.value = '';
                }}
              />
            </label>

            <div className="text-xs text-gray-500 dark:text-slate-400 space-y-2 mt-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md">
                <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">Biomarkers Extracted:</p>
                <p className="text-blue-700 dark:text-blue-400">
                  All standard lab values including lipids, CBC, metabolic panel, thyroid, vitamins, and more.
                </p>
              </div>
              <p><span className="font-medium">Supported formats:</span> PDF, PNG, JPG, TIFF</p>
              <p><span className="font-medium">Maximum file size:</span> 10MB</p>
              <p className="text-gray-400 dark:text-slate-500 mt-2">
                Our AI will extract biomarker values from your lab report.
                For best results, ensure the document is clear and readable.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
