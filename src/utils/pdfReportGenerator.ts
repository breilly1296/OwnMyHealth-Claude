/**
 * PDF Health Report Generator
 *
 * Generates comprehensive, doctor-friendly PDF health reports including:
 * - Patient information and report summary
 * - Biomarker tables with status indicators
 * - Trend analysis summaries
 * - Risk alerts and recommendations
 * - Charts and visualizations
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import type { Biomarker } from '../types';
import { analyzeTrend, detectRisks, generateInsights, type DataPoint } from './analytics';

export interface ReportOptions {
  patientName?: string;
  dateOfBirth?: string;
  reportDate?: string;
  doctorName?: string;
  includeCharts?: boolean;
  includeTrends?: boolean;
  includeRecommendations?: boolean;
  chartElement?: HTMLElement | null;
}

export interface ReportData {
  biomarkers: Biomarker[];
  options: ReportOptions;
}

// Color palette for the PDF
const COLORS = {
  primary: [59, 130, 246] as [number, number, number], // Blue
  success: [16, 185, 129] as [number, number, number], // Green
  warning: [245, 158, 11] as [number, number, number], // Amber
  danger: [239, 68, 68] as [number, number, number], // Red
  text: [30, 41, 59] as [number, number, number], // Slate 800
  textLight: [100, 116, 139] as [number, number, number], // Slate 500
  border: [226, 232, 240] as [number, number, number], // Slate 200
  background: [248, 250, 252] as [number, number, number], // Slate 50
};

// Helper to get biomarker status
function getBiomarkerStatus(biomarker: Biomarker): 'normal' | 'low' | 'high' {
  if (biomarker.value < biomarker.normalRange.min) return 'low';
  if (biomarker.value > biomarker.normalRange.max) return 'high';
  return 'normal';
}

// Helper to format date
function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Get biomarker data as DataPoints
function getBiomarkerData(biomarker: Biomarker): DataPoint[] {
  const history = biomarker.history || [];
  const data: DataPoint[] = history.map(h => ({
    date: h.date,
    value: h.value,
  }));
  data.push({ date: biomarker.date, value: biomarker.value });
  return data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// Group biomarkers by category
function groupByCategory(biomarkers: Biomarker[]): Record<string, Biomarker[]> {
  return biomarkers.reduce((acc, b) => {
    if (!acc[b.category]) acc[b.category] = [];
    acc[b.category].push(b);
    return acc;
  }, {} as Record<string, Biomarker[]>);
}

/**
 * Generate a comprehensive health report PDF
 */
