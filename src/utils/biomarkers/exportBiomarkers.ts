import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Biomarker } from '../../types';
import { formatDateOnly } from '../format';

/**
 * Escape a single value for safe inclusion in a CSV cell. Two protections:
 *
 *  1. Formula injection — Excel / Google Sheets evaluate a cell as a formula
 *     when its first character is `=`, `+`, `-`, `@`, a tab, or a carriage
 *     return, even inside double quotes. Biomarker name/unit/description are
 *     free text extracted by OCR / Claude from user-uploaded lab reports, so
 *     they are attacker-influenceable — and this CSV is explicitly forwarded to
 *     a clinician. Prefix such values with a single quote to neutralize them.
 *  2. RFC 4180 — wrap every field in double quotes and double any embedded
 *     double quote, so commas, newlines, and quotes can't shift/corrupt columns.
 */
export const escapeCsvCell = (value: string): string => {
  let cell = value ?? '';
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  return `"${cell.replace(/"/g, '""')}"`;
};

/**
 * Build the CSV text for a set of biomarkers. Pure (no DOM) so it can be unit
 * tested directly; `exportToCSV` wraps it with the download side effects.
 */
export const buildBiomarkerCsv = (biomarkers: Biomarker[]): string => {
  const headers = ['Name', 'Value', 'Unit', 'Normal Range', 'Date', 'Description'];
  const rows = biomarkers.map(biomarker => [
    biomarker.name,
    biomarker.value.toString(),
    biomarker.unit,
    `${biomarker.normalRange.min} - ${biomarker.normalRange.max}`,
    formatDateOnly(biomarker.date, {}),
    biomarker.description || ''
  ]);

  // RFC 4180 records are CRLF-delimited.
  return [headers, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
};

export const exportToCSV = (biomarkers: Biomarker[]) => {
  const csvContent = buildBiomarkerCsv(biomarkers);

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `biomarkers_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToPDF = (biomarkers: Biomarker[]) => {
  const doc = new jsPDF();
  const tableColumn = ['Name', 'Value', 'Normal Range', 'Date', 'Description'];
  const tableRows = biomarkers.map(biomarker => [
    biomarker.name,
    `${biomarker.value} ${biomarker.unit}`,
    `${biomarker.normalRange.min} - ${biomarker.normalRange.max} ${biomarker.unit}`,
    formatDateOnly(biomarker.date, {}),
    biomarker.description || ''
  ]);

  doc.setFontSize(20);
  doc.text('Biomarker Report', 14, 15);
  doc.setFontSize(10);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 25);

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: 30,
    styles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 25 },
      2: { cellWidth: 30 },
      3: { cellWidth: 25 },
      4: { cellWidth: 'auto' }
    },
    headStyles: {
      fillColor: [66, 139, 202],
      textColor: 255,
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245]
    }
  });

  doc.save(`biomarkers_${new Date().toISOString().split('T')[0]}.pdf`);
};