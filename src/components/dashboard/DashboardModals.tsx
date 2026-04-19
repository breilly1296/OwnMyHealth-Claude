/**
 * DashboardModals - Centralized modal management for the dashboard
 *
 * Renders all dashboard modals with lazy loading and consistent patterns.
 * Reduces complexity in the main Dashboard component.
 */

import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import type { Biomarker, InsurancePlan } from '../../types';
import type { ModalName } from '../../hooks/useModals';

// Lazy-loaded modal components
const TrendModal = lazy(() => import('../biomarkers/TrendModal'));
const AddMeasurementModal = lazy(() => import('../biomarkers/AddMeasurementModal'));
const BiomarkerInsurancePanel = lazy(() => import('../biomarkers/BiomarkerInsurancePanel'));
const PDFUploadModal = lazy(() => import('../upload/PDFUploadModal'));
const ClinicalFileUpload = lazy(() => import('../upload/ClinicalFileUpload'));
const LabUploadModal = lazy(() => import('../upload/LabUploadModal'));
const InsuranceSBCUpload = lazy(() => import('../insurance/InsuranceSBCUpload'));
const InsurancePlanViewer = lazy(() => import('../insurance/InsurancePlanViewer'));
const EnhancedInsuranceUpload = lazy(() => import('../insurance/EnhancedInsuranceUpload'));
const InsurancePlanCompare = lazy(() => import('../insurance/InsurancePlanCompare'));

/** Loading spinner shown while modal components load */
function ModalLoadSpinner() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-xl">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500 mx-auto" />
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Loading...</p>
      </div>
    </div>
  );
}

interface DashboardModalsProps {
  // Modal state
  isOpen: (name: ModalName) => boolean;
  close: (name: ModalName) => void;

  // Data
  selectedCategory: string;
  insurancePlans: InsurancePlan[];
  trendBiomarker: Biomarker | null;
  selectedBiomarkerForInsurance: Biomarker | null;

  // Handlers
  onAddMeasurement: (measurement: Partial<Biomarker>) => Promise<void>;
  onPDFExtract: (extractedBiomarkers: Partial<Biomarker>[]) => Promise<void>;
  onClinicalFileExtract: (extractedBiomarkers: Partial<Biomarker>[]) => void;
  onLabOCRSuccess: (extractedBiomarkers: {
    id: string;
    name: string;
    value: number;
    unit: string;
    category: string;
    isOutOfRange: boolean;
  }[]) => void;
  onInsurancePlanExtracted: (plan: InsurancePlan) => Promise<void>;
  onCloseTrendModal: () => void;
  onCloseInsurancePanel: () => void;
}

/**
 * Centralized modal container for the dashboard
 *
 * @example
 * <DashboardModals
 *   isOpen={modals.isOpen}
 *   close={modals.close}
 *   selectedCategory={selectedCategory}
 *   insurancePlans={insurancePlans}
 *   trendBiomarker={trendBiomarker}
 *   selectedBiomarkerForInsurance={selectedBiomarkerForInsurance}
 *   onAddMeasurement={handleAddMeasurement}
 *   onPDFExtract={handlePDFExtract}
 *   onClinicalFileExtract={handleClinicalFileExtract}
 *   onLabOCRSuccess={handleLabOCRSuccess}
 *   onInsurancePlanExtracted={handleInsurancePlanExtracted}
 *   onCloseTrendModal={() => {
 *     modals.close('trend');
 *     setTrendBiomarker(null);
 *   }}
 *   onCloseInsurancePanel={() => setSelectedBiomarkerForInsurance(null)}
 * />
 */
export function DashboardModals({
  isOpen,
  close,
  selectedCategory,
  insurancePlans,
  trendBiomarker,
  selectedBiomarkerForInsurance,
  onAddMeasurement,
  onPDFExtract,
  onClinicalFileExtract,
  onLabOCRSuccess,
  onInsurancePlanExtracted,
  onCloseTrendModal,
  onCloseInsurancePanel,
}: DashboardModalsProps) {
  return (
    <Suspense fallback={<ModalLoadSpinner />}>
      {/* Add Measurement Modal */}
      {isOpen('addMeasurement') && (
        <AddMeasurementModal
          isOpen={true}
          onClose={() => close('addMeasurement')}
          category={selectedCategory}
          onAdd={onAddMeasurement}
        />
      )}

      {/* PDF Upload Modal (Local OCR) */}
      {isOpen('pdfUpload') && (
        <PDFUploadModal
          isOpen={true}
          onClose={() => close('pdfUpload')}
          onExtract={onPDFExtract}
        />
      )}

      {/* Lab Upload Modal (Server OCR) */}
      {isOpen('labUpload') && (
        <LabUploadModal
          isOpen={true}
          onClose={() => close('labUpload')}
          onSuccess={onLabOCRSuccess}
        />
      )}

      {/* Clinical File Upload */}
      {isOpen('clinicalUpload') && (
        <ClinicalFileUpload
          isOpen={true}
          onClose={() => close('clinicalUpload')}
          onExtract={onClinicalFileExtract}
        />
      )}

      {/* Insurance SBC Upload */}
      {isOpen('sbcUpload') && (
        <InsuranceSBCUpload
          isOpen={true}
          onClose={() => close('sbcUpload')}
          onPlanExtracted={onInsurancePlanExtracted}
        />
      )}

      {/* Enhanced Insurance Upload */}
      {isOpen('enhancedUpload') && (
        <EnhancedInsuranceUpload
          isOpen={true}
          onClose={() => close('enhancedUpload')}
          onPlanExtracted={onInsurancePlanExtracted}
        />
      )}

      {/* Insurance Plan Viewer */}
      {isOpen('insuranceViewer') && (
        <InsurancePlanViewer
          plans={insurancePlans}
          isOpen={true}
          onClose={() => close('insuranceViewer')}
        />
      )}

      {/* Insurance Plan Compare */}
      {isOpen('knowledgeBase') && (
        <InsurancePlanCompare
          plans={insurancePlans}
          isOpen={true}
          onClose={() => close('knowledgeBase')}
        />
      )}

      {/* Trend Modal */}
      {trendBiomarker && isOpen('trend') && (
        <TrendModal
          isOpen={true}
          onClose={onCloseTrendModal}
          biomarker={trendBiomarker}
        />
      )}

      {/* Biomarker Insurance Panel */}
      {selectedBiomarkerForInsurance && (
        <BiomarkerInsurancePanel
          biomarker={selectedBiomarkerForInsurance}
          insurancePlans={insurancePlans}
          onClose={onCloseInsurancePanel}
        />
      )}
    </Suspense>
  );
}

export default DashboardModals;
