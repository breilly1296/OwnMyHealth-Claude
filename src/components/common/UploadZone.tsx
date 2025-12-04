/**
 * UploadZone Component
 *
 * A reusable drag-and-drop file upload component with visual feedback
 * and progress tracking capabilities.
 *
 * Features:
 * - Drag-and-drop file selection with visual highlight state
 * - Click to browse file selection
 * - Single or multiple file upload modes
 * - Disabled state handling
 * - Processing state with animated spinner
 * - Progress bar with percentage display
 * - Customizable title, subtitle, and supported formats text
 * - Custom children slot for additional content
 * - File type filtering via accept attribute
 *
 * Props:
 * - onFilesSelected: Callback receiving array of File objects
 * - accept: File type filter (default: '*')
 * - multiple: Allow multiple files (default: false)
 * - disabled: Disable interaction (default: false)
 * - isProcessing: Show processing state (default: false)
 * - progress: Progress percentage (0-100)
 * - progressMessage: Custom message during processing
 * - title: Main text displayed in the zone
 * - subtitle: Secondary description text
 * - supportedFormats: Display string for supported file types
 * - maxSize: Display string for max file size (default: '10MB')
 *
 * @module components/common/UploadZone
 */

import React, { useState, useCallback, ReactNode } from 'react';
import { Upload, Loader2 } from 'lucide-react';

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  isProcessing?: boolean;
  progress?: number;
  progressMessage?: string;
  title?: string;
  subtitle?: string;
  supportedFormats?: string;
  maxSize?: string;
  children?: ReactNode;
  className?: string;
}

export default function UploadZone({
  onFilesSelected,
  accept = '*',
  multiple = false,
  disabled = false,
  isProcessing = false,
  progress,
  progressMessage,
  title = 'Drop files here or click to upload',
  subtitle,
  supportedFormats,
  maxSize = '10MB',
  children,
  className = '',
}: UploadZoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || isProcessing) return;

    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, [disabled, isProcessing]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (disabled || isProcessing) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = multiple
        ? Array.from(e.dataTransfer.files)
        : [e.dataTransfer.files[0]];
      onFilesSelected(files);
    }
  }, [disabled, isProcessing, multiple, onFilesSelected]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = multiple
        ? Array.from(e.target.files)
        : [e.target.files[0]];
      onFilesSelected(files);
    }
  }, [multiple, onFilesSelected]);

  const isDisabled = disabled || isProcessing;

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-lg transition-colors duration-200
        ${dragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}
        ${isDisabled ? 'bg-gray-50 cursor-not-allowed' : 'hover:border-gray-400 hover:bg-gray-50'}
        ${className}
      `}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        disabled={isDisabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />

      <div className="p-8 text-center">
        {isProcessing ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <p className="text-lg font-medium text-gray-900 mb-2">
              {progressMessage || 'Processing...'}
            </p>
            {progress !== undefined && (
              <div className="w-full max-w-xs">
                <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-500">{progress.toFixed(0)}%</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-lg font-medium text-gray-900 mb-2">{title}</p>
            {subtitle && (
              <p className="text-sm text-gray-600 mb-4">{subtitle}</p>
            )}
            {children}
            {(supportedFormats || maxSize) && (
              <p className="text-xs text-gray-500 mt-4">
                {supportedFormats && `Supported: ${supportedFormats}`}
                {supportedFormats && maxSize && ' | '}
                {maxSize && `Max size: ${maxSize}`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
