/**
 * PDFUploadModal Component
 *
 * Modal dialog for uploading PDF/image lab reports. Client-side OCR via
 * Tesseract + pdf.js extracts biomarkers, then hands them to
 * ExtractionReviewStep so the user can verify/edit/deselect before import.
 *
 * @module components/upload/PDFUploadModal
 */

import { useState } from 'react';
import { X, Loader2, AlertTriangle, FileText, Image } from 'lucide-react';
import type { Biomarker } from '../../types';
import { parseLabReport } from '../../utils/biomarkers/labReportParser';
import ExtractionReviewStep, {
  type ExtractedBiomarkerPreview,
} from './ExtractionReviewStep';

interface PDFUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExtract: (biomarkers: Partial<Biomarker>[]) => void;
}

const DEFAULT_CLIENT_PARSE_CONFIDENCE = 0.85;

function toPreview(b: Partial<Biomarker>, index: number): ExtractedBiomarkerPreview {
  const value = typeof b.value === 'number' ? b.value : 0;
  const confidence = b.extractionConfidence ?? DEFAULT_CLIENT_PARSE_CONFIDENCE;
  const referenceRange = b.normalRange && typeof b.normalRange.min === 'number' && typeof b.normalRange.max === 'number'
    ? { min: b.normalRange.min, max: b.normalRange.max }
    : undefined;
  const isOutOfRange = referenceRange
    ? value < referenceRange.min || value > referenceRange.max
    : false;
  return {
    id: b.id || `pdf-${index}-${b.name ?? 'unknown'}`,
    name: b.name ?? 'Unknown',
    value,
    unit: b.unit ?? '',
    category: (b.category as string) ?? 'Other',
    isOutOfRange,
    referenceRange,
    confidence,
    selected: true,
    edited: false,
    source: 'client-parse',
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

export default function PDFUploadModal({ isOpen, onClose, onExtract }: PDFUploadModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extracted, setExtracted] = useState<Partial<Biomarker>[] | null>(null);
  const [previews, setPreviews] = useState<ExtractedBiomarkerPreview[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const resetAll = () => {
    setIsProcessing(false);
    setUploadProgress(0);
    setProgressMessage('');
    setError(null);
    setWarnings([]);
    setExtracted(null);
    setPreviews([]);
    setIsImporting(false);
  };

  const handleClose = () => {
    onClose();
    resetAll();
  };

  const backToDropzone = () => {
    setExtracted(null);
    setPreviews([]);
    setError(null);
    setWarnings([]);
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setWarnings([]);
    setProgressMessage('Initializing...');

    try {
      const isValidType = file.type === 'application/pdf' || file.type.startsWith('image/');
      if (!isValidType) {
        throw new Error('Unsupported file type. Please upload a PDF or image file.');
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error('File is too large. Maximum file size is 10MB.');
      }

      setProgressMessage(
        file.type === 'application/pdf'
          ? 'Extracting text from PDF...'
          : 'Performing OCR on image...'
      );

      const result = await parseLabReport(file, (progress) => {
        setUploadProgress(progress);
        if (progress < 70) setProgressMessage('Extracting text...');
        else if (progress < 85) setProgressMessage('Identifying biomarkers...');
        else if (progress < 95) setProgressMessage('Processing results...');
        else setProgressMessage('Finalizing...');
      });

      if (!result.success) {
        throw new Error(result.errors?.join('. ') || 'Failed to extract biomarkers from document.');
      }

      if (result.warnings) {
        setWarnings(result.warnings);
      }

      if (result.biomarkers.length > 0) {
        setExtracted(result.biomarkers);
        setPreviews(result.biomarkers.map(toPreview));
      } else {
        setError('No biomarkers found in the document. Please ensure this is a valid lab report.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process file. Please try again.');
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
      setProgressMessage('');
    }
  };

  const handleConfirmImport = (selected: ExtractedBiomarkerPreview[]) => {
    if (!extracted) return;
    setIsImporting(true);
    try {
      const merged = selected
        .map((preview) => {
          const original = extracted.find(
            (b, idx) => (b.id || `pdf-${idx}-${b.name ?? 'unknown'}`) === preview.id
          );
          return original ? mergePreviewIntoBiomarker(preview, original) : null;
        })
        .filter((b): b is Partial<Biomarker> => b !== null);

      onExtract(merged);
      handleClose();
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  const avgConfidence = previews.length > 0
    ? previews.reduce((acc, p) => acc + p.confidence, 0) / previews.length
    : DEFAULT_CLIENT_PARSE_CONFIDENCE;

  const showReview = extracted !== null && previews.length > 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className={`bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl p-4 md:p-6 w-full ${showReview ? 'md:max-w-4xl' : 'md:max-w-md'} max-h-[95vh] md:max-h-[90vh] overflow-y-auto`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">
            {showReview ? 'Review Extracted Biomarkers' : 'Upload Lab Report'}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 -mr-2 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            disabled={isProcessing || isImporting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && !showReview && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {warnings.length > 0 && !showReview && (
          <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-md text-sm">
            <div className="flex items-start gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="font-medium">Warnings:</span>
            </div>
            <ul className="list-disc list-inside ml-6 text-xs space-y-1">
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {showReview ? (
          <ExtractionReviewStep
            biomarkers={previews}
            extractionConfidence={avgConfidence}
            onConfirmImport={handleConfirmImport}
            onCancel={backToDropzone}
            isImporting={isImporting}
          />
        ) : (
          <>
            <div className="mb-6">
              <label
                htmlFor="pdf-upload"
                className={`
                  flex flex-col items-center justify-center w-full h-40
                  border-2 border-dashed rounded-lg
                  transition-colors duration-200
                  ${isProcessing ? 'bg-gray-50 dark:bg-slate-700 border-gray-300 dark:border-slate-600 cursor-wait' : 'hover:bg-blue-50 dark:hover:bg-slate-700 border-blue-300 dark:border-blue-600 cursor-pointer'}
                `}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
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
                      <p className="text-sm text-gray-700 dark:text-slate-200 font-medium">Upload Lab Report</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Click to upload or drag and drop</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">PDF or image files supported</p>
                    </>
                  )}
                </div>
                <input
                  id="pdf-upload"
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
            </div>

            <div className="text-xs text-gray-500 dark:text-slate-400 space-y-1">
              <p><span className="font-medium">Supported formats:</span> PDF, PNG, JPG, JPEG</p>
              <p><span className="font-medium">Maximum file size:</span> 10MB</p>
              <p className="text-gray-400 dark:text-slate-500 mt-2">
                OCR technology will extract biomarker values from your lab report.
                For best results, ensure the document is clear and readable.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
