import type { MeasurementOption } from '../types';
import data from './measurementOptions.json';

/**
 * Comprehensive biomarker measurement options organized by category.
 * Data loaded from measurementOptions.json (24 categories, 200+ biomarkers).
 */
export const measurementOptions: Record<string, MeasurementOption[]> = data;

export const normalRangeSources = [
  'Mayo Clinic',
  'Quest Diagnostics',
  'LabCorp',
  'WHO',
  'DEXA Standards',
  'American Council on Exercise',
  'American Heart Association',
  'National Kidney Foundation',
  'American Diabetes Association',
  'Endocrine Society',
  'Custom'
];
