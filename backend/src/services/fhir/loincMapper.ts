/**
 * LOINC → OwnMyHealth Biomarker mapping.
 *
 * Covers the most common lab codes that come back from commercial FHIR
 * endpoints (Quest, Labcorp). Names and categories are chosen to match
 * the existing biomarker corpus in biomarkerPatterns.ts.
 *
 * When a FHIR Observation comes in with a LOINC code we don't have,
 * the caller falls back to the FHIR-provided display name and
 * category 'Other', and the unmapped code is logged so this table
 * can be expanded over time.
 *
 * Source references:
 * - LOINC Top 2000+ common lab codes: https://loinc.org/usage/obs/
 * - UCUM units: http://unitsofmeasure.org
 */

import { LOINC_SYSTEM } from './types.js';
import type { FHIRCodeableConcept } from './types.js';

export interface LOINCMapping {
  loincCode: string;
  loincDisplay: string;
  biomarkerName: string;
  category: string;
  defaultUnit: string;
}

/**
 * Static mapping table. Keys are LOINC codes (strings, not numbers —
 * some codes contain non-numeric characters like "2093-3").
 */
export const LOINC_MAP: Record<string, LOINCMapping> = {
  // ===== Lipid panel =====
  '2093-3': { loincCode: '2093-3', loincDisplay: 'Cholesterol [Mass/Vol]', biomarkerName: 'Total Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL' },
  '2085-9': { loincCode: '2085-9', loincDisplay: 'HDL Cholesterol [Mass/Vol]', biomarkerName: 'HDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL' },
  '13457-7': { loincCode: '13457-7', loincDisplay: 'LDL Cholesterol (calculated)', biomarkerName: 'LDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL' },
  '18262-6': { loincCode: '18262-6', loincDisplay: 'LDL Cholesterol (direct)', biomarkerName: 'LDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL' },
  '2571-8': { loincCode: '2571-8', loincDisplay: 'Triglycerides [Mass/Vol]', biomarkerName: 'Triglycerides', category: 'Lipids', defaultUnit: 'mg/dL' },
  '13458-5': { loincCode: '13458-5', loincDisplay: 'VLDL Cholesterol', biomarkerName: 'VLDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL' },
  '43396-1': { loincCode: '43396-1', loincDisplay: 'Non-HDL Cholesterol', biomarkerName: 'Non-HDL Cholesterol', category: 'Lipids', defaultUnit: 'mg/dL' },
  '9830-1': { loincCode: '9830-1', loincDisplay: 'Cholesterol/HDL ratio', biomarkerName: 'Cholesterol/HDL Ratio', category: 'Lipids', defaultUnit: 'ratio' },

  // ===== Glucose / diabetes =====
  '2345-7': { loincCode: '2345-7', loincDisplay: 'Glucose [Mass/Vol]', biomarkerName: 'Glucose', category: 'Blood', defaultUnit: 'mg/dL' },
  '1558-6': { loincCode: '1558-6', loincDisplay: 'Glucose, fasting', biomarkerName: 'Glucose (Fasting)', category: 'Blood', defaultUnit: 'mg/dL' },
  '4548-4': { loincCode: '4548-4', loincDisplay: 'Hemoglobin A1c/Hemoglobin.total', biomarkerName: 'HbA1c', category: 'Blood', defaultUnit: '%' },
  '17856-6': { loincCode: '17856-6', loincDisplay: 'Hemoglobin A1c (IFCC)', biomarkerName: 'HbA1c', category: 'Blood', defaultUnit: '%' },
  '20448-7': { loincCode: '20448-7', loincDisplay: 'Insulin, fasting', biomarkerName: 'Insulin', category: 'Hormones', defaultUnit: 'uIU/mL' },
  '2273-3': { loincCode: '2273-3', loincDisplay: 'C-peptide [Mass/Vol]', biomarkerName: 'C-Peptide', category: 'Hormones', defaultUnit: 'ng/mL' },

  // ===== CBC =====
  '6690-2': { loincCode: '6690-2', loincDisplay: 'WBC', biomarkerName: 'White Blood Cell Count', category: 'Blood', defaultUnit: '10*3/uL' },
  '789-8': { loincCode: '789-8', loincDisplay: 'RBC', biomarkerName: 'Red Blood Cell Count', category: 'Blood', defaultUnit: '10*6/uL' },
  '718-7': { loincCode: '718-7', loincDisplay: 'Hemoglobin', biomarkerName: 'Hemoglobin', category: 'Blood', defaultUnit: 'g/dL' },
  '4544-3': { loincCode: '4544-3', loincDisplay: 'Hematocrit', biomarkerName: 'Hematocrit', category: 'Blood', defaultUnit: '%' },
  '777-3': { loincCode: '777-3', loincDisplay: 'Platelets', biomarkerName: 'Platelets', category: 'Blood', defaultUnit: '10*3/uL' },
  '787-2': { loincCode: '787-2', loincDisplay: 'MCV', biomarkerName: 'MCV', category: 'Blood', defaultUnit: 'fL' },
  '785-6': { loincCode: '785-6', loincDisplay: 'MCH', biomarkerName: 'MCH', category: 'Blood', defaultUnit: 'pg' },
  '786-4': { loincCode: '786-4', loincDisplay: 'MCHC', biomarkerName: 'MCHC', category: 'Blood', defaultUnit: 'g/dL' },
  '788-0': { loincCode: '788-0', loincDisplay: 'RDW', biomarkerName: 'RDW', category: 'Blood', defaultUnit: '%' },

  // ===== Metabolic panel =====
  '2160-0': { loincCode: '2160-0', loincDisplay: 'Creatinine [Mass/Vol]', biomarkerName: 'Creatinine', category: 'Kidney Function', defaultUnit: 'mg/dL' },
  '3094-0': { loincCode: '3094-0', loincDisplay: 'Urea Nitrogen [Mass/Vol]', biomarkerName: 'BUN', category: 'Kidney Function', defaultUnit: 'mg/dL' },
  '33914-3': { loincCode: '33914-3', loincDisplay: 'GFR estimated', biomarkerName: 'eGFR', category: 'Kidney Function', defaultUnit: 'mL/min/1.73m2' },
  '48642-3': { loincCode: '48642-3', loincDisplay: 'GFR estimated (non-black)', biomarkerName: 'eGFR', category: 'Kidney Function', defaultUnit: 'mL/min/1.73m2' },
  '48643-1': { loincCode: '48643-1', loincDisplay: 'GFR estimated (black)', biomarkerName: 'eGFR', category: 'Kidney Function', defaultUnit: 'mL/min/1.73m2' },
  '2951-2': { loincCode: '2951-2', loincDisplay: 'Sodium [Moles/Vol]', biomarkerName: 'Sodium', category: 'Electrolytes', defaultUnit: 'mmol/L' },
  '2823-3': { loincCode: '2823-3', loincDisplay: 'Potassium [Moles/Vol]', biomarkerName: 'Potassium', category: 'Electrolytes', defaultUnit: 'mmol/L' },
  '2075-0': { loincCode: '2075-0', loincDisplay: 'Chloride [Moles/Vol]', biomarkerName: 'Chloride', category: 'Electrolytes', defaultUnit: 'mmol/L' },
  '2028-9': { loincCode: '2028-9', loincDisplay: 'Bicarbonate [Moles/Vol]', biomarkerName: 'Bicarbonate', category: 'Electrolytes', defaultUnit: 'mmol/L' },
  '17861-6': { loincCode: '17861-6', loincDisplay: 'Calcium [Mass/Vol]', biomarkerName: 'Calcium', category: 'Electrolytes', defaultUnit: 'mg/dL' },
  '1994-3': { loincCode: '1994-3', loincDisplay: 'Calcium, ionized', biomarkerName: 'Ionized Calcium', category: 'Electrolytes', defaultUnit: 'mmol/L' },
  '2777-1': { loincCode: '2777-1', loincDisplay: 'Phosphate [Mass/Vol]', biomarkerName: 'Phosphorus', category: 'Electrolytes', defaultUnit: 'mg/dL' },
  '2601-3': { loincCode: '2601-3', loincDisplay: 'Magnesium [Mass/Vol]', biomarkerName: 'Magnesium', category: 'Electrolytes', defaultUnit: 'mg/dL' },

  // ===== Liver =====
  '1742-6': { loincCode: '1742-6', loincDisplay: 'ALT', biomarkerName: 'ALT', category: 'Liver Function', defaultUnit: 'U/L' },
  '1920-8': { loincCode: '1920-8', loincDisplay: 'AST', biomarkerName: 'AST', category: 'Liver Function', defaultUnit: 'U/L' },
  '6768-6': { loincCode: '6768-6', loincDisplay: 'Alkaline Phosphatase', biomarkerName: 'Alkaline Phosphatase', category: 'Liver Function', defaultUnit: 'U/L' },
  '1975-2': { loincCode: '1975-2', loincDisplay: 'Total Bilirubin', biomarkerName: 'Total Bilirubin', category: 'Liver Function', defaultUnit: 'mg/dL' },
  '1968-7': { loincCode: '1968-7', loincDisplay: 'Direct Bilirubin', biomarkerName: 'Direct Bilirubin', category: 'Liver Function', defaultUnit: 'mg/dL' },
  '1751-7': { loincCode: '1751-7', loincDisplay: 'Albumin', biomarkerName: 'Albumin', category: 'Liver Function', defaultUnit: 'g/dL' },
  '2885-2': { loincCode: '2885-2', loincDisplay: 'Total Protein', biomarkerName: 'Total Protein', category: 'Liver Function', defaultUnit: 'g/dL' },
  '2324-2': { loincCode: '2324-2', loincDisplay: 'Gamma Glutamyl Transferase', biomarkerName: 'GGT', category: 'Liver Function', defaultUnit: 'U/L' },

  // ===== Thyroid =====
  '3016-3': { loincCode: '3016-3', loincDisplay: 'Thyrotropin (TSH)', biomarkerName: 'TSH', category: 'Thyroid', defaultUnit: 'mIU/L' },
  '3024-7': { loincCode: '3024-7', loincDisplay: 'Thyroxine (T4) Free', biomarkerName: 'Free T4', category: 'Thyroid', defaultUnit: 'ng/dL' },
  '3026-2': { loincCode: '3026-2', loincDisplay: 'Thyroxine (T4)', biomarkerName: 'Total T4', category: 'Thyroid', defaultUnit: 'ug/dL' },
  '3053-6': { loincCode: '3053-6', loincDisplay: 'Triiodothyronine (T3) Free', biomarkerName: 'Free T3', category: 'Thyroid', defaultUnit: 'pg/mL' },
  '3051-0': { loincCode: '3051-0', loincDisplay: 'Triiodothyronine (T3)', biomarkerName: 'Total T3', category: 'Thyroid', defaultUnit: 'ng/dL' },
  '8099-7': { loincCode: '8099-7', loincDisplay: 'Thyroid Peroxidase Antibody', biomarkerName: 'TPO Antibodies', category: 'Thyroid', defaultUnit: 'IU/mL' },

  // ===== Hormones =====
  '2986-8': { loincCode: '2986-8', loincDisplay: 'Testosterone, total', biomarkerName: 'Testosterone (Total)', category: 'Hormones', defaultUnit: 'ng/dL' },
  '2991-8': { loincCode: '2991-8', loincDisplay: 'Testosterone, free', biomarkerName: 'Free Testosterone', category: 'Hormones', defaultUnit: 'pg/mL' },
  '2243-4': { loincCode: '2243-4', loincDisplay: 'Estradiol', biomarkerName: 'Estradiol', category: 'Hormones', defaultUnit: 'pg/mL' },
  '2839-9': { loincCode: '2839-9', loincDisplay: 'Progesterone', biomarkerName: 'Progesterone', category: 'Hormones', defaultUnit: 'ng/mL' },
  '2143-6': { loincCode: '2143-6', loincDisplay: 'Cortisol', biomarkerName: 'Cortisol', category: 'Hormones', defaultUnit: 'ug/dL' },
  '2191-5': { loincCode: '2191-5', loincDisplay: 'DHEA-S', biomarkerName: 'DHEA-S', category: 'Hormones', defaultUnit: 'ug/dL' },
  '15067-2': { loincCode: '15067-2', loincDisplay: 'Follicle Stimulating Hormone', biomarkerName: 'FSH', category: 'Hormones', defaultUnit: 'mIU/mL' },
  '10501-5': { loincCode: '10501-5', loincDisplay: 'Luteinizing Hormone', biomarkerName: 'LH', category: 'Hormones', defaultUnit: 'mIU/mL' },
  '2996-7': { loincCode: '2996-7', loincDisplay: 'Sex Hormone Binding Globulin', biomarkerName: 'SHBG', category: 'Hormones', defaultUnit: 'nmol/L' },
  '2842-3': { loincCode: '2842-3', loincDisplay: 'Prolactin', biomarkerName: 'Prolactin', category: 'Hormones', defaultUnit: 'ng/mL' },
  '2731-8': { loincCode: '2731-8', loincDisplay: 'Parathyroid Hormone', biomarkerName: 'PTH', category: 'Hormones', defaultUnit: 'pg/mL' },

  // ===== Vitamins =====
  '1989-3': { loincCode: '1989-3', loincDisplay: '25-OH Vitamin D', biomarkerName: 'Vitamin D', category: 'Vitamins', defaultUnit: 'ng/mL' },
  '62292-8': { loincCode: '62292-8', loincDisplay: '25-OH Vitamin D (total)', biomarkerName: 'Vitamin D', category: 'Vitamins', defaultUnit: 'ng/mL' },
  '2132-9': { loincCode: '2132-9', loincDisplay: 'Vitamin B12', biomarkerName: 'Vitamin B12', category: 'Vitamins', defaultUnit: 'pg/mL' },
  '2284-8': { loincCode: '2284-8', loincDisplay: 'Folate, serum', biomarkerName: 'Folate', category: 'Vitamins', defaultUnit: 'ng/mL' },

  // ===== Iron studies =====
  '2498-4': { loincCode: '2498-4', loincDisplay: 'Iron [Mass/Vol]', biomarkerName: 'Iron', category: 'Blood', defaultUnit: 'ug/dL' },
  '2276-4': { loincCode: '2276-4', loincDisplay: 'Ferritin [Mass/Vol]', biomarkerName: 'Ferritin', category: 'Blood', defaultUnit: 'ng/mL' },
  '2500-7': { loincCode: '2500-7', loincDisplay: 'Iron binding capacity', biomarkerName: 'TIBC', category: 'Blood', defaultUnit: 'ug/dL' },
  '2502-3': { loincCode: '2502-3', loincDisplay: 'Transferrin saturation', biomarkerName: 'Transferrin Saturation', category: 'Blood', defaultUnit: '%' },

  // ===== Inflammation =====
  '1988-5': { loincCode: '1988-5', loincDisplay: 'C-Reactive Protein', biomarkerName: 'CRP', category: 'Inflammation Markers', defaultUnit: 'mg/L' },
  '30522-7': { loincCode: '30522-7', loincDisplay: 'C-Reactive Protein (high sensitivity)', biomarkerName: 'hs-CRP', category: 'Inflammation Markers', defaultUnit: 'mg/L' },
  '4537-7': { loincCode: '4537-7', loincDisplay: 'Erythrocyte Sedimentation Rate', biomarkerName: 'ESR', category: 'Inflammation Markers', defaultUnit: 'mm/h' },
  '13457-8': { loincCode: '13457-8', loincDisplay: 'Homocysteine', biomarkerName: 'Homocysteine', category: 'Inflammation Markers', defaultUnit: 'umol/L' },

  // ===== Cardiac =====
  '10839-9': { loincCode: '10839-9', loincDisplay: 'Troponin I', biomarkerName: 'Troponin I', category: 'Cardiac', defaultUnit: 'ng/mL' },
  '6598-7': { loincCode: '6598-7', loincDisplay: 'Troponin T', biomarkerName: 'Troponin T', category: 'Cardiac', defaultUnit: 'ng/mL' },
  '30934-4': { loincCode: '30934-4', loincDisplay: 'NT-proBNP', biomarkerName: 'NT-proBNP', category: 'Cardiac', defaultUnit: 'pg/mL' },
  '33762-6': { loincCode: '33762-6', loincDisplay: 'BNP', biomarkerName: 'BNP', category: 'Cardiac', defaultUnit: 'pg/mL' },

  // ===== Vital signs (sometimes come as Observations) =====
  '8480-6': { loincCode: '8480-6', loincDisplay: 'Systolic Blood Pressure', biomarkerName: 'Blood Pressure (Systolic)', category: 'Vital Signs', defaultUnit: 'mmHg' },
  '8462-4': { loincCode: '8462-4', loincDisplay: 'Diastolic Blood Pressure', biomarkerName: 'Blood Pressure (Diastolic)', category: 'Vital Signs', defaultUnit: 'mmHg' },
  '8867-4': { loincCode: '8867-4', loincDisplay: 'Heart Rate', biomarkerName: 'Heart Rate', category: 'Vital Signs', defaultUnit: 'bpm' },
  '29463-7': { loincCode: '29463-7', loincDisplay: 'Body Weight', biomarkerName: 'Weight', category: 'Vital Signs', defaultUnit: 'kg' },
  '8302-2': { loincCode: '8302-2', loincDisplay: 'Body Height', biomarkerName: 'Height', category: 'Vital Signs', defaultUnit: 'cm' },
  '39156-5': { loincCode: '39156-5', loincDisplay: 'BMI', biomarkerName: 'BMI', category: 'Vital Signs', defaultUnit: 'kg/m2' },
};

