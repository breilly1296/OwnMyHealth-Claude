/**
 * API Service Layer
 *
 * Handles all communication with the backend API.
 * PHI data is only fetched when needed and not persisted in memory.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

// User-friendly error messages
const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Unable to connect to the server. Please check your internet connection and try again.',
  TIMEOUT_ERROR: 'The request took too long to complete. Please try again.',
  UNAUTHORIZED: 'Your session has expired. Please log in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again later.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

/**
 * Get user-friendly error message based on status code or error type
 */
function getUserFriendlyMessage(status: number, serverMessage?: string): string {
  // If server provided a specific message, use it for client errors
  if (serverMessage && status >= 400 && status < 500) {
    return serverMessage;
  }

  switch (status) {
    case 0:
      return ERROR_MESSAGES.NETWORK_ERROR;
    case 401:
      return ERROR_MESSAGES.UNAUTHORIZED;
    case 403:
      return ERROR_MESSAGES.FORBIDDEN;
    case 404:
      return ERROR_MESSAGES.NOT_FOUND;
    case 422:
      return serverMessage || ERROR_MESSAGES.VALIDATION_ERROR;
    case 408:
    case 504:
      return ERROR_MESSAGES.TIMEOUT_ERROR;
    case 500:
    case 502:
    case 503:
      return ERROR_MESSAGES.SERVER_ERROR;
    default:
      return serverMessage || ERROR_MESSAGES.UNKNOWN_ERROR;
  }
}

/**
 * Create an AbortController with timeout
 */
function createTimeoutController(timeoutMs: number = DEFAULT_TIMEOUT_MS): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

// Request/Response types
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface ApiError {
  message: string;
  code?: string;
  status: number;
}

// Auth token management (stored in memory only, not localStorage)
let authToken: string | null = null;

// Token refresh state management
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;
let onAuthFailureCallback: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function clearAuthToken() {
  authToken = null;
}

/**
 * Set a callback to be called when authentication fails (after refresh attempt)
 * Use this to redirect to login page
 */
export function setOnAuthFailure(callback: () => void) {
  onAuthFailureCallback = callback;
}

/**
 * Attempt to refresh the access token using the refresh token cookie
 * Returns true if refresh succeeded, false otherwise
 * Exported for use by other modules (e.g., uploadUtils)
 */
export async function attemptTokenRefresh(): Promise<boolean> {
  // If already refreshing, wait for that to complete
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // Important: include cookies for refresh token
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        // If the response includes a new token, store it
        if (data.data?.token) {
          setAuthToken(data.data.token);
        }
        return true;
      }

      // Refresh failed - clear auth state
      clearAuthToken();
      return false;
    } catch {
      clearAuthToken();
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Base fetch wrapper with authentication, timeout, error handling, and automatic token refresh
 */
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  isRetry: boolean = false
): Promise<ApiResponse<T>> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }

  // Create abort controller for timeout
  const { controller, timeoutId } = createTimeoutController(timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });

    // Clear timeout since request completed
    clearTimeout(timeoutId);

    let data;
    try {
      data = await response.json();
    } catch {
      // Response was not JSON
      if (!response.ok) {
        // Handle 401 for non-JSON responses
        if (response.status === 401 && !isRetry) {
          const refreshed = await attemptTokenRefresh();
          if (refreshed) {
            return apiFetch<T>(endpoint, options, timeoutMs, true);
          }
          // Refresh failed - trigger auth failure callback
          if (onAuthFailureCallback) {
            onAuthFailureCallback();
          }
        }
        throw {
          message: getUserFriendlyMessage(response.status),
          code: 'PARSE_ERROR',
          status: response.status,
        } as ApiError;
      }
      // For successful non-JSON responses (like 204 No Content)
      // Return success with undefined data - caller should handle this case
      return { success: true, data: undefined } as ApiResponse<T>;
    }

    if (!response.ok) {
      // Handle 401 Unauthorized - attempt token refresh
      if (response.status === 401 && !isRetry) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          // Retry the original request with the new token
          return apiFetch<T>(endpoint, options, timeoutMs, true);
        }
        // Refresh failed - trigger auth failure callback
        if (onAuthFailureCallback) {
          onAuthFailureCallback();
        }
      }

      // Handle error response - error can be a string or an object with code/message
      const serverMessage = typeof data.error === 'string'
        ? data.error
        : data.error?.message;
      const errorCode = typeof data.error === 'object'
        ? data.error?.code
        : data.code;

      throw {
        message: getUserFriendlyMessage(response.status, serverMessage),
        code: errorCode || `HTTP_${response.status}`,
        status: response.status,
      } as ApiError;
    }

    return data as ApiResponse<T>;
  } catch (error) {
    // Clear timeout on error
    clearTimeout(timeoutId);

    // Handle abort/timeout
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw {
        message: ERROR_MESSAGES.TIMEOUT_ERROR,
        code: 'TIMEOUT',
        status: 408,
      } as ApiError;
    }

    // Re-throw if it's already an ApiError
    if ((error as ApiError).status !== undefined) {
      throw error;
    }

    // Handle network errors
    throw {
      message: ERROR_MESSAGES.NETWORK_ERROR,
      code: 'NETWORK_ERROR',
      status: 0,
    } as ApiError;
  }
}

