/**
 * Insurance Utility Functions
 *
 * Helper functions for insurance plan display and formatting.
 * These are separated from sbcParser to avoid loading PDF.js unnecessarily.
 */

import type { InsurancePlan, InsuranceBenefit, CoverageDetails } from '../../types';

/**
 * Extract key plan features for display
 */
export function getKeyPlanFeatures(plan: InsurancePlan): {
  specialistCoverage?: InsuranceBenefit;
  imagingCoverage: InsuranceBenefit[];
  emergencyCoverage?: InsuranceBenefit;
  preventiveCoverage?: InsuranceBenefit;
  prescriptionCoverage?: InsuranceBenefit;
} {
  return {
    specialistCoverage: plan.benefits.find(b => b.category === 'Specialist Care'),
    imagingCoverage: plan.benefits.filter(b => b.category === 'Imaging'),
    emergencyCoverage: plan.benefits.find(b => b.category === 'Emergency Care'),
    preventiveCoverage: plan.benefits.find(b => b.category === 'Preventive Care'),
    prescriptionCoverage: plan.benefits.find(b => b.category === 'Prescription Drugs')
  };
}

/**
 * Format coverage details for display
 */
export function formatCoverageDisplay(coverage: CoverageDetails): string {
  if (!coverage.covered) return 'Not Covered';

  const parts: string[] = [];

  if (coverage.copay) {
    parts.push(`$${coverage.copay} copay`);
  }

  if (coverage.coinsurance) {
    parts.push(`${coverage.coinsurance}% coinsurance`);
  }

  if (coverage.coveragePercentage) {
    parts.push(`${coverage.coveragePercentage}% covered`);
  }

  if (coverage.deductible !== undefined) {
    parts.push('after deductible');
  }

  return parts.length > 0 ? parts.join(', ') : 'Covered';
}
