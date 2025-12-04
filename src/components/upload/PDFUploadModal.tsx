/**
 * PDFUploadModal Component
 *
 * A modal dialog for uploading and processing PDF lab reports. Allows users to
 * import their health data by uploading lab result documents.
 *
 * Features:
 * - Drag-and-drop or click-to-upload interface
 * - OCR-based text extraction using Tesseract.js
 * - PDF text extraction using pdf.js
 * - Comprehensive biomarker identification and mapping
 * - Visual upload progress indicator
 * - Error handling for invalid files
 *
 * Supports:
 * - PDF files (both text-based and scanned)
 * - Image files (PNG, JPG, JPEG)
 *
 * The component uses OCR to extract text from lab reports, then identifies
 * biomarkers using pattern matching and maps them to standard categories.
 *
 * @module components/upload/PDFUploadModal
 */

import React, { useState } from 'react';
import { X, Loader2, AlertTriangle, FileText, Image } from 'lucide-react';
import type { Biomarker } from '../../types';
import { parseLabReport } from '../../utils/biomarkers/labReportParser';

interface PDFUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExtract: (biomarkers: Partial<Biomarker>[]) => void;
}

export default function PDFUploadModal({ isOpen, onClose, onExtract }: PDFUploadModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setWarnings([]);
    setProgressMessage('Initializing...');

    try {
      // Validate file type
      const isValidType = file.type === 'application/pdf' || file.type.startsWith('image/');
      if (!isValidType) {
        throw new Error('Unsupported file type. Please upload a PDF or image file.');
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error('File is too large. Maximum file size is 10MB.');
      }

      // Update progress message based on file type
      setProgressMessage(
        file.type === 'application/pdf'
          ? 'Extracting text from PDF...'
          : 'Performing OCR on image...'
      );

      // Parse the lab report using OCR
      const result = await parseLabReport(file, (progress) => {
        setUploadProgress(progress);
        if (progress < 70) {
          setProgressMessage('Extracting text...');
        } else if (progress < 85) {
          setProgressMessage('Identifying biomarkers...');
        } else if (progress < 95) {
          setProgressMessage('Processing results...');
        } else {
          setProgressMessage('Finalizing...');
        }
      });

      if (!result.success) {
        throw new Error(result.errors?.join('. ') || 'Failed to extract biomarkers from document.');
      }

      if (result.warnings) {
        setWarnings(result.warnings);
      }

      // If we got biomarkers, pass them to the parent
      if (result.biomarkers.length > 0) {
        onExtract(result.biomarkers);
        onClose();
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Upload Lab Report</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" disabled={isProcessing}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-50 text-yellow-700 rounded-md text-sm">
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

        <div className="mb-6">
          <label
            htmlFor="pdf-upload"
            className={`
              flex flex-col items-center justify-center w-full h-40
              border-2 border-dashed rounded-lg
              transition-colors duration-200
              ${isProcessing ? 'bg-gray-50 border-gray-300 cursor-wait' : 'hover:bg-blue-50 border-blue-300 cursor-pointer'}
            `}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {isProcessing ? (
                <>
                  <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
                  <p className="text-sm font-medium text-gray-700">{progressMessage}</p>
                  <div className="w-48 h-2 bg-gray-200 rounded-full mt-3 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{uploadProgress}% complete</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-6 h-6 text-blue-500" />
                    <Image className="w-6 h-6 text-blue-500" />
                  </div>
                  <p className="text-sm text-gray-700 font-medium">Upload Lab Report</p>
                  <p className="text-xs text-gray-500 mt-1">Click to upload or drag and drop</p>
                  <p className="text-xs text-gray-400 mt-1">PDF or image files supported</p>
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
              }}
            />
          </label>
        </div>

        <div className="text-xs text-gray-500 space-y-1">
          <p><span className="font-medium">Supported formats:</span> PDF, PNG, JPG, JPEG</p>
          <p><span className="font-medium">Maximum file size:</span> 10MB</p>
          <p className="text-gray-400 mt-2">
            OCR technology will extract biomarker values from your lab report.
            For best results, ensure the document is clear and readable.
          </p>
        </div>
      </div>
    </div>
  );
}