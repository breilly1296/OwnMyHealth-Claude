import React, { useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import type { Biomarker } from '../types';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface PDFUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExtract: (biomarkers: Partial<Biomarker>[]) => void;
}

// Simulated extraction results based on common lab report formats
const mockExtractedData: Record<string, { value: number; unit: string }> = {
  'Vitamin D': { value: 28, unit: 'ng/mL' },
  'Vitamin B12': { value: 450, unit: 'pg/mL' },
  'Folate': { value: 15, unit: 'ng/mL' },
  'Iron': { value: 85, unit: 'μg/dL' }
};

export default function PDFUploadModal({ isOpen, onClose, onExtract }: PDFUploadModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // Simulate file upload progress
      for (let i = 0; i <= 100; i += 20) {
        setUploadProgress(i);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Read the PDF file
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Convert mock data to biomarker format
      const extractedBiomarkers = Object.entries(mockExtractedData).map(([name, data]) => ({
        name,
        value: data.value,
        unit: data.unit,
        date: new Date().toISOString().split('T')[0],
        category: 'Vitamins' as const,
        normalRange: {
          min: name === 'Vitamin D' ? 30 : 200,
          max: name === 'Vitamin D' ? 100 : 900
        }
      }));

      onExtract(extractedBiomarkers);
      onClose();
    } catch (err) {
      setError('Failed to process PDF. Please ensure it\'s a valid lab report.');
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Upload Lab Report</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="mb-6">
          <label
            htmlFor="pdf-upload"
            className={`
              flex flex-col items-center justify-center w-full h-32
              border-2 border-dashed rounded-lg
              cursor-pointer
              transition-colors duration-200
              ${isProcessing ? 'bg-gray-50 border-gray-300' : 'hover:bg-blue-50 border-blue-300'}
            `}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {isProcessing ? (
                <>
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
                  <p className="text-sm text-gray-500">Processing PDF...</p>
                  <p className="text-xs text-gray-400">{uploadProgress}%</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-blue-500 mb-2" />
                  <p className="text-sm text-gray-500">Click to upload PDF lab report</p>
                  <p className="text-xs text-gray-400">or drag and drop</p>
                </>
              )}
            </div>
            <input
              id="pdf-upload"
              type="file"
              className="hidden"
              accept=".pdf"
              disabled={isProcessing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processFile(file);
              }}
            />
          </label>
        </div>

        <div className="text-xs text-gray-500">
          <p>Supported format: PDF</p>
          <p>Maximum file size: 10MB</p>
        </div>
      </div>
    </div>
  );
}