// ============================================
// AUTHENTICATION
// ============================================

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthResponse {
  token?: string; // Token may not be in response when using HTTP-only cookies
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export const authApi = {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    // Token is now in HTTP-only cookie, so we don't store it in memory
    // But keep backwards compatibility if token is returned
    if (response.data.token) {
      setAuthToken(response.data.token);
    }
    return response.data;
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // Token is now in HTTP-only cookie
    if (response.data.token) {
      setAuthToken(response.data.token);
    }
    return response.data;
  },

  async logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      clearAuthToken();
    }
  },

  async getCurrentUser(): Promise<{ id: string; email: string; role: string }> {
    const response = await apiFetch<{ id: string; email: string; role: string }>('/auth/me');
    return response.data;
  },

  async demoLogin(): Promise<AuthResponse> {
    const response = await apiFetch<AuthResponse>('/auth/demo', {
      method: 'POST',
    });
    if (response.data.token) {
      setAuthToken(response.data.token);
    }
    return response.data;
  },

  async refreshToken(): Promise<void> {
    await apiFetch('/auth/refresh', { method: 'POST' });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  async verifyEmail(token: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
    return response.data;
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return response.data;
  },

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
    return response.data;
  },

  async resendVerification(email: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return response.data;
  },
};

// ============================================
// BIOMARKERS
// ============================================

export interface BiomarkerData {
  id: string;
  name: string;
  value: number;
  unit: string;
  date: string;
  category: string;
  normalRange: {
    min: number;
    max: number;
    unit: string;
    source?: string;
  };
  description?: string;
  notes?: string;
  sourceFile?: string;
  extractionConfidence?: number;
  isOutOfRange: boolean;
}

export interface BiomarkerHistory {
  date: string;
  value: number;
  notes?: string;
}

export interface CreateBiomarkerData {
  name: string;
  value: number;
  unit: string;
  date: string;
  category: string;
  normalRangeMin: number;
  normalRangeMax: number;
  normalRangeSource?: string;
  notes?: string;
  sourceFile?: string;
  extractionConfidence?: number;
}

