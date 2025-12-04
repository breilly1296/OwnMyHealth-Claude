/**
 * File Upload Utilities
 *
 * Consolidates duplicate file upload patterns across API service.
 * Handles authentication, token refresh, timeouts, and error handling.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

// Error messages
const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Unable to connect to the server. Please check your internet connection and try again.',
  TIMEOUT_ERROR: 'The request took too long to complete. Please try again.',
};

interface ApiError {
  message: string;
  code?: string;
  status: number;
}

// Import auth functions from api.ts - reuse attemptTokenRefresh to avoid duplication
import { getAuthToken, attemptTokenRefresh, setOnAuthFailure } from './api';

// Re-export setOnAuthFailure for backward compatibility
export const setUploadAuthFailureCallback = setOnAuthFailure;

/**
 * Get user-friendly error message based on status code
 */
function getUserFriendlyMessage(status: number, serverMessage?: string): string {
  if (serverMessage && status >= 400 && status < 500) {
    return serverMessage;
  }

  switch (status) {
    case 0:
      return ERROR_MESSAGES.NETWORK_ERROR;
    case 401:
      return 'Your session has expired. Please log in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'The requested resource was not found.';
    case 408:
    case 504:
      return ERROR_MESSAGES.TIMEOUT_ERROR;
    case 500:
    case 502:
    case 503:
      return 'Something went wrong on our end. Please try again later.';
    default:
      return serverMessage || 'An unexpected error occurred. Please try again.';
  }
}

/**
 * Upload options configuration
 */
export interface UploadOptions {
  /** Custom timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Additional form data fields */
  additionalData?: Record<string, string>;
  /** Custom timeout error message */
  timeoutMessage?: string;
}

/**
 * Generic file upload function with authentication and token refresh
 *
 * @param endpoint - API endpoint (e.g., '/upload/lab-report')
 * @param file - File to upload
 * @param options - Upload configuration options
 * @returns Promise resolving to the response data
 */
export async function uploadFile<T>(
  endpoint: string,
  file: File,
  options: UploadOptions = {},
  isRetry: boolean = false
): Promise<T> {
  const {
    timeoutMs = 60000,
    additionalData = {},
    timeoutMessage = 'File upload timed out. Please try again with a smaller file.',
  } = options;

  const authToken = getAuthToken();

  // Create form data
  const formData = new FormData();
  formData.append('file', file);

  // Add additional data fields
  for (const [key, value] of Object.entries(additionalData)) {
    formData.append(key, value);
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: formData,
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Try to parse JSON response
    let data;
    try {
      data = await response.json();
    } catch {
      // Handle 401 for non-JSON responses
      if (response.status === 401 && !isRetry) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          return uploadFile<T>(endpoint, file, options, true);
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

    // Handle error responses
    if (!response.ok) {
      // Handle 401 Unauthorized - attempt token refresh
      if (response.status === 401 && !isRetry) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          return uploadFile<T>(endpoint, file, options, true);
        }
        if (onAuthFailureCallback) {
          onAuthFailureCallback();
        }
      }

      const serverMessage = typeof data.error === 'string'
        ? data.error
        : data.error?.message;

      throw {
        message: getUserFriendlyMessage(response.status, serverMessage),
        code: data.error?.code || `HTTP_${response.status}`,
        status: response.status,
      } as ApiError;
    }

    return data.data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle timeout/abort
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw {
        message: timeoutMessage,
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
