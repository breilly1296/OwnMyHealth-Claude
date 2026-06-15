/**
 * Per-analyte trend DIRECTIONALITY (DV-3 / JC-2).
 *
 * Whether a *rising* value is clinically good, bad, or neither is a property of
 * the analyte, not of any single reading — so it lives here as a code-side map,
 * not as a per-row DB column (which would drift across a user's history).
 *
 *   higherIsBetter — rising is good (HDL, eGFR, Vitamin D, O2 sat, Omega-3)
 *   lowerIsBetter  — rising is bad  (LDL, glucose, HbA1c, CRP, creatinine, …)
 *   targetBand     — in-range is best, BOTH extremes are bad (electrolytes,
 *                    TSH, CBC indices, INR, BMI). band defaults to the
 *                    biomarker's normalRange.
 *   unknown        — no confident call → the classifier uses the same
 *                    in-range-band rule as targetBand. This is the SAFE default:
 *                    crossing the clinician-provided range is direction-agnostic,
 *                    whereas the old "toward the range midpoint = improving"
 *                    heuristic was wrong for one-sided analytes (it called a
 *                    falling HDL "improving").
 *
 * Only clinically-unambiguous analytes are listed; anything not here resolves to
 * `unknown` and is still classified safely. Genuinely ambiguous markers
 * (ferritin/iron — deficiency AND overload; sex-dependent hormones; fat-soluble
 * vitamins with toxicity) are deliberately left as targetBand/unknown rather
 * than guessed. A new analyte never silently gets a wrong direction.
 */

import type { BiomarkerDirection } from '../types';

interface DirectionEntry {
  direction: BiomarkerDirection;
  /** Optional explicit band; defaults to the biomarker's normalRange. */
  targetBand?: { low: number; high: number };
}

