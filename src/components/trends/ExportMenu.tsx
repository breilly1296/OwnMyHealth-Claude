/**
 * ExportMenu Component
 *
 * A dropdown that lets the user export their biomarkers for sharing with a
 * clinician. Wires the previously-unsurfaced report generators into the UI:
 *  - "Share with doctor (PDF)" → the comprehensive report from
 *    `pdfReportGenerator` (cover page, executive summary, trends, ranges).
 *  - "Download CSV" → the flat spreadsheet from `exportBiomarkers`.
 *
 * The doctor report best-effort pre-fills the patient's name from their
 * profile so the cover page isn't anonymous; a failed/empty profile fetch is
 * non-fatal (the generator falls back to "Not specified").
 *
 * @module components/trends/ExportMenu
 */

import { useState, useEffect, useRef } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown, Loader2 } from 'lucide-react';
import type { Biomarker } from '../../types';
import { settingsApi } from '../../services/api/settings';
import { useErrorNotification } from '../../hooks/useErrorNotification';
import { ErrorToast, SuccessToast } from '../common';

// The PDF/CSV generators pull in jsPDF (and, for the report, html2canvas) —
// ~1 MB of JS. Import them lazily inside the handlers so the bundle only loads
// when the user actually exports, keeping the Trends page light on first paint.

interface ExportMenuProps {
  /** Biomarkers to include in the export (already filtered by the page). */
  biomarkers: Biomarker[];
}

export default function ExportMenu({ biomarkers }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const error = useErrorNotification();

  const hasData = biomarkers.length > 0;

  // Clean up the success-toast timer on unmount to avoid setting state on an
  // unmounted component.
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => setSuccessMessage(null), 5000);
  };

  const handleCsv = async () => {
    setIsOpen(false);
    setIsGenerating(true);
    try {
      const { exportToCSV } = await import('../../utils/biomarkers/exportBiomarkers');
      exportToCSV(biomarkers);
      showSuccess('CSV downloaded. Check your downloads folder.');
    } catch {
      error.show('Could not generate the CSV file. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDoctorPdf = async () => {
    setIsOpen(false);
    setIsGenerating(true);
    try {
      // Best-effort name pre-fill — never block the export on the profile call.
      let patientName: string | undefined;
      try {
        const profile = await settingsApi.getProfile();
        const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
        patientName = name || undefined;
      } catch {
        patientName = undefined;
      }

      const { downloadHealthReport } = await import('../../utils/pdfReportGenerator');
      await downloadHealthReport({
        biomarkers,
        options: {
          patientName,
          reportDate: new Date().toISOString(),
          includeTrends: true,
          includeRecommendations: true,
        },
      });
      showSuccess('Doctor report (PDF) downloaded. Check your downloads folder.');
    } catch {
      error.show('Could not generate the PDF report. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={!hasData || isGenerating}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={hasData ? 'Export your biomarkers' : 'Add biomarkers to enable export'}
        className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white border border-brand-500 rounded-xl text-sm font-medium transition-colors min-w-[140px]"
      >
        {isGenerating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span className="flex-1 text-left">{isGenerating ? 'Preparing…' : 'Export / Share'}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-50"
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleDoctorPdf}
              className="w-full flex items-start gap-3 text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <FileText className="w-4 h-4 mt-0.5 text-brand-600 dark:text-brand-400 flex-shrink-0" />
              <span>
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                  Share with doctor (PDF)
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Full report with trends &amp; reference ranges
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleCsv}
              className="w-full flex items-start gap-3 text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4 mt-0.5 text-brand-600 dark:text-brand-400 flex-shrink-0" />
              <span>
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                  Download CSV
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Spreadsheet of all current values
                </span>
              </span>
            </button>
          </div>
        </>
      )}

      <SuccessToast
        message={successMessage}
        isVisible={successMessage !== null}
        onDismiss={() => setSuccessMessage(null)}
      />
      <ErrorToast message={error.message} isVisible={error.isVisible} onDismiss={error.hide} />
    </div>
  );
}
