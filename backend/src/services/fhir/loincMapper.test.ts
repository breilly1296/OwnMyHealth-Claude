/**
 * loincMapper guard tests — pin the FHIR dead-vitals cleanup.
 *
 * The six vital-sign LOINC codes were dead config: the sync only requests
 * category=laboratory Observations, so vitals were never fetched and these
 * mappings were never reachable (and the lab-shaped Biomarker model can't hold
 * intraday vitals anyway). These tests assert they stay unmapped so a future
 * contributor doesn't re-add a live-looking mapping.
 */

import { describe, it, expect } from 'vitest';
import { LOINC_MAP, findLOINCMapping } from './loincMapper.js';
import { LOINC_SYSTEM } from './types.js';
import type { FHIRCodeableConcept } from './types.js';

const VITAL_SIGN_CODES = ['8480-6', '8462-4', '8867-4', '29463-7', '8302-2', '39156-5'];

function loincConcept(code: string): FHIRCodeableConcept {
  return { coding: [{ system: LOINC_SYSTEM, code }] };
}

describe('loincMapper — vitals are intentionally not mapped (dead-vitals cleanup)', () => {
  it('has no LOINC_MAP entry categorized as "Vital Signs"', () => {
    const vitalEntries = Object.values(LOINC_MAP).filter((m) => m.category === 'Vital Signs');
    expect(vitalEntries).toEqual([]);
  });

  it('findLOINCMapping returns null for every vital-sign LOINC code', () => {
    for (const code of VITAL_SIGN_CODES) {
      expect(LOINC_MAP[code], `LOINC_MAP should not contain vital code ${code}`).toBeUndefined();
      expect(findLOINCMapping(loincConcept(code)), `vital code ${code} must not map`).toBeNull();
    }
  });

  it('still resolves real lab codes (regression: the deletion was surgical)', () => {
    // Total Cholesterol + HbA1c — representative lab panel codes that must remain.
    expect(findLOINCMapping(loincConcept('2093-3'))?.biomarkerName).toBe('Total Cholesterol');
    expect(findLOINCMapping(loincConcept('4548-4'))?.biomarkerName).toBe('HbA1c');
  });
});