/**
 * Look up a FHIR CodeableConcept against the LOINC map. Returns the
 * mapping if any coding in the concept references a LOINC code we know,
 * or null for unknown codes.
 */
export function findLOINCMapping(concept: FHIRCodeableConcept): LOINCMapping | null {
  if (!concept.coding) return null;
  for (const coding of concept.coding) {
    if (coding.system === LOINC_SYSTEM && LOINC_MAP[coding.code]) {
      return LOINC_MAP[coding.code];
    }
  }
  return null;
}

/**
 * Extract the first LOINC coding from a CodeableConcept, regardless of
 * whether it's in our map. Used for unmapped-code fallback naming +
 * audit logging.
 */
export function extractLOINCCoding(concept: FHIRCodeableConcept): {
  code: string;
  display: string;
} | null {
  if (!concept.coding) return null;
  for (const coding of concept.coding) {
    if (coding.system === LOINC_SYSTEM) {
      return { code: coding.code, display: coding.display ?? coding.code };
    }
  }
  // Fall back to any coding or the concept text
  const first = concept.coding[0];
  if (first) return { code: first.code, display: first.display ?? first.code };
  if (concept.text) return { code: 'unknown', display: concept.text };
  return null;
}

/**
 * How many LOINC codes we currently have mapped. Exposed for unit
 * testing and for the /fhir/mapping-stats debugging endpoint.
 */
export function mappedLOINCCount(): number {
  return Object.keys(LOINC_MAP).length;
}