export async function generateHealthReport(data: ReportData): Promise<jsPDF> {
  const { biomarkers, options } = data;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPosition = margin;

  // ==========================================
  // COVER PAGE / HEADER
  // ==========================================

  // Header background
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 45, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Health Report', margin, 25);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Comprehensive Biomarker Analysis', margin, 35);

  // Report info box
  yPosition = 55;
  doc.setFillColor(...COLORS.background);
  doc.roundedRect(margin, yPosition, pageWidth - 2 * margin, 35, 3, 3, 'F');

  doc.setTextColor(...COLORS.text);
  doc.setFontSize(10);

  const reportDate = options.reportDate || new Date().toISOString();
  const infoCol1X = margin + 5;
  const infoCol2X = pageWidth / 2 + 10;

  doc.setFont('helvetica', 'bold');
  doc.text('Patient:', infoCol1X, yPosition + 10);
  doc.text('Date of Birth:', infoCol1X, yPosition + 18);
  doc.text('Report Date:', infoCol2X, yPosition + 10);
  doc.text('Prepared For:', infoCol2X, yPosition + 18);

  doc.setFont('helvetica', 'normal');
  doc.text(options.patientName || 'Not specified', infoCol1X + 25, yPosition + 10);
  doc.text(options.dateOfBirth || 'Not specified', infoCol1X + 35, yPosition + 18);
  doc.text(formatDate(reportDate), infoCol2X + 30, yPosition + 10);
  doc.text(options.doctorName || 'Healthcare Provider', infoCol2X + 35, yPosition + 18);

  // Disclaimer
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textLight);
  doc.text(
    'This report is for informational purposes only and does not constitute medical advice.',
    infoCol1X,
    yPosition + 28
  );

  // ==========================================
  // EXECUTIVE SUMMARY
  // ==========================================

  yPosition = 100;
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', margin, yPosition);

  yPosition += 8;

  // Calculate summary statistics
  const outOfRange = biomarkers.filter(b => getBiomarkerStatus(b) !== 'normal');
  const highValues = biomarkers.filter(b => getBiomarkerStatus(b) === 'high');
  const lowValues = biomarkers.filter(b => getBiomarkerStatus(b) === 'low');
  const normalValues = biomarkers.filter(b => getBiomarkerStatus(b) === 'normal');

  // Get trends for biomarkers with history
  const biomarkersWithTrends = biomarkers
    .filter(b => (b.history?.length || 0) >= 2)
    .map(b => {
      const data = getBiomarkerData(b);
      const trend = analyzeTrend(data, b.normalRange.min, b.normalRange.max);
      return { biomarker: b, trend };
    });

  const improving = biomarkersWithTrends.filter(t => t.trend.direction === 'improving').length;
  const declining = biomarkersWithTrends.filter(t => t.trend.direction === 'declining').length;

  // Summary cards
  const cardWidth = (pageWidth - 2 * margin - 15) / 4;
  const cards = [
    { label: 'Total Biomarkers', value: biomarkers.length.toString(), color: COLORS.primary },
    { label: 'Within Range', value: normalValues.length.toString(), color: COLORS.success },
    { label: 'Above Range', value: highValues.length.toString(), color: COLORS.danger },
    { label: 'Below Range', value: lowValues.length.toString(), color: COLORS.warning },
  ];

  cards.forEach((card, idx) => {
    const x = margin + idx * (cardWidth + 5);
    doc.setFillColor(...card.color);
    doc.roundedRect(x, yPosition, cardWidth, 20, 2, 2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(card.value, x + cardWidth / 2, yPosition + 10, { align: 'center' });

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(card.label, x + cardWidth / 2, yPosition + 16, { align: 'center' });
  });

  yPosition += 30;

  // Summary text
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  let summaryText = `This report analyzes ${biomarkers.length} biomarkers. `;

  if (outOfRange.length === 0) {
    summaryText += 'All values are within normal ranges. ';
  } else {
    summaryText += `${outOfRange.length} value(s) are outside normal ranges and may require attention. `;
  }

  if (improving > 0) {
    summaryText += `${improving} marker(s) show improving trends. `;
  }
  if (declining > 0) {
    summaryText += `${declining} marker(s) show declining trends that should be monitored. `;
  }

  const splitSummary = doc.splitTextToSize(summaryText, pageWidth - 2 * margin);
  doc.text(splitSummary, margin, yPosition);
  yPosition += splitSummary.length * 5 + 5;

  // ==========================================
  // BIOMARKER TABLES BY CATEGORY (ALL VALUES)
  // ==========================================

  yPosition += 5;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Complete Biomarker Results', margin, yPosition);
  yPosition += 3;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.textLight);
  doc.text('All recorded values for each biomarker, sorted by date (most recent first)', margin, yPosition + 4);
  yPosition += 10;

  const groupedBiomarkers = groupByCategory(biomarkers);

  for (const [category, categoryBiomarkers] of Object.entries(groupedBiomarkers)) {
    // Check if we need a new page
    if (yPosition > pageHeight - 60) {
      doc.addPage();
      yPosition = margin;
    }

    // Category header
    doc.setFillColor(...COLORS.primary);
    doc.roundedRect(margin, yPosition, pageWidth - 2 * margin, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(category, margin + 5, yPosition + 7);

    // Show count of biomarkers in category
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`(${categoryBiomarkers.length} biomarkers)`, pageWidth - margin - 5, yPosition + 7, { align: 'right' });
    yPosition += 14;

    // For each biomarker in category, show ALL values (current + history)
    for (const biomarker of categoryBiomarkers) {
      if (yPosition > pageHeight - 50) {
        doc.addPage();
        yPosition = margin;
      }

      // Biomarker name header
      doc.setFillColor(...COLORS.background);
      doc.roundedRect(margin, yPosition, pageWidth - 2 * margin, 8, 2, 2, 'F');
      doc.setTextColor(...COLORS.text);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(biomarker.name, margin + 3, yPosition + 5.5);

      // Show normal range in header
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.textLight);
      const rangeText = `Normal: ${biomarker.normalRange.min} - ${biomarker.normalRange.max} ${biomarker.unit}`;
      doc.text(rangeText, pageWidth - margin - 3, yPosition + 5.5, { align: 'right' });
      yPosition += 10;

      // Get all values: current + history, sorted by date (newest first)
      const allValues: Array<{ date: string; value: number }> = [];

      // Add current value
      allValues.push({ date: biomarker.date, value: biomarker.value });

      // Add historical values
      if (biomarker.history && biomarker.history.length > 0) {
        biomarker.history.forEach(h => {
          allValues.push({ date: h.date, value: h.value });
        });
      }

      // Sort by date (newest first)
      allValues.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Build table data with all values
      const tableData = allValues.map((entry, idx) => {
        const status = entry.value < biomarker.normalRange.min ? 'Low' :
                       entry.value > biomarker.normalRange.max ? 'High' : 'Normal';
        const isCurrent = idx === 0 ? '●' : '';

        // Calculate change from previous value if available
        let changeText = '-';
        if (idx < allValues.length - 1) {
          const prevValue = allValues[idx + 1].value;
          const change = entry.value - prevValue;
          const percentChange = prevValue !== 0 ? ((change / prevValue) * 100).toFixed(1) : '0';
          changeText = change >= 0 ? `+${change.toFixed(1)} (+${percentChange}%)` : `${change.toFixed(1)} (${percentChange}%)`;
        }

        return [
          isCurrent,
          formatDate(entry.date),
          `${entry.value} ${biomarker.unit}`,
          status,
          changeText,
        ];
      });

      autoTable(doc, {
        startY: yPosition,
        head: [['', 'Date', 'Value', 'Status', 'Change']],
        body: tableData,
        margin: { left: margin, right: margin },
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [100, 116, 139], // Slate 500
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 35 },
          2: { cellWidth: 35, halign: 'center' },
          3: { cellWidth: 25, halign: 'center' },
          4: { cellWidth: 45, halign: 'center' },
        },
        didParseCell: (data) => {
          // Color the current indicator
          if (data.column.index === 0 && data.section === 'body' && data.cell.raw === '●') {
            data.cell.styles.textColor = COLORS.primary;
            data.cell.styles.fontStyle = 'bold';
          }
          // Color the status column based on value
          if (data.column.index === 3 && data.section === 'body') {
            const status = data.cell.raw as string;
            if (status === 'High') {
              data.cell.styles.textColor = COLORS.danger;
              data.cell.styles.fontStyle = 'bold';
            } else if (status === 'Low') {
              data.cell.styles.textColor = COLORS.warning;
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = COLORS.success;
            }
          }
          // Color the change column
          if (data.column.index === 4 && data.section === 'body') {
            const change = data.cell.raw as string;
            if (change.startsWith('+')) {
              data.cell.styles.textColor = COLORS.success;
            } else if (change.startsWith('-')) {
              data.cell.styles.textColor = COLORS.danger;
            }
          }
        },
      });

      yPosition = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }

    yPosition += 4; // Extra space between categories
  }

  // ==========================================
  // TREND ANALYSIS SECTION
  // ==========================================

  if (options.includeTrends !== false && biomarkersWithTrends.length > 0) {
    if (yPosition > pageHeight - 80) {
      doc.addPage();
      yPosition = margin;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.text);
    doc.text('Trend Analysis', margin, yPosition);
    yPosition += 8;

    const trendData = biomarkersWithTrends.map(({ biomarker, trend }) => {
      const direction = trend.direction.charAt(0).toUpperCase() + trend.direction.slice(1);
      const change = trend.percentChange > 0 ? `+${trend.percentChange.toFixed(1)}%` : `${trend.percentChange.toFixed(1)}%`;
      const prediction = `${trend.prediction30d.toFixed(1)} ${biomarker.unit}`;

      return [
        biomarker.name,
        direction,
        change,
        prediction,
        biomarker.history?.length.toString() || '0',
      ];
    });

    autoTable(doc, {
      startY: yPosition,
      head: [['Biomarker', 'Trend', 'Change', '30-Day Prediction', 'Data Points']],
      body: trendData,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: COLORS.primary,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      didParseCell: (data) => {
        if (data.column.index === 1 && data.section === 'body') {
          const trend = data.cell.raw as string;
          if (trend === 'Improving') {
            data.cell.styles.textColor = COLORS.success;
            data.cell.styles.fontStyle = 'bold';
          } else if (trend === 'Declining') {
            data.cell.styles.textColor = COLORS.danger;
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });

    yPosition = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  // ==========================================
  // RISK ALERTS SECTION
  // ==========================================

  const allRisks: Array<{ biomarkerName: string; type: string; severity: string; message: string; recommendation: string }> = [];

  biomarkersWithTrends.forEach(({ biomarker, trend }) => {
    const data = getBiomarkerData(biomarker);
    const risks = detectRisks(
      biomarker.name,
      data,
      biomarker.normalRange.min,
      biomarker.normalRange.max,
      trend
    );
    allRisks.push(...risks);
  });

  if (allRisks.length > 0) {
    if (yPosition > pageHeight - 80) {
      doc.addPage();
      yPosition = margin;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.text);
    doc.text('Risk Alerts & Recommendations', margin, yPosition);
    yPosition += 8;

    // Sort by severity
    const sortedRisks = allRisks.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.severity as keyof typeof order] || 3) - (order[b.severity as keyof typeof order] || 3);
    });

    sortedRisks.slice(0, 6).forEach((risk) => {
      if (yPosition > pageHeight - 30) {
        doc.addPage();
        yPosition = margin;
      }

      const severityColor = risk.severity === 'high' ? COLORS.danger :
                           risk.severity === 'medium' ? COLORS.warning : COLORS.textLight;

      // Risk box
      doc.setFillColor(severityColor[0], severityColor[1], severityColor[2], 0.1);
      doc.roundedRect(margin, yPosition, pageWidth - 2 * margin, 18, 2, 2, 'F');

      doc.setDrawColor(...severityColor);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, yPosition, pageWidth - 2 * margin, 18, 2, 2, 'S');

      // Severity badge
      doc.setFillColor(...severityColor);
      doc.roundedRect(margin + 3, yPosition + 3, 18, 5, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text(risk.severity.toUpperCase(), margin + 12, yPosition + 6.5, { align: 'center' });

      // Risk content
      doc.setTextColor(...COLORS.text);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(risk.biomarkerName, margin + 25, yPosition + 6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(risk.message, margin + 25, yPosition + 11);

      doc.setTextColor(...COLORS.textLight);
      doc.text(`Recommendation: ${risk.recommendation}`, margin + 25, yPosition + 16);

      yPosition += 22;
    });
  }

  // ==========================================
  // HEALTH INSIGHTS SECTION
  // ==========================================

  if (options.includeRecommendations !== false) {
    const insights = generateInsights(
      biomarkersWithTrends.map(({ biomarker, trend }) => ({
        name: biomarker.name,
        data: getBiomarkerData(biomarker),
        normalMin: biomarker.normalRange.min,
        normalMax: biomarker.normalRange.max,
        trend,
      }))
    );

    if (insights.length > 0) {
      if (yPosition > pageHeight - 60) {
        doc.addPage();
        yPosition = margin;
      }

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.text);
      doc.text('Health Insights', margin, yPosition);
      yPosition += 8;

      insights.slice(0, 6).forEach((insight) => {
        if (yPosition > pageHeight - 25) {
          doc.addPage();
          yPosition = margin;
        }

        const insightColor = insight.type === 'improvement' ? COLORS.success :
                            insight.type === 'concern' ? COLORS.danger : COLORS.primary;

        doc.setFillColor(...insightColor);
        doc.circle(margin + 3, yPosition + 3, 2, 'F');

        doc.setTextColor(...COLORS.text);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(insight.title, margin + 8, yPosition + 4);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.textLight);
        const descLines = doc.splitTextToSize(insight.description, pageWidth - 2 * margin - 10);
        doc.text(descLines, margin + 8, yPosition + 10);

        yPosition += 8 + descLines.length * 4 + 5;
      });
    }
  }

  // ==========================================
  // CHARTS (if chart element provided)
  // ==========================================

  if (options.includeCharts !== false && options.chartElement) {
    try {
      doc.addPage();
      yPosition = margin;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.text);
      doc.text('Biomarker Trends Visualization', margin, yPosition);
      yPosition += 10;

      const canvas = await html2canvas(options.chartElement, {
        backgroundColor: '#ffffff',
        scale: 2,
      });

      const imgData = canvas.toDataURL('image/png');
      const imgWidth = pageWidth - 2 * margin;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      doc.addImage(imgData, 'PNG', margin, yPosition, imgWidth, Math.min(imgHeight, 150));
    } catch {
      // Chart capture failed, skip
    }
  }

  // ==========================================
  // FOOTER ON ALL PAGES
  // ==========================================

  const totalPages = doc.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Footer line
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);

    // Footer text
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textLight);
    doc.text(
      `OwnMyHealth Report - Generated ${formatDate(reportDate)}`,
      margin,
      pageHeight - 10
    );
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 10,
      { align: 'right' }
    );
  }

  return doc;
}

/**
 * Generate and download the health report PDF
 */
export async function downloadHealthReport(data: ReportData, filename?: string): Promise<void> {
  const doc = await generateHealthReport(data);
  const reportDate = new Date().toISOString().split('T')[0];
  const patientName = data.options.patientName?.replace(/\s+/g, '_') || 'Patient';
  const defaultFilename = `HealthReport_${patientName}_${reportDate}.pdf`;
  doc.save(filename || defaultFilename);
}

/**
 * Generate report as blob for preview or sharing
 */
export async function generateReportBlob(data: ReportData): Promise<Blob> {
  const doc = await generateHealthReport(data);
  return doc.output('blob');
}

/**
 * Open report in new window for printing
 */
export async function printHealthReport(data: ReportData): Promise<void> {
  const doc = await generateHealthReport(data);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank');
  if (printWindow) {
    printWindow.onload = () => {
      printWindow.print();
    };
  }
}