export const biomarkersApi = {
  async getAll(params?: {
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<{ biomarkers: BiomarkerData[]; pagination?: ApiResponse<unknown>['pagination'] }> {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set('category', params.category);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    const response = await apiFetch<BiomarkerData[]>(`/biomarkers${query ? `?${query}` : ''}`);
    return { biomarkers: response.data, pagination: response.pagination };
  },

  async getById(id: string): Promise<BiomarkerData> {
    const response = await apiFetch<BiomarkerData>(`/biomarkers/${id}`);
    return response.data;
  },

  async getHistory(id: string): Promise<BiomarkerHistory[]> {
    const response = await apiFetch<BiomarkerHistory[]>(`/biomarkers/${id}/history`);
    return response.data;
  },

  async create(data: CreateBiomarkerData): Promise<BiomarkerData> {
    const response = await apiFetch<BiomarkerData>('/biomarkers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async createBatch(data: CreateBiomarkerData[]): Promise<BiomarkerData[]> {
    const response = await apiFetch<BiomarkerData[]>('/biomarkers/batch', {
      method: 'POST',
      body: JSON.stringify({ biomarkers: data }),
    });
    return response.data;
  },

  async update(id: string, data: Partial<CreateBiomarkerData>): Promise<BiomarkerData> {
    const response = await apiFetch<BiomarkerData>(`/biomarkers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/biomarkers/${id}`, { method: 'DELETE' });
  },

  async getCategories(): Promise<string[]> {
    const response = await apiFetch<string[]>('/biomarkers/categories');
    return response.data;
  },

  async getSummary(): Promise<{
    total: number;
    outOfRange: number;
    byCategory: Record<string, number>;
  }> {
    const response = await apiFetch<{
      total: number;
      outOfRange: number;
      byCategory: Record<string, number>;
    }>('/biomarkers/summary');
    return response.data;
  },
};

// ============================================
// INSURANCE
// ============================================

export interface InsurancePlanData {
  id: string;
  planName: string;
  insurerName: string;
  planType: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP' | 'Other';
  effectiveDate: string;
  terminationDate?: string;
  isActive: boolean;
  isPrimary: boolean;
  deductibleIndividual: number;
  deductibleFamily: number;
  oopMaxIndividual: number;
  oopMaxFamily: number;
  premiumMonthly?: number;
}

export interface InsuranceBenefitData {
  id: string;
  planId: string;
  serviceName: string;
  serviceCategory: string;
  inNetworkCovered: boolean;
  inNetworkCopay?: number;
  inNetworkCoinsurance?: number;
  outNetworkCovered: boolean;
  outNetworkCopay?: number;
  outNetworkCoinsurance?: number;
  preAuthRequired: boolean;
  limitations?: string;
}

export interface CreateInsurancePlanData {
  planName: string;
  insurerName: string;
  planType: string;
  effectiveDate: string;
  terminationDate?: string;
  deductibleIndividual: number;
  deductibleFamily: number;
  oopMaxIndividual: number;
  oopMaxFamily: number;
  premiumMonthly?: number;
  isPrimary?: boolean;
}

export const insuranceApi = {
  async getPlans(): Promise<InsurancePlanData[]> {
    const response = await apiFetch<InsurancePlanData[]>('/insurance/plans');
    return response.data;
  },

  async getPlanById(id: string): Promise<InsurancePlanData> {
    const response = await apiFetch<InsurancePlanData>(`/insurance/plans/${id}`);
    return response.data;
  },

  async createPlan(data: CreateInsurancePlanData): Promise<InsurancePlanData> {
    const response = await apiFetch<InsurancePlanData>('/insurance/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updatePlan(id: string, data: Partial<CreateInsurancePlanData>): Promise<InsurancePlanData> {
    const response = await apiFetch<InsurancePlanData>(`/insurance/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async deletePlan(id: string): Promise<void> {
    await apiFetch(`/insurance/plans/${id}`, { method: 'DELETE' });
  },

  async getBenefits(planId: string): Promise<InsuranceBenefitData[]> {
    const response = await apiFetch<InsuranceBenefitData[]>(`/insurance/plans/${planId}/benefits`);
    return response.data;
  },

  async uploadSBC(file: File): Promise<InsurancePlanData> {
    // Use the consolidated upload utility
    const { uploadFile } = await import('./uploadUtils');
    return uploadFile<InsurancePlanData>('/insurance/upload-sbc', file, {
      timeoutMs: 60000,
      timeoutMessage: 'SBC file upload timed out. Please try again with a smaller file.',
    });
  },
};

// ============================================
// DNA / GENETICS
// ============================================

export interface DNADataInfo {
  id: string;
  filename: string;
  source: string;
  uploadDate: string;
  totalVariants: number;
  validVariants: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface DNAVariantData {
  id: string;
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
}

export interface GeneticTraitData {
  id: string;
  traitName: string;
  category: string;
  rsid: string;
  riskLevel: 'HIGH' | 'MODERATE' | 'LOW' | 'PROTECTIVE' | 'UNKNOWN';
  description: string;
  recommendations?: string;
  confidence: number;
  citationCount: number;
}

export const dnaApi = {
  async getUploads(): Promise<DNADataInfo[]> {
    const response = await apiFetch<DNADataInfo[]>('/dna');
    return response.data;
  },

  async getUploadById(id: string): Promise<DNADataInfo> {
    const response = await apiFetch<DNADataInfo>(`/dna/${id}`);
    return response.data;
  },

  async getVariants(dnaId: string, params?: {
    rsid?: string;
    chromosome?: string;
    page?: number;
    limit?: number;
  }): Promise<{ variants: DNAVariantData[]; pagination?: ApiResponse<unknown>['pagination'] }> {
    const searchParams = new URLSearchParams();
    if (params?.rsid) searchParams.set('rsid', params.rsid);
    if (params?.chromosome) searchParams.set('chromosome', params.chromosome);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    const response = await apiFetch<DNAVariantData[]>(`/dna/${dnaId}/variants${query ? `?${query}` : ''}`);
    return { variants: response.data, pagination: response.pagination };
  },

  async getTraits(dnaId: string): Promise<GeneticTraitData[]> {
    const response = await apiFetch<GeneticTraitData[]>(`/dna/${dnaId}/traits`);
    return response.data;
  },

  async uploadDNA(file: File, source: string): Promise<DNADataInfo> {
    // Use the consolidated upload utility
    const { uploadFile } = await import('./uploadUtils');
    return uploadFile<DNADataInfo>('/dna/upload', file, {
      timeoutMs: 120000, // 2 minutes for large DNA files
      additionalData: { source },
      timeoutMessage: 'DNA file upload timed out. Please try again or use a smaller file.',
    });
  },

  async deleteUpload(id: string): Promise<void> {
    await apiFetch(`/dna/${id}`, { method: 'DELETE' });
  },
};

// ============================================
// HEALTH NEEDS
// ============================================

export interface HealthNeedData {
  id: string;
  needType: 'CONDITION' | 'ACTION' | 'SERVICE' | 'FOLLOW_UP';
  name: string;
  description: string;
  urgency: 'IMMEDIATE' | 'URGENT' | 'FOLLOW_UP' | 'ROUTINE';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';
  relatedBiomarkerIds: string[];
  createdAt: string;
  resolvedAt?: string;
}

export interface CreateHealthNeedData {
  needType: string;
  name: string;
  description: string;
  urgency: string;
  relatedBiomarkerIds?: string[];
}

export const healthNeedsApi = {
  async getAll(params?: {
    status?: string;
    urgency?: string;
  }): Promise<HealthNeedData[]> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.urgency) searchParams.set('urgency', params.urgency);

    const query = searchParams.toString();
    const response = await apiFetch<HealthNeedData[]>(`/health-needs${query ? `?${query}` : ''}`);
    return response.data;
  },

  async getById(id: string): Promise<HealthNeedData> {
    const response = await apiFetch<HealthNeedData>(`/health-needs/${id}`);
    return response.data;
  },

  async create(data: CreateHealthNeedData): Promise<HealthNeedData> {
    const response = await apiFetch<HealthNeedData>('/health-needs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updateStatus(id: string, status: string): Promise<HealthNeedData> {
    const response = await apiFetch<HealthNeedData>(`/health-needs/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/health-needs/${id}`, { method: 'DELETE' });
  },

  async analyze(): Promise<{
    detectedConditions: HealthNeedData[];
    recommendations: string[];
  }> {
    const response = await apiFetch<{
      detectedConditions: HealthNeedData[];
      recommendations: string[];
    }>('/health-needs/analyze');
    return response.data;
  },
};

// ============================================
// HEALTH ANALYSIS (AI-powered)
// ============================================

export interface HealthAnalysisResult {
  overallHealthScore: number;
  riskAssessments: {
    biomarkerId: string;
    biomarkerName: string;
    riskLevel: 'low' | 'moderate' | 'high' | 'critical';
    riskScore: number;
    riskFactors: string[];
    recommendations: string[];
  }[];
  trendAnalyses: {
    biomarkerId: string;
    biomarkerName: string;
    trend: 'improving' | 'stable' | 'declining';
    percentChange: number;
    prediction: string;
  }[];
  priorityActions: string[];
}

export interface HealthScore {
  score: number;
  riskLevel: string;
}

export interface ProviderRecommendation {
  specialty: string;
  reason: string;
  urgency: 'immediate' | 'urgent' | 'follow-up' | 'routine';
  relatedConditions: string[];
}

export const healthAnalysisApi = {
  // GET /health/analysis - Full health analysis with risk assessments and trends
  async getAnalysis(): Promise<HealthAnalysisResult> {
    const response = await apiFetch<HealthAnalysisResult>('/health/analysis');
    return response.data;
  },

  // GET /health/needs - Get health needs/action items based on biomarkers
  async getNeeds(): Promise<HealthNeedData[]> {
    const response = await apiFetch<HealthNeedData[]>('/health/needs');
    return response.data;
  },

  // GET /health/providers - Get provider recommendations based on health profile
  async getProviderRecommendations(): Promise<ProviderRecommendation[]> {
    const response = await apiFetch<ProviderRecommendation[]>('/health/providers');
    return response.data;
  },

  // GET /health/score - Get calculated health score
  async getScore(): Promise<HealthScore> {
    const response = await apiFetch<HealthScore>('/health/score');
    return response.data;
  },
};

// ============================================
// HEALTH GOALS
// ============================================

export interface HealthGoalData {
  id: string;
  name: string;
  description: string | null;
  category: string;
  targetValue: number;
  currentValue: number | null;
  startValue: number | null;
  unit: string;
  direction: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  relatedBiomarkerId: string | null;
  startDate: string;
  targetDate: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  progress: number;
  milestones: { value: number; label: string; achieved: boolean; achievedAt?: string }[] | null;
  reminderFrequency: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateHealthGoalData {
  name: string;
  description?: string;
  category: string;
  targetValue: number;
  startValue?: number;
  unit: string;
  direction: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  relatedBiomarkerId?: string;
  startDate: string;
  targetDate: string;
  milestones?: { value: number; label: string }[];
  reminderFrequency?: string;
}

export interface UpdateHealthGoalData {
  name?: string;
  description?: string;
  category?: string;
  targetValue?: number;
  unit?: string;
  direction?: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  targetDate?: string;
  milestones?: { value: number; label: string }[];
  reminderFrequency?: string;
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
}

export interface GoalProgressUpdate {
  value: number;
  note?: string;
}

export interface GoalsSummary {
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  abandoned: number;
  averageProgress: number;
}

export const healthGoalsApi = {
  async getAll(params?: { status?: string; category?: string }): Promise<HealthGoalData[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.category) queryParams.set('category', params.category);
    const query = queryParams.toString() ? `?${queryParams}` : '';
    const response = await apiFetch<HealthGoalData[]>(`/health-goals${query}`);
    return response.data;
  },

  async getById(id: string): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>(`/health-goals/${id}`);
    return response.data;
  },

  async create(data: CreateHealthGoalData): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>('/health-goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async update(id: string, data: UpdateHealthGoalData): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>(`/health-goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updateProgress(id: string, data: GoalProgressUpdate): Promise<HealthGoalData> {
    const response = await apiFetch<HealthGoalData>(`/health-goals/${id}/progress`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/health-goals/${id}`, { method: 'DELETE' });
  },

  async getSummary(): Promise<GoalsSummary> {
    const response = await apiFetch<GoalsSummary>('/health-goals/summary');
    return response.data;
  },

  async getSuggestions(): Promise<{ name: string; description: string; category: string; unit: string; direction: string }[]> {
    const response = await apiFetch<{ name: string; description: string; category: string; unit: string; direction: string }[]>('/health-goals/suggestions');
    return response.data;
  },
};

// ============================================
// FILE UPLOAD
// ============================================

export const uploadApi = {
  async uploadLabReport(file: File): Promise<BiomarkerData[]> {
    // Use the consolidated upload utility
    const { uploadFile } = await import('./uploadUtils');
    return uploadFile<BiomarkerData[]>('/upload/lab-report', file, {
      timeoutMs: 60000,
      timeoutMessage: 'Lab report upload timed out. Please try again with a smaller file.',
    });
  },
};

// ============================================
// PROVIDER API (for healthcare providers)
// ============================================

export type UserRole = 'PATIENT' | 'PROVIDER' | 'ADMIN';

export interface ProviderPatientRelationship {
  relationshipId: string;
  patientId: string;
  patient: {
    id: string;
    email: string;
    createdAt: string;
  } | null;
  permissions: {
    canViewBiomarkers: boolean;
    canViewInsurance: boolean;
    canViewDna: boolean;
    canViewHealthNeeds: boolean;
    canEditData: boolean;
  };
  relationshipType: string;
  status: string;
  consentGrantedAt: string | null;
  consentExpiresAt: string | null;
  createdAt: string;
}

export const providerApi = {
  // Get all patients this provider has access to
  async getPatients(): Promise<ProviderPatientRelationship[]> {
    const response = await apiFetch<ProviderPatientRelationship[]>('/provider/patients');
    return response.data;
  },

  // Request access to a patient by email
  async requestPatientAccess(patientEmail: string, relationshipType?: string, message?: string): Promise<{ relationshipId: string; status: string }> {
    const response = await apiFetch<{ relationshipId: string; status: string }>('/provider/patients/request', {
      method: 'POST',
      body: JSON.stringify({ patientEmail, relationshipType, message }),
    });
    return response.data;
  },

  // Get specific patient's details
  async getPatient(patientId: string): Promise<{
    patient: { id: string; email: string; createdAt: string; lastLoginAt: string | null };
    relationship: ProviderPatientRelationship['permissions'] & { id: string; relationshipType: string };
  }> {
    const response = await apiFetch<{
      patient: { id: string; email: string; createdAt: string; lastLoginAt: string | null };
      relationship: ProviderPatientRelationship['permissions'] & { id: string; relationshipType: string };
    }>(`/provider/patients/${patientId}`);
    return response.data;
  },

  // Get patient's biomarkers
  async getPatientBiomarkers(patientId: string): Promise<BiomarkerData[]> {
    const response = await apiFetch<BiomarkerData[]>(`/provider/patients/${patientId}/biomarkers`);
    return response.data;
  },

  // Get patient's health needs
  async getPatientHealthNeeds(patientId: string): Promise<HealthNeedData[]> {
    const response = await apiFetch<HealthNeedData[]>(`/provider/patients/${patientId}/health-needs`);
    return response.data;
  },

  // Remove patient relationship
  async removePatient(patientId: string): Promise<void> {
    await apiFetch(`/provider/patients/${patientId}`, { method: 'DELETE' });
  },
};

// ============================================
// PATIENT API (consent management)
// ============================================

export interface PatientProviderRelationship {
  relationshipId: string;
  providerId: string;
  provider: {
    id: string;
    email: string;
  } | null;
  permissions: {
    canViewBiomarkers: boolean;
    canViewInsurance: boolean;
    canViewDna: boolean;
    canViewHealthNeeds: boolean;
    canEditData: boolean;
  };
  relationshipType: string;
  status: string;
  consentGrantedAt: string | null;
  consentExpiresAt: string | null;
  createdAt: string;
}

export interface PendingProviderRequest {
  requestId: string;
  providerId: string;
  provider: {
    id: string;
    email: string;
  } | null;
  relationshipType: string;
  requestedAt: string;
}

export const patientApi = {
  // Get all providers with access
  async getProviders(): Promise<PatientProviderRelationship[]> {
    const response = await apiFetch<PatientProviderRelationship[]>('/patient/providers');
    return response.data;
  },

  // Get pending access requests
  async getPendingRequests(): Promise<PendingProviderRequest[]> {
    const response = await apiFetch<PendingProviderRequest[]>('/patient/providers/pending');
    return response.data;
  },

  // Approve a provider's access request
  async approveProvider(
    requestId: string,
    permissions?: {
      canViewBiomarkers?: boolean;
      canViewInsurance?: boolean;
      canViewDna?: boolean;
      canViewHealthNeeds?: boolean;
      canEditData?: boolean;
      consentDurationDays?: number;
    }
  ): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify(permissions || {}),
    });
    return response.data;
  },

  // Deny a provider's access request
  async denyProvider(requestId: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${requestId}/deny`, {
      method: 'POST',
    });
    return response.data;
  },

  // Update provider permissions
  async updateProviderPermissions(
    relationshipId: string,
    permissions: {
      canViewBiomarkers?: boolean;
      canViewInsurance?: boolean;
      canViewDna?: boolean;
      canViewHealthNeeds?: boolean;
      canEditData?: boolean;
    }
  ): Promise<PatientProviderRelationship> {
    const response = await apiFetch<PatientProviderRelationship>(`/patient/providers/${relationshipId}`, {
      method: 'PATCH',
      body: JSON.stringify(permissions),
    });
    return response.data;
  },

  // Revoke a provider's access
  async revokeProvider(relationshipId: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${relationshipId}/revoke`, {
      method: 'POST',
    });
    return response.data;
  },

  // Remove a provider relationship entirely
  async removeProvider(relationshipId: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/patient/providers/${relationshipId}`, {
      method: 'DELETE',
    });
    return response.data;
  },
};

// ============================================
// ADMIN API
// ============================================

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  _count?: {
    biomarkers: number;
    insurancePlans: number;
    healthNeeds: number;
  };
}

export interface SystemStats {
  users: {
    total: number;
    active: number;
    byRole: Record<string, number>;
    recentLogins: number;
  };
  data: {
    biomarkers: number;
    insurancePlans: number;
    healthNeeds: number;
  };
}

export const adminApi = {
  // List all users
  async getUsers(params?: {
    page?: number;
    limit?: number;
    role?: UserRole;
    isActive?: boolean;
    search?: string;
  }): Promise<{ users: AdminUser[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.role) searchParams.set('role', params.role);
    if (params?.isActive !== undefined) searchParams.set('isActive', params.isActive.toString());
    if (params?.search) searchParams.set('search', params.search);

    const query = searchParams.toString();
    const response = await apiFetch<{ users: AdminUser[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(`/admin/users${query ? `?${query}` : ''}`);
    return response.data;
  },

  // Get user details
  async getUser(id: string): Promise<AdminUser> {
    const response = await apiFetch<AdminUser>(`/admin/users/${id}`);
    return response.data;
  },

  // Create a new user
  async createUser(data: {
    email: string;
    password: string;
    role?: UserRole;
    isActive?: boolean;
    emailVerified?: boolean;
  }): Promise<AdminUser> {
    const response = await apiFetch<AdminUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  // Update a user
  async updateUser(
    id: string,
    data: {
      role?: UserRole;
      isActive?: boolean;
      emailVerified?: boolean;
      password?: string;
    }
  ): Promise<AdminUser> {
    const response = await apiFetch<AdminUser>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  // Deactivate a user
  async deactivateUser(id: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/admin/users/${id}`, {
      method: 'DELETE',
    });
    return response.data;
  },

  // Permanently delete a user
  async deleteUserPermanently(id: string, confirmEmail: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/admin/users/${id}/permanent`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail }),
    });
    return response.data;
  },

  // Get system stats
  async getStats(): Promise<SystemStats> {
    const response = await apiFetch<SystemStats>('/admin/stats');
    return response.data;
  },

  // Get audit logs
  async getAuditLogs(params?: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ logs: unknown[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.userId) searchParams.set('userId', params.userId);
    if (params?.action) searchParams.set('action', params.action);
    if (params?.resourceType) searchParams.set('resourceType', params.resourceType);
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);

    const query = searchParams.toString();
    const response = await apiFetch<{ logs: unknown[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(`/admin/audit-logs${query ? `?${query}` : ''}`);
    return response.data;
  },
};

// ============================================
// MARKETPLACE API (Healthcare.gov)
// ============================================

// Plan Search Types
export interface MarketplacePlanSearchParams {
  zipcode: string;
  age: number;
  income: number;
  householdSize: number;
  gender?: 'Male' | 'Female';
  usesTobacco?: boolean;
  year?: number;
}

export interface MarketplaceSearchedPlan {
  id: string;
  name: string;
  issuer: {
    id: string;
    name: string;
  };
  metalLevel: 'catastrophic' | 'bronze' | 'silver' | 'gold' | 'platinum';
  type: string;
  premium: number;
  premiumWithCredit: number;
  deductible: number;
  outOfPocketMax: number;
  ehbPremium?: number;
  pediatricDentalCoverage?: boolean;
  hsaEligible?: boolean;
  benefits?: {
    name: string;
    covered: boolean;
    costSharingDisplay?: string;
  }[];
  qualityRating?: {
    globalRating?: number;
    globalRatingStr?: string;
  };
  brochureUrl?: string;
  formularyUrl?: string;
  networkUrl?: string;
}

export interface MarketplacePlanSearchResult {
  plans: MarketplaceSearchedPlan[];
  total: number;
  facetGroups?: {
    name: string;
    facets: { value: string; count: number }[];
  }[];
  ranges?: {
    premiums?: { min: number; max: number };
    deductibles?: { min: number; max: number };
  };
}

export interface MarketplacePlanDetails {
  id: string;
  name: string;
  issuer: {
    id: string;
    name: string;
  };
  metalLevel: 'catastrophic' | 'bronze' | 'silver' | 'gold' | 'platinum';
  type: string;
  premium: number;
  deductibles: {
    individual: number;
    family: number;
  };
  outOfPocketMax: {
    individual: number;
    family: number;
  };
  benefits: MarketplaceBenefit[];
  network: {
    url?: string;
    tier?: string;
  };
  formularyUrl?: string;
  brochureUrl?: string;
}

export interface MarketplaceBenefit {
  name: string;
  covered: boolean;
  costSharing?: {
    copay?: number;
    coinsurance?: number;
    deductibleApplies?: boolean;
  };
  explanation?: string;
}

export interface MarketplaceProvider {
  npi: string;
  name: {
    first?: string;
    middle?: string;
    last?: string;
    full: string;
  };
  specialty?: string[];
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  phone?: string;
  acceptingNewPatients?: boolean;
  gender?: string;
  languages?: string[];
  facilityType?: string;
  distance?: number;
}

export interface MarketplaceProviderSearchParams {
  zipcode: string;
  planId?: string;
  specialty?: string;
  type?: 'individual' | 'facility';
  radius?: number;
  page?: number;
  limit?: number;
}

export interface MarketplaceProviderSearchResult {
  providers: MarketplaceProvider[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const marketplaceApi = {
  // Search for health insurance plans
  async searchPlans(params: MarketplacePlanSearchParams): Promise<MarketplacePlanSearchResult> {
    const response = await apiFetch<MarketplacePlanSearchResult>('/marketplace/plans/search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return response.data;
  },

  // Get plan details from Healthcare.gov
  async getPlanDetails(planId: string, year?: number): Promise<MarketplacePlanDetails> {
    const params = year ? `?year=${year}` : '';
    const response = await apiFetch<MarketplacePlanDetails>(`/marketplace/plans/${planId}${params}`);
    return response.data;
  },

  // Get plan benefits
  async getPlanBenefits(planId: string, year?: number): Promise<MarketplaceBenefit[]> {
    const params = year ? `?year=${year}` : '';
    const response = await apiFetch<MarketplaceBenefit[]>(`/marketplace/plans/${planId}/benefits${params}`);
    return response.data;
  },

  // Search for providers
  async searchProviders(params: MarketplaceProviderSearchParams): Promise<MarketplaceProviderSearchResult> {
    const searchParams = new URLSearchParams();
    searchParams.set('zipcode', params.zipcode);
    if (params.planId) searchParams.set('planId', params.planId);
    if (params.specialty) searchParams.set('specialty', params.specialty);
    if (params.type) searchParams.set('type', params.type);
    if (params.radius) searchParams.set('radius', params.radius.toString());
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.limit) searchParams.set('limit', params.limit.toString());

    const response = await apiFetch<MarketplaceProviderSearchResult>(`/marketplace/providers?${searchParams}`);
    return response.data;
  },

  // Get provider by NPI
  async getProviderByNPI(npi: string): Promise<MarketplaceProvider> {
    const response = await apiFetch<MarketplaceProvider>(`/marketplace/providers/${npi}`);
    return response.data;
  },

  // Check if provider is in-network for a plan
  async checkProviderNetwork(npi: string, planId: string): Promise<{ inNetwork: boolean; networkTier?: string }> {
    const response = await apiFetch<{ inNetwork: boolean; networkTier?: string }>(
      `/marketplace/providers/${npi}/network-check?planId=${encodeURIComponent(planId)}`
    );
    return response.data;
  },

  // Check API health
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    const response = await apiFetch<{ healthy: boolean; message: string }>('/marketplace/health');
    return response.data;
  },
};

// Export error type for consumers
export type { ApiError };
