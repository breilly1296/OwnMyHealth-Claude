import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Biomarker } from '../../types';

export const exportToCSV = (biomarkers: Biomarker[]) => {
  const headers = ['Name', 'Value', 'Unit', 'Normal Range', 'Date', 'Description'];
  const rows = biomarkers.map(biomarker => [
    biomarker.name,
    biomarker.value.toString(),
    biomarker.unit,
    `${biomarker.normalRange.min} - ${biomarker.normalRange.max}`,
    new Date(biomarker.date).toLocaleDateString(),
    biomarker.description || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

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
    new Date(biomarker.date).toLocaleDateString(),
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