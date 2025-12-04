/**
 * Report Generator Modal
 *
 * Modal component for generating comprehensive PDF health reports.
 * Allows customization of report options and provides download/print functionality.
 */

import React, { useState, useRef } from 'react';
import {
  X,
  FileText,
  Download,
  Printer,
  Settings2,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileBarChart,
  Heart,
  Activity,
  TrendingUp,
} from 'lucide-react';
import type { Biomarker } from '../../types';
import {
  downloadHealthReport,
  printHealthReport,
  type ReportData,
} from '../../utils/pdfReportGenerator';

interface ReportGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  biomarkers: Biomarker[];
  patientName?: string;
}

// Local config interface for UI state
interface ReportConfig {
  patientName: string;
  dateRange: string;
  includeSections: {
    summary: boolean;
    biomarkers: boolean;
    trends: boolean;
    alerts: boolean;
    insights: boolean;
  };
  includeCharts: boolean;
  doctorName: string;
  clinicName: string;
  notes: string;
}

interface ReportSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const reportSections: ReportSection[] = [
  {
    id: 'summary',
    label: 'Executive Summary',
    icon: <FileBarChart className="w-4 h-4" />,
    description: 'Overview of health metrics and key findings',
  },
  {
    id: 'biomarkers',
    label: 'Biomarker Details',
    icon: <Heart className="w-4 h-4" />,
    description: 'Complete breakdown of all biomarkers by category',
  },
  {
    id: 'trends',
    label: 'Trend Analysis',
    icon: <TrendingUp className="w-4 h-4" />,
    description: 'Historical trends and predictions',
  },
  {
    id: 'alerts',
    label: 'Risk Alerts',
    icon: <AlertCircle className="w-4 h-4" />,
    description: 'Out-of-range values and health concerns',
  },
  {
    id: 'insights',
    label: 'Health Insights',
    icon: <Activity className="w-4 h-4" />,
    description: 'Personalized recommendations',
  },
];

export default function ReportGeneratorModal({
  isOpen,
  onClose,
  biomarkers,
  patientName = 'Patient',
}: ReportGeneratorModalProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationComplete, setGenerationComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const chartsContainerRef = useRef<HTMLDivElement>(null);

  // Report configuration state
  const [config, setConfig] = useState<ReportConfig>({
    patientName,
    dateRange: 'Last 90 Days',
    includeSections: {
      summary: true,
      biomarkers: true,
      trends: true,
      alerts: true,
      insights: true,
    },
    includeCharts: true,
    doctorName: '',
    clinicName: '',
    notes: '',
  });

  // Calculate report statistics
  const stats = {
    totalBiomarkers: biomarkers.length,
    inRange: biomarkers.filter(
      (b) => b.value >= b.normalRange.min && b.value <= b.normalRange.max
    ).length,
    outOfRange: biomarkers.filter(
      (b) => b.value < b.normalRange.min || b.value > b.normalRange.max
    ).length,
    categories: [...new Set(biomarkers.map((b) => b.category))].length,
  };

  const handleConfigChange = (key: keyof ReportConfig, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setGenerationComplete(false);
    setError(null);
  };

  const toggleSection = (sectionId: string) => {
    setConfig((prev) => ({
      ...prev,
      includeSections: {
        ...prev.includeSections,
        [sectionId]: !prev.includeSections[sectionId as keyof typeof prev.includeSections],
      },
    }));
    setGenerationComplete(false);
  };

  // Build ReportData from config
  const buildReportData = (): ReportData => ({
    biomarkers,
    options: {
      patientName: config.patientName,
      doctorName: config.doctorName || undefined,
      includeCharts: config.includeCharts,
      includeTrends: config.includeSections.trends,
      includeRecommendations: config.includeSections.insights,
    },
  });

  const handleDownload = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const reportData = buildReportData();
      await downloadHealthReport(reportData);
      setGenerationComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download report');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const reportData = buildReportData();
      await printHealthReport(reportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to print report');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Generate Health Report</h2>
              <p className="text-sm text-slate-500">Create a comprehensive PDF report</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Report Preview Stats */}
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-3">Report Preview</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-2xl font-bold text-slate-900">{stats.totalBiomarkers}</p>
                <p className="text-xs text-slate-500">Biomarkers</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-2xl font-bold text-emerald-600">{stats.inRange}</p>
                <p className="text-xs text-slate-500">In Range</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-2xl font-bold text-rose-600">{stats.outOfRange}</p>
                <p className="text-xs text-slate-500">Out of Range</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-2xl font-bold text-blue-600">{stats.categories}</p>
                <p className="text-xs text-slate-500">Categories</p>
              </div>
            </div>
          </div>

          {/* Patient Information */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <User className="w-4 h-4" />
              Patient Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Patient Name</label>
                <input
                  type="text"
                  value={config.patientName}
                  onChange={(e) => handleConfigChange('patientName', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="Enter patient name"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Date Range</label>
                <select
                  value={config.dateRange}
                  onChange={(e) => handleConfigChange('dateRange', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                >
                  <option value="Last 30 Days">Last 30 Days</option>
                  <option value="Last 90 Days">Last 90 Days</option>
                  <option value="Last 6 Months">Last 6 Months</option>
                  <option value="Last Year">Last Year</option>
                  <option value="All Time">All Time</option>
                </select>
              </div>
            </div>
          </div>

          {/* Report Sections */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <FileBarChart className="w-4 h-4" />
              Report Sections
            </h3>
            <div className="space-y-2">
              {reportSections.map((section) => (
                <label
                  key={section.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    config.includeSections[section.id as keyof typeof config.includeSections]
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={config.includeSections[section.id as keyof typeof config.includeSections]}
                    onChange={() => toggleSection(section.id)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {section.icon}
                      <span className="font-medium text-slate-900">{section.label}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{section.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Include Charts Toggle */}
          <label className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={config.includeCharts}
              onChange={(e) => handleConfigChange('includeCharts', e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <div className="flex-1">
              <p className="font-medium text-slate-900">Include Visual Charts</p>
              <p className="text-xs text-slate-500">
                Capture trend charts and visualizations in the report
              </p>
            </div>
          </label>

          {/* Advanced Options */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-slate-500" />
                <span className="font-medium text-slate-700">Advanced Options</span>
              </div>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showAdvanced && (
              <div className="p-4 pt-0 space-y-4 border-t border-slate-100">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Doctor Name</label>
                    <input
                      type="text"
                      value={config.doctorName}
                      onChange={(e) => handleConfigChange('doctorName', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Clinic/Hospital</label>
                    <input
                      type="text"
                      value={config.clinicName}
                      onChange={(e) => handleConfigChange('clinicName', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Additional Notes</label>
                  <textarea
                    value={config.notes}
                    onChange={(e) => handleConfigChange('notes', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                    rows={3}
                    placeholder="Add any notes to include in the report..."
                  />
                </div>
              </div>
            )}
          </div>

          {/* Status Messages */}
          {error && (
            <div className="flex items-center gap-3 p-4 bg-rose-50 text-rose-700 rounded-xl">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {generationComplete && !error && (
            <div className="flex items-center gap-3 p-4 bg-emerald-50 text-emerald-700 rounded-xl">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">Report generated successfully!</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            <button
              onClick={handleDownload}
              disabled={isGenerating}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/25"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Download PDF
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Hidden container for chart capture */}
      <div ref={chartsContainerRef} className="hidden" />
    </div>
  );
}
