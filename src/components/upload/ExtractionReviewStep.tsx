/**
 * ExtractionReviewStep
 *
 * Shared review/correction step rendered inside the three upload modals
 * (PDFUploadModal, LabUploadModal, ClinicalFileUpload). Lets the user
 * inspect extracted biomarkers, edit values inline, deselect rows, and
 * confirm which subset to import.
 *
 * Not a modal itself — the hosting component owns the dialog frame.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  Loader2,
  Pencil,
} from 'lucide-react';

export type ExtractionSource = 'claude' | 'ocr' | 'client-parse';

export interface ExtractedBiomarkerPreview {
  id: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  isOutOfRange: boolean;
  referenceRange?: { min: number; max: number };
  confidence: number;
  selected: boolean;
  edited: boolean;
  originalValue?: number;
  source: ExtractionSource;
}

interface ExtractionReviewStepProps {
  biomarkers: ExtractedBiomarkerPreview[];
  labName?: string;
  reportDate?: string;
  extractionConfidence: number;
  onConfirmImport: (selectedBiomarkers: ExtractedBiomarkerPreview[]) => void;
  onCancel: () => void;
  isImporting: boolean;
}

type SortKey = 'confidence' | 'category' | 'name';

const LOW_CONFIDENCE_THRESHOLD = 0.7;
const HIGH_CONFIDENCE_THRESHOLD = 0.9;

function confidenceClasses(confidence: number): string {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  }
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  }
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

function recomputeIsOutOfRange(value: number, range?: { min: number; max: number }): boolean {
  if (!range) return false;
  return value < range.min || value > range.max;
}

export default function ExtractionReviewStep({
  biomarkers,
  labName,
  reportDate,
  extractionConfidence,
  onConfirmImport,
  onCancel,
  isImporting,
}: ExtractionReviewStepProps) {
  const [rows, setRows] = useState<ExtractedBiomarkerPreview[]>(biomarkers);
  const [editingField, setEditingField] = useState<{ id: string; field: 'name' | 'value' | 'unit' } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('confidence');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const firstLowConfidenceRef = useRef<HTMLDivElement | null>(null);

  // Reset local state whenever the upstream biomarker list changes
  // (e.g., user uploads a different file after cancelling to dropzone).
  useEffect(() => {
    setRows(biomarkers);
  }, [biomarkers]);

  // Auto-scroll to the first low-confidence row on mount/update.
  useEffect(() => {
    if (firstLowConfidenceRef.current) {
      firstLowConfidenceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [rows.length]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.category));
    return Array.from(set).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filtered = activeCategory
      ? rows.filter((r) => r.category === activeCategory)
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'confidence') return a.confidence - b.confidence;
      if (sortKey === 'category') return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [rows, activeCategory, sortKey]);

  const selectedCount = rows.filter((r) => r.selected).length;
  const lowConfidenceCount = rows.filter((r) => r.confidence < LOW_CONFIDENCE_THRESHOLD).length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  const firstLowConfidenceId = useMemo(() => {
    const target = visibleRows.find((r) => r.confidence < LOW_CONFIDENCE_THRESHOLD);
    return target?.id ?? null;
  }, [visibleRows]);

  const toggleSelected = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)));
  };

  const toggleAll = () => {
    const target = !allSelected;
    setRows((prev) => prev.map((r) => ({ ...r, selected: target })));
  };

  const updateField = (id: string, field: 'name' | 'value' | 'unit', raw: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (field === 'value') {
          const parsed = parseFloat(raw);
          if (Number.isNaN(parsed)) return r;
          const originalValue = r.originalValue ?? r.value;
          const edited = parsed !== originalValue;
          return {
            ...r,
            value: parsed,
            originalValue,
            edited: edited || r.edited,
            isOutOfRange: recomputeIsOutOfRange(parsed, r.referenceRange),
          };
        }
        if (field === 'name') {
          return { ...r, name: raw, edited: true };
        }
        if (field === 'unit') {
          return { ...r, unit: raw, edited: true };
        }
        return r;
      })
    );
  };

  const handleConfirm = () => {
    onConfirmImport(rows.filter((r) => r.selected));
  };

  const overallConfidencePercent = Math.round(extractionConfidence * 100);

  return (
    <div className="flex flex-col w-full">
      {/* Header metadata */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          {labName && (
            <div className="flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span className="font-medium">{labName}</span>
            </div>
          )}
          {reportDate && (
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>{new Date(reportDate).toLocaleDateString()}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Confidence</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${confidenceClasses(extractionConfidence)}`}>
              {overallConfidencePercent}%
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">· {rows.length} found</span>
          </div>
        </div>
      </div>

      {/* Low-confidence banner */}
      {lowConfidenceCount > 0 && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">
            {lowConfidenceCount} biomarker{lowConfidenceCount === 1 ? '' : 's'} have low extraction confidence — please verify the highlighted value{lowConfidenceCount === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {/* Filter pills + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            activeCategory === null
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              activeCategory === cat
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            {cat}
          </button>
        ))}

        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Sort</span>
          <div className="relative">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="appearance-none pl-2 pr-7 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs"
            >
              <option value="confidence">Confidence (low first)</option>
              <option value="category">Category</option>
              <option value="name">Name</option>
            </select>
            <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </label>
      </div>

      {/* Select-all toolbar */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 mb-2">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
        </label>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {selectedCount} of {rows.length} selected
        </span>
      </div>

      {/* Biomarker rows — table on md+, cards on mobile */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:grid grid-cols-[auto_1fr_1.4fr_0.8fr_1fr_0.9fr] gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <div></div>
          <div>Biomarker</div>
          <div>Value</div>
          <div>Unit</div>
          <div>Reference</div>
          <div className="text-right">Confidence</div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[50vh] overflow-y-auto">
          {visibleRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No biomarkers match the current filter.
            </div>
          ) : (
            visibleRows.map((row) => {
              const isLow = row.confidence < LOW_CONFIDENCE_THRESHOLD;
              const isFirstLow = row.id === firstLowConfidenceId;
              return (
                <div
                  key={row.id}
                  ref={isFirstLow ? firstLowConfidenceRef : undefined}
                  className={`
                    grid md:grid-cols-[auto_1fr_1.4fr_0.8fr_1fr_0.9fr] gap-2 items-center px-3 py-3 text-sm
                    ${isLow ? 'bg-red-50/60 dark:bg-red-900/10' : 'bg-white dark:bg-slate-800'}
                    ${!row.selected ? 'opacity-60' : ''}
                  `}
                >
                  {/* Row 1: checkbox + name (stacked on mobile) */}
                  <div className="flex md:block items-center md:items-start gap-3">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={() => toggleSelected(row.id)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>

                  {/* Name + category */}
                  <div className="min-w-0">
                    {editingField?.id === row.id && editingField.field === 'name' ? (
                      <input
                        autoFocus
                        value={row.name}
                        onChange={(e) => updateField(row.id, 'name', e.target.value)}
                        onBlur={() => setEditingField(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') setEditingField(null);
                        }}
                        className="w-full px-2 py-1 rounded-md border border-blue-400 dark:border-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingField({ id: row.id, field: 'name' })}
                        className="group inline-flex items-center gap-1 text-left font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        <span className="truncate">{row.name}</span>
                        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex-shrink-0" />
                      </button>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {row.category}
                      </span>
                      {row.edited && (
                        <span className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400">edited</span>
                      )}
                    </div>
                  </div>

                  {/* Value (editable) */}
                  <div className="flex flex-wrap items-center gap-2">
                    {editingField?.id === row.id && editingField.field === 'value' ? (
                      <input
                        autoFocus
                        type="number"
                        step="any"
                        value={row.value}
                        onChange={(e) => updateField(row.id, 'value', e.target.value)}
                        onBlur={() => setEditingField(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') setEditingField(null);
                        }}
                        className="w-24 px-2 py-1 rounded-md border border-blue-400 dark:border-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingField({ id: row.id, field: 'value' })}
                        className={`
                          group inline-flex items-center gap-1 font-semibold
                          ${row.isOutOfRange ? 'text-orange-600 dark:text-orange-400' : 'text-slate-900 dark:text-white'}
                          hover:text-blue-600 dark:hover:text-blue-400 transition-colors
                        `}
                      >
                        <span>{row.value}</span>
                        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                    {row.edited && row.originalValue !== undefined && row.originalValue !== row.value && (
                      <span className="text-xs text-slate-400 dark:text-slate-500 line-through">
                        {row.originalValue}
                      </span>
                    )}
                    {row.isOutOfRange && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                        out of range
                      </span>
                    )}
                  </div>

                  {/* Unit (editable) */}
                  <div>
                    {editingField?.id === row.id && editingField.field === 'unit' ? (
                      <input
                        autoFocus
                        value={row.unit}
                        onChange={(e) => updateField(row.id, 'unit', e.target.value)}
                        onBlur={() => setEditingField(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') setEditingField(null);
                        }}
                        className="w-20 px-2 py-1 rounded-md border border-blue-400 dark:border-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingField({ id: row.id, field: 'unit' })}
                        className="group inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        <span>{row.unit}</span>
                        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </div>

                  {/* Reference range */}
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {row.referenceRange ? (
                      <span>
                        {row.referenceRange.min} – {row.referenceRange.max} {row.unit}
                      </span>
                    ) : (
                      <span className="italic">none</span>
                    )}
                  </div>

                  {/* Confidence */}
                  <div className="md:text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${confidenceClasses(row.confidence)}`}>
                      {Math.round(row.confidence * 100)}%
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={isImporting}
          className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isImporting || selectedCount === 0}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isImporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Importing…
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Import {selectedCount} selected
            </>
          )}
        </button>
      </div>
    </div>
  );
}
