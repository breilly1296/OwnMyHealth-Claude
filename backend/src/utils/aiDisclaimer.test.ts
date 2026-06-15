/**
 * Server-side AI disclaimer enforcement (teardown L33) unit tests.
 */

import { describe, it, expect } from 'vitest';
import { AI_DISCLAIMER, disclaimerToAppend } from './aiDisclaimer.js';

describe('disclaimerToAppend (L33)', () => {
  it('appends the canonical disclaimer when the text has none', () => {
    const tail = disclaimerToAppend('Your HDL is within the reference range.');
    expect(tail).not.toBeNull();
    expect(tail).toContain(AI_DISCLAIMER);
    expect(tail!.startsWith('\n\n')).toBe(true);
  });

  it('appends for an empty / failed response', () => {
    expect(disclaimerToAppend('')).not.toBeNull();
    expect(disclaimerToAppend('Unable to generate guidance')).not.toBeNull();
  });

  it('does NOT append when the canonical disclaimer is already present', () => {
    expect(disclaimerToAppend(`Some guidance.\n\n${AI_DISCLAIMER}`)).toBeNull();
  });

  it('does NOT double-append on an equivalent model-phrased disclaimer', () => {
    expect(
      disclaimerToAppend('Please consult your healthcare provider before changing medications.')
    ).toBeNull();
    expect(disclaimerToAppend('Always consult a health care professional.')).toBeNull();
    expect(disclaimerToAppend('Consult healthcare provider for diagnosis.')).toBeNull();
  });
});
