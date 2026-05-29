/**
 * Insurance Utility Functions
 *
 * Helper functions for insurance plan display and formatting.
 * These are separated from sbcParser to avoid loading PDF.js unnecessarily.
 */

import type { InsurancePlan, InsuranceBenefit, InsuranceCost, CoverageDetails } from '../../types';

/**
 * Transform flat API fields into the benefits/costs array structure for UI display.
 * The backend returns flat fields (e.g., copaySpecialist, physicalTherapyCopay),
 * but the UI components expect nested arrays (benefits[], costs[]).
 */
export function transformPlanForDisplay(plan: InsurancePlan): InsurancePlan {
  // If benefits/costs are already populated, don't overwrite
  if (plan.benefits && plan.benefits.length > 0) {
    return plan;
  }

  const benefits: InsuranceBenefit[] = [];
  const costs: InsuranceCost[] = [];

  // Build costs array from flat fields
  if (plan.deductibleIndividual) {
    costs.push({
      id: `${plan.id}-ded-ind`,
      type: 'Deductible',
      amount: plan.deductibleIndividual,
      frequency: 'Annual',
      description: 'Annual deductible for individual coverage',
      appliesTo: 'Individual',
    });
  }
  if (plan.deductibleFamily) {
    costs.push({
      id: `${plan.id}-ded-fam`,
      type: 'Deductible',
      amount: plan.deductibleFamily,
      frequency: 'Annual',
      description: 'Annual deductible for family coverage',
      appliesTo: 'Family',
    });
  }
  if (plan.oopMaxIndividual) {
    costs.push({
      id: `${plan.id}-oop-ind`,
      type: 'Out-of-Pocket Maximum',
      amount: plan.oopMaxIndividual,
      frequency: 'Annual',
      description: 'Maximum out-of-pocket costs per year',
      appliesTo: 'Individual',
    });
  }
  if (plan.oopMaxFamily) {
    costs.push({
      id: `${plan.id}-oop-fam`,
      type: 'Out-of-Pocket Maximum',
      amount: plan.oopMaxFamily,
      frequency: 'Annual',
      description: 'Maximum out-of-pocket costs per year for family',
      appliesTo: 'Family',
    });
  }
  if (plan.premiumMonthly) {
    costs.push({
      id: `${plan.id}-prem`,
      type: 'Premium',
      amount: plan.premiumMonthly,
      frequency: 'Monthly',
      description: 'Monthly premium payment',
      appliesTo: 'Individual',
    });
  }

  // Helper to create a benefit entry
  const addBenefit = (
    category: InsuranceBenefit['category'],
    serviceName: string,
    copay?: number,
    coinsurance?: number,
    limit?: number,
    limitType?: string
  ) => {
    if (copay === undefined && coinsurance === undefined) return;

    const description = limit
      ? `${serviceName} - ${limit} ${limitType || 'visits'} per year`
      : serviceName;

    benefits.push({
      id: `${plan.id}-${serviceName.toLowerCase().replace(/\s+/g, '-')}`,
      category,
      serviceName,
      description,
      inNetworkCoverage: {
        covered: true,
        copay,
        coinsurance,
      },
      priorAuthRequired: plan.priorAuthRequirements?.some(r =>
        r.toLowerCase().includes(serviceName.toLowerCase())
      ),
    });
  };

  // Primary Care
  addBenefit('Primary Care', 'Primary Care Visit', plan.copayPrimaryCare);
  addBenefit('Primary Care', 'Telehealth Visit', plan.copayTelehealth);

  // Specialist Care
  addBenefit('Specialist Care', 'Specialist Visit', plan.copaySpecialist);

  // Urgent/Emergency Care
  addBenefit('Urgent Care', 'Urgent Care Visit', plan.copayUrgentCare);
  addBenefit('Emergency Care', 'Emergency Room', plan.copayEmergency);
  addBenefit('Emergency Care', 'Ground Ambulance', plan.ambulanceGroundCopay, plan.ambulanceGroundCoinsurance);
  addBenefit('Emergency Care', 'Air Ambulance', plan.ambulanceAirCopay, plan.ambulanceAirCoinsurance);

  // Preventive Care (fully covered, copay shown as "--" until cost calculator is built)
  if (plan.preventiveServicesList && plan.preventiveServicesList.length > 0) {
    benefits.push({
      id: `${plan.id}-preventive`,
      category: 'Preventive Care',
      serviceName: 'Preventive Services',
      description: plan.preventiveServicesList.slice(0, 3).join(', '),
      inNetworkCoverage: { covered: true },
    });
  }

  // Diagnostic Tests / Imaging
  addBenefit('Imaging', 'X-Ray', plan.copayXray);
  addBenefit('Imaging', 'Advanced Imaging (CT/MRI/PET)', plan.copayAdvancedImaging);
  addBenefit('Lab Tests', 'Lab Work', plan.copayLabWork);

  // Hospital Care
  addBenefit('Hospital Stay', 'Inpatient Hospital', plan.inpatientHospitalCopay, plan.inpatientHospitalCoinsurance);
  addBenefit('Surgery', 'Outpatient Surgery', plan.outpatientSurgeryCopay, plan.outpatientSurgeryCoinsurance);
  addBenefit('Hospital Stay', 'Skilled Nursing Facility', plan.skilledNursingCopay, plan.skilledNursingCoinsurance, plan.skilledNursingDaysLimit, 'days');

  // Mental Health
  addBenefit('Mental Health', 'Inpatient Mental Health', plan.inpatientMentalHealthCopay, plan.inpatientMentalCoinsurance);
  addBenefit('Mental Health', 'Outpatient Mental Health', plan.outpatientMentalHealthCopay, plan.outpatientMentalCoinsurance);

  // Maternity
  addBenefit('Maternity', 'Maternity Care', plan.maternityCopay, plan.maternityCoinsurance);

  // Rehabilitation/Therapy
  addBenefit('Rehabilitation', 'Physical Therapy', plan.physicalTherapyCopay, undefined, plan.physicalTherapyVisitsLimit, 'visits');
  addBenefit('Rehabilitation', 'Occupational Therapy', plan.occupationalTherapyCopay, undefined, plan.occupationalTherapyVisitsLimit, 'visits');
  addBenefit('Rehabilitation', 'Speech Therapy', plan.speechTherapyCopay, undefined, plan.speechTherapyVisitsLimit, 'visits');
  addBenefit('Rehabilitation', 'Chiropractic Care', plan.chiropracticCopay, undefined, plan.chiropracticVisitsLimit, 'visits');
  addBenefit('Rehabilitation', 'Acupuncture', plan.acupunctureCopay, undefined, plan.acupunctureVisitsLimit, 'visits');
  addBenefit('Rehabilitation', 'Cardiac Rehabilitation', plan.cardiacRehabCopay, undefined, plan.cardiacRehabVisitsLimit, 'visits');
  addBenefit('Rehabilitation', 'Pulmonary Rehabilitation', plan.pulmonaryRehabCopay, undefined, plan.pulmonaryRehabVisitsLimit, 'visits');

  // Prescription Drugs
  if (plan.rxTier1Copay !== undefined || plan.rxTier2Copay !== undefined ||
      plan.rxTier3Copay !== undefined || plan.rxTier4Copay !== undefined) {
    const rxParts: string[] = [];
    if (plan.rxTier1Copay !== undefined) rxParts.push(`Tier 1: $${plan.rxTier1Copay}`);
    if (plan.rxTier2Copay !== undefined) rxParts.push(`Tier 2: $${plan.rxTier2Copay}`);
    if (plan.rxTier3Copay !== undefined) rxParts.push(`Tier 3: $${plan.rxTier3Copay}`);
    if (plan.rxTier4Copay !== undefined) rxParts.push(`Tier 4: $${plan.rxTier4Copay}`);

    let supplyInfo = '';
    if (plan.rxRetailDaysSupply) supplyInfo += `Retail: ${plan.rxRetailDaysSupply}-day supply`;
    if (plan.rxMailOrderDaysSupply) supplyInfo += `${supplyInfo ? ', ' : ''}Mail Order: ${plan.rxMailOrderDaysSupply}-day supply`;

    benefits.push({
      id: `${plan.id}-rx`,
      category: 'Prescription Drugs',
      serviceName: 'Prescription Drugs',
      description: `${rxParts.join(', ')}${supplyInfo ? `. ${supplyInfo}` : ''}`,
      inNetworkCoverage: {
        covered: true,
        copay: plan.rxTier1Copay,
      },
    });
  }

  // DME
  addBenefit('Other', 'Durable Medical Equipment', plan.dmeCopay, plan.dmeCoinsurance);

  // Home Health
  addBenefit('Other', 'Home Health Care', plan.homeHealthVisitCopay, plan.homeHealthVisitCoinsurance, plan.homeHealthVisitLimit, 'visits');

  return {
    ...plan,
    // Always coerce to arrays. The InsurancePlan type declares benefits/costs
    // as required arrays, but a sparsely-extracted plan can have empty locally
    // built arrays AND undefined incoming plan.benefits/plan.costs — returning
    // undefined here crashed consumers that iterate them (BiomarkerInsurancePanel,
    // BiomarkerActionPlan).
    benefits: benefits.length > 0 ? benefits : (plan.benefits ?? []),
    costs: costs.length > 0 ? costs : (plan.costs ?? []),
    limitations: plan.limitations || [],
    network: plan.network || { geographicCoverage: [] },
  };
}

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
