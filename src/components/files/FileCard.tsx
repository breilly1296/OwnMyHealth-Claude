import { FileText, Image, Download, Eye, Trash2, Calendar, Building2, FlaskConical } from 'lucide-react';
import type { UserFile } from '../../types';
import { formatDateOnly } from '../../utils/format';

interface FileCardProps {
  file: UserFile;
  onView: (file: UserFile) => void;
  onDownload: (file: UserFile) => void;
  onDelete: (file: UserFile) => void;
}

/**
 * FileCard - Displays a single uploaded file with metadata and actions.
 *
 * Shows:
 * - File icon (PDF or image)
 * - Filename/title
 * - Lab name (source)
 * - Lab date
 * - Biomarker count
 * - Category chips
 * - View/Download/Delete actions
 */
export default function FileCard({ file, onView, onDownload, onDelete }: FileCardProps) {
  const isPDF = file.fileType === 'application/pdf';
  const FileIcon = isPDF ? FileText : Image;

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date (date-only: labDate is an @db.Date column — render in UTC to
  // avoid the off-by-one in negative-UTC locales).
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return 'Unknown date';
    return formatDateOnly(dateStr, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow duration-200">
      {/* File Header */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-lg ${isPDF ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
            <FileIcon className={`w-6 h-6 ${isPDF ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white truncate" title={file.filename}>
              {file.filename}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {formatFileSize(file.fileSize)} • {file.originalFilename}
            </p>
          </div>
        </div>
      </div>

      {/* File Info */}
      <div className="p-4 space-y-3">
        {/* Lab Name */}
        {file.labName && (
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Building2 className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
            <span className="truncate">{file.labName}</span>
          </div>
        )}

        {/* Lab Date */}
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Calendar className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
          <span>{formatDate(file.labDate)}</span>
        </div>

        {/* Biomarker Count */}
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <FlaskConical className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
          <span>{file.biomarkersExtracted} biomarker{file.biomarkersExtracted !== 1 ? 's' : ''} extracted</span>
        </div>

        {/* Category Tags */}
        {file.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {file.categories.slice(0, 4).map((category) => (
              <span
                key={category}
                className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              >
                {category}
              </span>
            ))}
            {file.categories.length > 4 && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                +{file.categories.length - 4} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onView(file)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
            title="View file"
          >
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">View</span>
          </button>
          <button
            onClick={() => onDownload(file)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
            title="Download file"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
        <button
          onClick={() => onDelete(file)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
          title="Delete file"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Delete</span>
        </button>
      </div>
    </div>
  );
}