// Keys are lowercased analyte names. Resolution is case-insensitive.
const BIOMARKER_DIRECTION: Record<string, DirectionEntry> = {
  // ── Higher is better ─────────────────────────────────────────────────────
  'hdl cholesterol': { direction: 'higherIsBetter' },
  apoa1: { direction: 'higherIsBetter' },
  'hdl-p': { direction: 'higherIsBetter' },
  'hdl large': { direction: 'higherIsBetter' },
  egfr: { direction: 'higherIsBetter' },
  'vitamin d 25-oh': { direction: 'higherIsBetter' },
  'vitamin d 1,25-oh': { direction: 'higherIsBetter' },
  'vitamin c': { direction: 'higherIsBetter' },
  'o2 saturation': { direction: 'higherIsBetter' },
  'o2 saturation (abg)': { direction: 'higherIsBetter' },
  'omega-3 index': { direction: 'higherIsBetter' },
  epa: { direction: 'higherIsBetter' },
  dha: { direction: 'higherIsBetter' },

  // ── Lower is better ──────────────────────────────────────────────────────
  'total cholesterol': { direction: 'lowerIsBetter' },
  'ldl cholesterol': { direction: 'lowerIsBetter' },
  triglycerides: { direction: 'lowerIsBetter' },
  vldl: { direction: 'lowerIsBetter' },
  'non-hdl cholesterol': { direction: 'lowerIsBetter' },
  'chol/hdl ratio': { direction: 'lowerIsBetter' },
  'ldl/hdl ratio': { direction: 'lowerIsBetter' },
  'triglyceride/hdl ratio': { direction: 'lowerIsBetter' },
  apob: { direction: 'lowerIsBetter' },
  'apob/apoa1 ratio': { direction: 'lowerIsBetter' },
  'lp(a)': { direction: 'lowerIsBetter' },
  'ldl-p': { direction: 'lowerIsBetter' },
  sdldl: { direction: 'lowerIsBetter' },
  'oxidized ldl': { direction: 'lowerIsBetter' },
  'remnant cholesterol': { direction: 'lowerIsBetter' },
  'glucose (fasting)': { direction: 'lowerIsBetter' },
  'glucose (random)': { direction: 'lowerIsBetter' },
  hba1c: { direction: 'lowerIsBetter' },
  'fasting insulin': { direction: 'lowerIsBetter' },
  'homa-ir': { direction: 'lowerIsBetter' },
  fructosamine: { direction: 'lowerIsBetter' },
  crp: { direction: 'lowerIsBetter' },
  'hs-crp': { direction: 'lowerIsBetter' },
  esr: { direction: 'lowerIsBetter' },
  'il-6': { direction: 'lowerIsBetter' },
  'tnf-alpha': { direction: 'lowerIsBetter' },
  procalcitonin: { direction: 'lowerIsBetter' },
  homocysteine: { direction: 'lowerIsBetter' },
  'methylmalonic acid': { direction: 'lowerIsBetter' },
  'troponin i': { direction: 'lowerIsBetter' },
  'troponin t': { direction: 'lowerIsBetter' },
  'hs-troponin i': { direction: 'lowerIsBetter' },
  bnp: { direction: 'lowerIsBetter' },
  'nt-probnp': { direction: 'lowerIsBetter' },
  ck: { direction: 'lowerIsBetter' },
  'ck-mb': { direction: 'lowerIsBetter' },
  myoglobin: { direction: 'lowerIsBetter' },
  lactate: { direction: 'lowerIsBetter' },
  bun: { direction: 'lowerIsBetter' },
  creatinine: { direction: 'lowerIsBetter' },
  'cystatin c': { direction: 'lowerIsBetter' },
  microalbumin: { direction: 'lowerIsBetter' },
  ast: { direction: 'lowerIsBetter' },
  alt: { direction: 'lowerIsBetter' },
  alp: { direction: 'lowerIsBetter' },
  ggt: { direction: 'lowerIsBetter' },
  'total bilirubin': { direction: 'lowerIsBetter' },
  'uric acid': { direction: 'lowerIsBetter' },
  psa: { direction: 'lowerIsBetter' },
  'd-dimer': { direction: 'lowerIsBetter' },
  'visceral fat': { direction: 'lowerIsBetter' },

  // ── Target band (in-range best, both extremes bad) ───────────────────────
  sodium: { direction: 'targetBand' },
  potassium: { direction: 'targetBand' },
  chloride: { direction: 'targetBand' },
  bicarbonate: { direction: 'targetBand' },
  'anion gap': { direction: 'targetBand' },
  osmolality: { direction: 'targetBand' },
  calcium: { direction: 'targetBand' },
  'ionized calcium': { direction: 'targetBand' },
  magnesium: { direction: 'targetBand' },
  phosphorus: { direction: 'targetBand' },
  phosphate: { direction: 'targetBand' },
  tsh: { direction: 'targetBand' },
  'free t4': { direction: 'targetBand' },
  'free t3': { direction: 'targetBand' },
  'total t4': { direction: 'targetBand' },
  'total t3': { direction: 'targetBand' },
  hemoglobin: { direction: 'targetBand' },
  hematocrit: { direction: 'targetBand' },
  rbc: { direction: 'targetBand' },
  wbc: { direction: 'targetBand' },
  platelets: { direction: 'targetBand' },
  mcv: { direction: 'targetBand' },
  mch: { direction: 'targetBand' },
  mchc: { direction: 'targetBand' },
  albumin: { direction: 'targetBand' },
  'total protein': { direction: 'targetBand' },
  inr: { direction: 'targetBand' },
  bmi: { direction: 'targetBand' },
  'body fat percentage': { direction: 'targetBand' },
};

/**
 * Resolve a biomarker's trend directionality by name (case-insensitive).
 * Unlisted names resolve to `unknown`, which the classifier treats with the
 * safe in-range-band rule — never the old toward-midpoint heuristic.
 */
export function getBiomarkerDirection(name: string): DirectionEntry {
  return BIOMARKER_DIRECTION[name.trim().toLowerCase()] ?? { direction: 'unknown' };
}

/** Test/diagnostic accessor — the set of explicitly-mapped analyte keys. */
export function mappedDirectionKeys(): string[] {
  return Object.keys(BIOMARKER_DIRECTION);
}
