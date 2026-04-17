/**
 * C-7 regression tests for phiRedaction.
 *
 * Covers: the expanded pattern set (email, NPI, DEA, ZIP, labeled name)
 * plus the `firedPatterns` reporting contract, plus regression guards
 * that biomarker-like content survives the scrubber.
 */

import { describe, expect, it } from 'vitest';
import { redactPHI, stripPHIFromText } from './phiRedaction.js';

describe('redactPHI (C-7)', () => {
  it('redacts SSN', () => {
    const { text, firedPatterns } = redactPHI('SSN: 123-45-6789 is sensitive');
    expect(text).toContain('[SSN_REDACTED]');
    expect(text).not.toContain('123-45-6789');
    expect(firedPatterns).toContain('SSN');
  });

  it('redacts email addresses', () => {
    const { text, firedPatterns } = redactPHI('Contact: jane.doe@example.com');
    expect(text).toContain('[EMAIL_REDACTED]');
    expect(text).not.toContain('jane.doe@example.com');
    expect(firedPatterns).toContain('Email');
  });

  it('redacts labeled patient name (two-word form)', () => {
    const { text, firedPatterns } = redactPHI('Patient Name: Jane M Doe\nDOB: 01/15/1980');
    expect(text).toContain('[NAME_REDACTED]');
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('Doe');
    expect(firedPatterns).toContain('Patient name labeled');
  });

  it('redacts NPI', () => {
    const { text, firedPatterns } = redactPHI('NPI: 1234567890');
    expect(text).toContain('[NPI_REDACTED]');
    expect(text).not.toContain('1234567890');
    expect(firedPatterns).toContain('NPI');
  });

  it('redacts DEA', () => {
    const { text, firedPatterns } = redactPHI('DEA: AB1234567');
    expect(text).toContain('[DEA_REDACTED]');
    expect(text).not.toContain('AB1234567');
    expect(firedPatterns).toContain('DEA');
  });

  it('redacts ZIP codes', () => {
    const { text, firedPatterns } = redactPHI('Address: Brooklyn NY 11215');
    expect(text).toContain('[ZIP_REDACTED]');
    expect(firedPatterns).toContain('ZIP');
  });

  it('redacts 5+4 ZIP codes', () => {
    const { text } = redactPHI('11215-1234');
    expect(text).toContain('[ZIP_REDACTED]');
  });

  it('redacts DOB labeled (DOB: 01/15/1980)', () => {
    const { text, firedPatterns } = redactPHI('DOB: 01/15/1980');
    expect(text).toContain('[DOB_REDACTED]');
    expect(text).not.toContain('01/15/1980');
    expect(firedPatterns).toContain('DOB labeled');
  });

  it('redacts phone numbers', () => {
    const { text, firedPatterns } = redactPHI('Call (555) 123-4567 for results');
    expect(text).toContain('[PHONE_REDACTED]');
    expect(firedPatterns).toContain('Phone US');
  });

  it('redacts street addresses', () => {
    const { text, firedPatterns } = redactPHI('123 Main Street, Apt 4');
    expect(text).toContain('[ADDRESS_REDACTED]');
    expect(firedPatterns).toContain('Street address');
  });

  it('preserves biomarker-like content (regression guard)', () => {
    const { text, firedPatterns } = redactPHI('Glucose 95 mg/dL (reference: 70-100)');
    expect(text).toContain('Glucose');
    expect(text).toContain('95');
    expect(text).toContain('mg/dL');
    expect(firedPatterns).toEqual([]);
  });

  it('preserves lab collection date (not labeled as DOB)', () => {
    // Pattern "Collected: 04/15/2026" should NOT fire DOB patterns.
    const { text, firedPatterns } = redactPHI('Collected: 04/15/2026');
    expect(text).toContain('04/15/2026');
    expect(firedPatterns).not.toContain('DOB labeled');
    expect(firedPatterns).not.toContain('DOB contextual');
  });

  it('reports fired patterns without leaking original content', () => {
    const { firedPatterns } = redactPHI(
      'Patient: John M Smith\nDOB: 05/05/1980\nSSN: 111-22-3333\nPhone: 555-123-4567\nEmail: john@example.com'
    );
    expect(firedPatterns).toEqual(
      expect.arrayContaining(['SSN', 'Phone US', 'DOB labeled', 'Patient name labeled', 'Email'])
    );
    // The report itself must not carry the raw values.
    const serialized = JSON.stringify(firedPatterns);
    expect(serialized).not.toContain('111-22-3333');
    expect(serialized).not.toContain('John');
    expect(serialized).not.toContain('john@example.com');
  });

  it('handles empty input', () => {
    const { text, firedPatterns } = redactPHI('');
    expect(text).toBe('');
    expect(firedPatterns).toEqual([]);
  });

  it('returns original when nothing matches', () => {
    const clean = 'CBC panel: WBC 7.2, RBC 4.5, HGB 14.1';
    const { text, firedPatterns } = redactPHI(clean);
    expect(text).toBe(clean);
    expect(firedPatterns).toEqual([]);
  });
});

describe('stripPHIFromText (backward-compat)', () => {
  it('still returns a string and still redacts', () => {
    const result = stripPHIFromText('SSN: 123-45-6789');
    expect(typeof result).toBe('string');
    expect(result).toContain('[SSN_REDACTED]');
  });
});
