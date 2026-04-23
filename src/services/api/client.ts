/**
 * API Client Core
 *
 * Base fetch wrapper with authentication, timeout, error handling,
 * and automatic token refresh. All domain APIs use this client.
 */

import { apiLogger } from '../../utils/logger';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

const DEFAULT_TIMEOUT_MS = 30000;

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

export interface ApiResponse<T> {
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

export interface ApiError {
  message: string;
  code?: string;
  status: number;
  /**
   * Populated only for `code: 'PLAN_LIMIT_EXCEEDED'` 403s. UI code uses these
   * fields to render an upgrade CTA with the exact usage numbers instead of
   * the generic "Forbidden" toast.
   */
  planLimit?: {
    limit: number;
    current: number;
    feature: string;
    upgradeRequired: boolean;
  };
}

/** Narrowing helper: does this error represent a plan-limit 403? */
export function isPlanLimitError(err: unknown): err is ApiError & { planLimit: NonNullable<ApiError['planLimit']> } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as ApiError).code === 'PLAN_LIMIT_EXCEEDED' &&
    !!(err as ApiError).planLimit
  );
}

// Auth token management (stored in memory only)
let authToken: string | null = null;
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

export function setOnAuthFailure(callback: () => void) {
  onAuthFailureCallback = callback;
}

function getUserFriendlyMessage(status: number, serverMessage?: string): string {
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

function createTimeoutController(timeoutMs: number = DEFAULT_TIMEOUT_MS): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

export function getCsrfToken(): string {
  const cookies = document.cookie;
  const match = cookies.match(/csrf[_-]?token=([^;]+)/i);
  const token = match ? decodeURIComponent(match[1]) : '';

  if (!token && typeof window !== 'undefined') {
    // Don't log the cookie substring — even a prefix can leak session state
    // to the browser console (audit F-10). The logger also gates this in
    // production so it only surfaces in dev where it's useful for debugging
    // CSRF configuration issues.
    apiLogger.warn('No CSRF token found in cookies');
  }

  return token;
}

export async function attemptTokenRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data?.token) {
          setAuthToken(data.data.token);
        }
        return true;
      }

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

export async function apiFetch<T>(
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

  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      (headers as Record<string, string>)['x-csrf-token'] = csrfToken;
    } else {
      apiLogger.warn('Mutation request without CSRF token', { method, endpoint });
    }
  }

  // Auth-management endpoints must bypass the generic 401 retry path. When
  // /auth/refresh returns 401 the refresh token is terminally invalid —
  // calling attemptTokenRefresh() would hit the same endpoint recursively.
  // When /auth/logout returns 401 the onAuthFailureCallback calls logout()
  // which re-enters this code path. Both loops produced 10,000+ 401s in dev
  // and prevented login from settling. /auth/login is intentionally NOT
  // exempted — its 401 means wrong credentials, which the UI surfaces.
  const isAuthMgmtEndpoint = endpoint === '/auth/refresh' || endpoint === '/auth/logout';

  const { controller, timeoutId } = createTimeoutController(timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let data;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) {
        if (response.status === 401 && !isRetry && !isAuthMgmtEndpoint) {
          const refreshed = await attemptTokenRefresh();
          if (refreshed) {
            return apiFetch<T>(endpoint, options, timeoutMs, true);
          }
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
      return { success: true, data: undefined } as ApiResponse<T>;
    }

    if (!response.ok) {
      if (response.status === 401 && !isRetry && !isAuthMgmtEndpoint) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          return apiFetch<T>(endpoint, options, timeoutMs, true);
        }
        if (onAuthFailureCallback) {
          onAuthFailureCallback();
        }
      }

      const serverMessage = typeof data.error === 'string'
        ? data.error
        : data.error?.message;
      const errorCode = typeof data.error === 'object'
        ? data.error?.code
        : data.code;

      const apiError: ApiError = {
        message: getUserFriendlyMessage(response.status, serverMessage),
        code: errorCode || `HTTP_${response.status}`,
        status: response.status,
      };

      // Plan-limit errors carry extra fields so the UI can show an
      // upgrade prompt with precise numbers. See planGating.ts on the backend.
      if (errorCode === 'PLAN_LIMIT_EXCEEDED' && typeof data.error === 'object' && data.error) {
        const err = data.error as {
          limit?: number;
          current?: number;
          feature?: string;
          upgradeRequired?: boolean;
        };
        apiError.planLimit = {
          limit: typeof err.limit === 'number' ? err.limit : 0,
          current: typeof err.current === 'number' ? err.current : 0,
          feature: typeof err.feature === 'string' ? err.feature : '',
          upgradeRequired: err.upgradeRequired === true,
        };
      }

      throw apiError;
    }

    return data as ApiResponse<T>;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw {
        message: ERROR_MESSAGES.TIMEOUT_ERROR,
        code: 'TIMEOUT',
        status: 408,
      } as ApiError;
    }

    if ((error as ApiError).status !== undefined) {
      throw error;
    }

    throw {
      message: ERROR_MESSAGES.NETWORK_ERROR,
      code: 'NETWORK_ERROR',
      status: 0,
    } as ApiError;
  }
}
