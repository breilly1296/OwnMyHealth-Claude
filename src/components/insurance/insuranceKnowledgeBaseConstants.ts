/**
 * Constants for InsuranceKnowledgeBase component
 */

import {
  Shield, FileText, Heart, Stethoscope, Pill, Activity,
  Building2, AlertCircle, Sparkles
} from 'lucide-react';
import type { BenefitCategory } from '../../utils/insurance/insuranceKnowledgeBase';

export const categoryIcons: Record<BenefitCategory, React.ElementType> = {
  primary_care: Stethoscope,
  specialist_care: Activity,
  emergency_care: AlertCircle,
  urgent_care: Heart,
  preventive_care: Shield,
  diagnostic_imaging: FileText,
  laboratory_tests: FileText,
  prescription_drugs: Pill,
  mental_health: Heart,
  maternity: Heart,
  surgery: Activity,
  hospital_stay: Building2,
  rehabilitation: Activity,
  durable_medical_equipment: Shield,
  home_health: Heart,
  skilled_nursing: Building2,
  vision: Activity,
  dental: Activity,
  alternative_medicine: Sparkles
};

export const categoryNames: Record<BenefitCategory, string> = {
  primary_care: 'Primary Care',
  specialist_care: 'Specialist Care',
  emergency_care: 'Emergency Care',
  urgent_care: 'Urgent Care',
  preventive_care: 'Preventive Care',
  diagnostic_imaging: 'Diagnostic Imaging',
  laboratory_tests: 'Lab Tests',
  prescription_drugs: 'Prescriptions',
  mental_health: 'Mental Health',
  maternity: 'Maternity',
  surgery: 'Surgery',
  hospital_stay: 'Hospital Stay',
  rehabilitation: 'Rehabilitation',
  durable_medical_equipment: 'Medical Equipment',
  home_health: 'Home Health',
  skilled_nursing: 'Skilled Nursing',
  vision: 'Vision',
  dental: 'Dental',
  alternative_medicine: 'Alternative Medicine'
};

export const popularSearches = [
  { label: 'Primary Care Visit', icon: Stethoscope, color: 'blue' as const },
  { label: 'Emergency Room', icon: AlertCircle, color: 'red' as const },
  { label: 'Prescriptions', icon: Pill, color: 'purple' as const },
  { label: 'Lab Tests', icon: FileText, color: 'green' as const }
];

export const tabs = [
  { id: 'search' as const, label: 'Search' },
  { id: 'browse' as const, label: 'Browse' },
  { id: 'compare' as const, label: 'Compare' },
  { id: 'insights' as const, label: 'Insights' }
];

export type TabType = 'search' | 'browse' | 'compare' | 'insights';
