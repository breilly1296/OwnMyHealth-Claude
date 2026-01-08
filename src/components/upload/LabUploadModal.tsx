/**
 * LabUploadModal Component
 *
 * A modal dialog for uploading lab results using Google Document AI OCR.
 * Supports both PDF and image files for bone health biomarker extraction.
 *
 * Features:
 * - Drag-and-drop or click-to-upload interface
 * - Server-side OCR using Google Document AI
 * - Bone health biomarker extraction (Calcium, Vitamin D, PTH, Phosphorus, Alk Phos)
 * - Visual upload progress indicator
 * - Error handling for invalid files
 *
 * Supported formats:
 * - PDF files
 * - Image files (PNG, JPG, TIFF)
 *
 * @module components/upload/LabUploadModal
 */

import React, { useState, useCallback } from 'react';
import { X, Loader2, AlertTriangle, FileText, Image, CheckCircle } from 'lucide-react';
import { uploadFile } from '../../services/uploadUtils';

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

export default function LabUploadModal({ isOpen, onClose, onSuccess }: LabUploadModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabOCRResponse | null>(null);

  const resetState = useCallback(() => {
    setIsProcessing(false);
    setUploadProgress(0);
    setProgressMessage('');
    setError(null);
    setResult(null);
  }, []);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setProgressMessage('Preparing upload...');
    setUploadProgress(10);

    try {
      // Validate file type
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

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error('File is too large. Maximum file size is 10MB.');
      }

      setProgressMessage('Uploading file...');
      setUploadProgress(30);

      // Simulate progress during upload
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev < 80) return prev + 5;
          return prev;
        });
      }, 500);

      setProgressMessage('Processing with OCR...');

      // Upload and process with server-side OCR
      const response = await uploadFile<LabOCRResponse>(
        '/upload/lab-results-ocr',
        file,
        {
          timeoutMs: 120000, // 2 minutes for OCR processing
          timeoutMessage: 'OCR processing took too long. Please try again with a clearer image.',
        }
      );

      clearInterval(progressInterval);
      setUploadProgress(100);
      setProgressMessage('Processing complete!');

      setResult(response);

      // Brief delay to show success state
      setTimeout(() => {
        onSuccess(response.biomarkers);
        onClose();
        resetState();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process file. Please try again.');
      setUploadProgress(0);
      setProgressMessage('');
    } finally {
      setIsProcessing(false);
    }
  }, [onSuccess, onClose, resetState]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (isProcessing) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [isProcessing, processFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-lg p-4 md:p-6 w-full md:max-w-md max-h-[95vh] md:max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">Upload Lab Results</h2>
          <button
            onClick={() => {
              onClose();
              resetState();
            }}
            className="p-2 -mr-2 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            disabled={isProcessing}
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

        {result && (
          <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-md text-sm">
            <div className="flex items-start gap-2 mb-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="font-medium">
                Successfully extracted {result.biomarkersCreated} biomarker{result.biomarkersCreated !== 1 ? 's' : ''}
              </span>
            </div>
            <ul className="list-disc list-inside ml-6 text-xs space-y-1">
              {result.biomarkers.map((b) => (
                <li key={b.id} className={b.isOutOfRange ? 'text-orange-600 dark:text-orange-400' : ''}>
                  {b.name}: {b.value} {b.unit}
                  {b.isOutOfRange && ' (out of range)'}
                </li>
              ))}
            </ul>
            {result.labName && (
              <p className="text-xs mt-2 text-green-600 dark:text-green-400">Lab: {result.labName}</p>
            )}
          </div>
        )}

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
                // Reset input so same file can be selected again
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div className="text-xs text-gray-500 dark:text-slate-400 space-y-2">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md">
            <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">Bone Health Biomarkers Extracted:</p>
            <ul className="list-disc list-inside text-blue-700 dark:text-blue-400 space-y-0.5">
              <li>Calcium</li>
              <li>Vitamin D (25-hydroxy)</li>
              <li>PTH (Parathyroid Hormone)</li>
              <li>Phosphorus</li>
              <li>Alkaline Phosphatase</li>
            </ul>
          </div>
          <p><span className="font-medium">Supported formats:</span> PDF, PNG, JPG, TIFF</p>
          <p><span className="font-medium">Maximum file size:</span> 10MB</p>
          <p className="text-gray-400 dark:text-slate-500 mt-2">
            Our OCR technology will extract biomarker values from your lab report.
            For best results, ensure the document is clear and readable.
          </p>
        </div>
      </div>
    </div>
  );
}
