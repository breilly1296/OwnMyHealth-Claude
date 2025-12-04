/**
 * BiomarkerSummary Component Tests
 *
 * Tests the biomarker summary panel that displays statistics for a health category.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BiomarkerSummary from '../../components/biomarkers/BiomarkerSummary';
import type { Biomarker } from '../../types';

// Helper function to create test biomarkers
const createBiomarker = (overrides: Partial<Biomarker> = {}): Biomarker => ({
  id: crypto.randomUUID(),
  name: 'Test Biomarker',
  value: 50,
  unit: 'mg/dL',
  date: '2024-01-15',
  category: 'Blood',
  normalRange: { min: 40, max: 60, source: 'Standard' },
  description: 'Test description',
  history: [],
  ...overrides,
});

describe('BiomarkerSummary', () => {
  describe('Rendering', () => {
    it('should render all summary cards', () => {
      const biomarkers = [createBiomarker()];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      expect(screen.getByText('Tracked')).toBeInTheDocument();
      expect(screen.getByText('In Range')).toBeInTheDocument();
      expect(screen.getByText('Attention')).toBeInTheDocument();
    });

    it('should display total count of biomarkers in category', () => {
      const biomarkers = [
        createBiomarker({ category: 'Blood' }),
        createBiomarker({ category: 'Blood' }),
        createBiomarker({ category: 'Blood' }),
        createBiomarker({ category: 'Vitamins' }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Should show 3 for Blood category - find it in the Tracked section
      const trackedSection = screen.getByText('Tracked').closest('div')?.parentElement;
      expect(trackedSection?.textContent).toContain('3');
    });

    it('should display count of biomarkers in normal range', () => {
      const biomarkers = [
        createBiomarker({ value: 50, normalRange: { min: 40, max: 60, source: 'Standard' } }),
        createBiomarker({ value: 55, normalRange: { min: 40, max: 60, source: 'Standard' } }),
        createBiomarker({ value: 80, normalRange: { min: 40, max: 60, source: 'Standard' } }), // Out of range
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // 2 should be in range
      const inRangeSection = screen.getByText('In Range').closest('div')?.parentElement;
      expect(inRangeSection?.textContent).toContain('2');
    });

    it('should display count of biomarkers out of range', () => {
      const biomarkers = [
        createBiomarker({ value: 50, normalRange: { min: 40, max: 60, source: 'Standard' } }),
        createBiomarker({ value: 30, normalRange: { min: 40, max: 60, source: 'Standard' } }), // Below range
        createBiomarker({ value: 80, normalRange: { min: 40, max: 60, source: 'Standard' } }), // Above range
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // 2 should need attention (out of range)
      const attentionSection = screen.getByText('Attention').closest('div')?.parentElement;
      expect(attentionSection?.textContent).toContain('2');
    });
  });

  describe('Percentage Calculation', () => {
    it('should show 100% healthy when all biomarkers are in range', () => {
      const biomarkers = [
        createBiomarker({ value: 50, normalRange: { min: 40, max: 60, source: 'Standard' } }),
        createBiomarker({ value: 55, normalRange: { min: 40, max: 60, source: 'Standard' } }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      expect(screen.getByText(/100% healthy/i)).toBeInTheDocument();
    });

    it('should show 50% healthy when half are in range', () => {
      const biomarkers = [
        createBiomarker({ value: 50, normalRange: { min: 40, max: 60, source: 'Standard' } }),
        createBiomarker({ value: 80, normalRange: { min: 40, max: 60, source: 'Standard' } }), // Out
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      expect(screen.getByText(/50% healthy/i)).toBeInTheDocument();
    });

    it('should show 0% healthy when none are in range', () => {
      const biomarkers = [
        createBiomarker({ value: 20, normalRange: { min: 40, max: 60, source: 'Standard' } }), // Below
        createBiomarker({ value: 80, normalRange: { min: 40, max: 60, source: 'Standard' } }), // Above
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      expect(screen.getByText(/0% healthy/i)).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show 0 tracked when no biomarkers in category', () => {
      const biomarkers = [createBiomarker({ category: 'Vitamins' })];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Should show 0 tracked biomarkers for Blood
      const trackedSection = screen.getByText('Tracked').closest('div')?.parentElement;
      expect(trackedSection?.textContent).toContain('0');
    });

    it('should show 100% healthy when no biomarkers (edge case)', () => {
      render(<BiomarkerSummary biomarkers={[]} category="Blood" />);

      // Default to 100% when no biomarkers
      expect(screen.getByText(/100% healthy/i)).toBeInTheDocument();
    });

    it('should show "All Clear" status when no out of range biomarkers', () => {
      const biomarkers = [
        createBiomarker({ value: 50, normalRange: { min: 40, max: 60, source: 'Standard' } }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      expect(screen.getByText('All Clear')).toBeInTheDocument();
      expect(screen.getByText(/within normal range/i)).toBeInTheDocument();
    });
  });

  describe('Latest Concern Display', () => {
    it('should display the most recent out-of-range biomarker', () => {
      const biomarkers = [
        createBiomarker({
          name: 'Older Issue',
          value: 80,
          date: '2024-01-01',
          normalRange: { min: 40, max: 60, source: 'Standard' },
        }),
        createBiomarker({
          name: 'Recent Issue',
          value: 90,
          date: '2024-01-15',
          normalRange: { min: 40, max: 60, source: 'Standard' },
        }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      expect(screen.getByText('Recent Issue')).toBeInTheDocument();
      expect(screen.getByText('Latest Concern')).toBeInTheDocument();
    });

    it('should show value with unit for out-of-range biomarker', () => {
      const biomarkers = [
        createBiomarker({
          name: 'High Glucose',
          value: 150,
          unit: 'mg/dL',
          normalRange: { min: 70, max: 100, source: 'Standard' },
        }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      expect(screen.getByText(/150/)).toBeInTheDocument();
      expect(screen.getByText(/mg\/dL/)).toBeInTheDocument();
    });

    it('should indicate "Low" for values below normal range', () => {
      const biomarkers = [
        createBiomarker({
          name: 'Low Iron',
          value: 30,
          normalRange: { min: 50, max: 100, source: 'Standard' },
        }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Text is "(Low)" in the component
      expect(screen.getByText('(Low)')).toBeInTheDocument();
    });

    it('should indicate "High" for values above normal range', () => {
      const biomarkers = [
        createBiomarker({
          name: 'High Cholesterol',
          value: 250,
          normalRange: { min: 100, max: 200, source: 'Standard' },
        }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Text is "(High)" in the component
      expect(screen.getByText('(High)')).toBeInTheDocument();
    });
  });

  describe('Category Filtering', () => {
    it('should only count biomarkers matching the category', () => {
      const biomarkers = [
        createBiomarker({ category: 'Blood', value: 50 }),
        createBiomarker({ category: 'Blood', value: 55 }),
        createBiomarker({ category: 'Vitamins', value: 30 }),
        createBiomarker({ category: 'Hormones', value: 10 }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Only 2 Blood biomarkers
      const trackedSection = screen.getByText('Tracked').closest('div')?.parentElement;
      expect(trackedSection?.textContent).toContain('2');
    });

    it('should work with different categories', () => {
      const biomarkers = [
        createBiomarker({ category: 'Vitamins', value: 50 }),
        createBiomarker({ category: 'Vitamins', value: 55 }),
        createBiomarker({ category: 'Vitamins', value: 60 }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Vitamins" />);

      const trackedSection = screen.getByText('Tracked').closest('div')?.parentElement;
      expect(trackedSection?.textContent).toContain('3');
    });
  });

  describe('Boundary Values', () => {
    it('should treat value equal to min as in range', () => {
      const biomarkers = [
        createBiomarker({ value: 40, normalRange: { min: 40, max: 60, source: 'Standard' } }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Should be in range
      expect(screen.getByText('All Clear')).toBeInTheDocument();
    });

    it('should treat value equal to max as in range', () => {
      const biomarkers = [
        createBiomarker({ value: 60, normalRange: { min: 40, max: 60, source: 'Standard' } }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Should be in range
      expect(screen.getByText('All Clear')).toBeInTheDocument();
    });

    it('should treat value just below min as out of range', () => {
      const biomarkers = [
        createBiomarker({ value: 39.9, normalRange: { min: 40, max: 60, source: 'Standard' } }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Should show Latest Concern
      expect(screen.getByText('Latest Concern')).toBeInTheDocument();
    });

    it('should treat value just above max as out of range', () => {
      const biomarkers = [
        createBiomarker({ value: 60.1, normalRange: { min: 40, max: 60, source: 'Standard' } }),
      ];
      render(<BiomarkerSummary biomarkers={biomarkers} category="Blood" />);

      // Should show Latest Concern
      expect(screen.getByText('Latest Concern')).toBeInTheDocument();
    });
  });
});
