import React, { useState, useEffect, useCallback } from 'react';
import { Upload, Loader2, AlertCircle, FileText } from 'lucide-react';
import FileCard from './FileCard';
import { filesApi } from '../../services/api';
import type { UserFile } from '../../types';

interface FilesPageProps {
  onUploadClick: () => void;
}

/**
 * FilesPage - Displays a grid of all uploaded files.
 *
 * Features:
 * - Grid layout (1 col mobile, 2 cols tablet, 3 cols desktop)
 * - Sort by lab date (most recent first)
 * - Loading and error states
 * - Empty state with upload prompt
 * - View, Download, Delete actions
 * - Delete confirmation modal
 */
export default function FilesPage({ onUploadClick }: FilesPageProps) {
  const [files, setFiles] = useState<UserFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<UserFile | null>(null);

  // Fetch files on mount
  useEffect(() => {
    const fetchFiles = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await filesApi.getAll();
        // Convert API response to UserFile type and sort by labDate desc
        const sortedFiles = (data as UserFile[]).sort((a, b) => {
          const dateA = a.labDate ? new Date(a.labDate).getTime() : 0;
          const dateB = b.labDate ? new Date(b.labDate).getTime() : 0;
          return dateB - dateA;
        });
        setFiles(sortedFiles);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        setIsLoading(false);
      }
    };

    fetchFiles();
  }, []);

  // Handle view file
  const handleView = useCallback(async (file: UserFile) => {
    try {
      const { url } = await filesApi.getDownloadUrl(file.id);
      window.open(url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file');
    }
  }, []);

  // Handle download file
  const handleDownload = useCallback(async (file: UserFile) => {
    try {
      const { url } = await filesApi.getDownloadUrl(file.id);
      // Create a temporary link to trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = file.originalFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file');
    }
  }, []);

  // Handle delete file
  const handleDelete = useCallback((file: UserFile) => {
    setFileToDelete(file);
  }, []);

  // Confirm delete
  const confirmDelete = useCallback(async () => {
    if (!fileToDelete) return;

    try {
      setDeletingFileId(fileToDelete.id);
      await filesApi.delete(fileToDelete.id);
      setFiles((prev) => prev.filter((f) => f.id !== fileToDelete.id));
      setFileToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    } finally {
      setDeletingFileId(null);
    }
  }, [fileToDelete]);

  // Cancel delete
  const cancelDelete = useCallback(() => {
    setFileToDelete(null);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500 mb-4" />
        <p className="text-slate-600 dark:text-slate-400">Loading your files...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
          <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
        </div>
        <p className="text-slate-900 dark:text-white font-medium mb-2">Failed to load files</p>
        <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
          <FileText className="w-12 h-12 text-slate-400 dark:text-slate-500" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          No files uploaded yet
        </h3>
        <p className="text-slate-600 dark:text-slate-400 text-center mb-6 max-w-md">
          Upload your first lab report to get started. We'll extract biomarkers automatically and store the file for future reference.
        </p>
        <button
          onClick={onUploadClick}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg transition-colors"
        >
          <Upload className="w-5 h-5" />
          Upload Lab Report
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">My Reports</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {files.length} file{files.length !== 1 ? 's' : ''} uploaded
          </p>
        </div>
        <button
          onClick={onUploadClick}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload
        </button>
      </div>

      {/* File Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {files.map((file) => (
          <FileCard
            key={file.id}
            file={file}
            onView={handleView}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* Delete Confirmation Modal */}
      {fileToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Delete File?
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              Are you sure you want to delete <strong>"{fileToDelete.filename}"</strong>? This will remove the file from storage. The biomarkers extracted from this file will not be deleted.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={cancelDelete}
                disabled={!!deletingFileId}
                className="px-4 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={!!deletingFileId}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingFileId === fileToDelete.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
