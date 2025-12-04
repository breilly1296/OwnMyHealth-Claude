import { Request } from 'express';

// User types
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  userScope?: {
    type: 'self' | 'provider' | 'admin';
    userId?: string;
    providerId?: string;
  };
  providerPatientRelationship?: {
    id: string;
    providerId: string;
    patientId: string;
    canViewBiomarkers: boolean;
    canViewInsurance: boolean;
    canViewDna: boolean;
    canViewHealthNeeds: boolean;
    canEditData: boolean;
    status: string;
  };
}

// Biomarker types
export interface Biomarker {
  id: string;
  userId: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  date: string;
  normalRange: {
    min: number;
    max: number;
    source: string;
  };
  description?: string;
  sourceFile?: string;
  extractionConfidence?: number;
  history?: Array<{ date: string; value: number }>;
}

export interface BiomarkerCreateInput {
  name: string;
  value: number;
  unit: string;
  category: string;
  date: string;
  normalRange: {
    min: number;
    max: number;
    source: string;
  };
  description?: string;
}

// Insurance types
export interface InsurancePlan {
  id: string;
  userId: string;
  planName: string;
  insurerName: string;
  planType: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';
  effectiveDate: string;
  premium: number;
  deductible: {
    individual: number;
    family: number;
  };
  outOfPocketMax: {
    individual: number;
    family: number;
  };
  benefits: InsuranceBenefit[];
}

export interface InsuranceBenefit {
  serviceName: string;
  inNetworkCoverage: {
    covered: boolean;
    copay?: number;
    coinsurance?: number;
    deductibleApplies: boolean;
  };
  outOfNetworkCoverage: {
    covered: boolean;
    copay?: number;
    coinsurance?: number;
    deductibleApplies: boolean;
  };
  limitations?: string;
  preAuthRequired: boolean;
}

// DNA types
export interface DNAVariant {
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
}

export interface DNAFileInfo {
  filename: string;
  source: string;
  uploadDate: string;
  totalVariants: number;
  validVariants: number;
}

// Health needs types
export interface HealthNeed {
  id: string;
  userId: string;
  type: 'condition' | 'action' | 'service';
  name: string;
  description: string;
  urgency: 'immediate' | 'urgent' | 'follow-up' | 'routine';
  status: 'pending' | 'in-progress' | 'completed';
  relatedBiomarkers?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta?: Record<string, unknown>;
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
}
