/**
 * Authentication API
 */

import { apiFetch, setAuthToken, clearAuthToken } from './client';

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
  token?: string;
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

  /**
   * Revoke every session for the current user (all devices/browsers), not just
   * this one. Backed by POST /auth/logout-all, which deletes all refresh-token
   * sessions and blacklists outstanding access tokens. The local token is
   * cleared regardless of the request outcome.
   */
  async logoutAll(): Promise<void> {
    try {
      await apiFetch('/auth/logout-all', { method: 'POST' });
    } finally {
      clearAuthToken();
    }
  },

  async getCurrentUser(): Promise<{ id: string; email: string; role: string }> {
    const response = await apiFetch<{ id: string; email: string; role: string }>('/auth/me');
    return response.data;
  },

  async demoLogin(): Promise<AuthResponse> {
    const response = await apiFetch<AuthResponse>('/auth/demo', { method: 'POST' });
    if (response.data.token) {
      setAuthToken(response.data.token);
    }
    return response.data;
  },

  async refreshToken(): Promise<{ token?: string }> {
    const response = await apiFetch<{ token?: string }>('/auth/refresh', { method: 'POST' });
    if (response.data.token) {
      setAuthToken(response.data.token);
    }
    return response.data;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  /**
   * Request a change of the account email. Re-authenticates with the current
   * password; on success the backend emails a confirmation link to the new
   * address (and a security notice to the old). The change is not applied until
   * the link is confirmed via confirmEmailChange().
   */
  async requestEmailChange(newEmail: string, currentPassword: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>('/auth/change-email', {
      method: 'POST',
      body: JSON.stringify({ newEmail, currentPassword }),
    });
    return response.data;
  },

  /**
   * Confirm a pending email change from the tokenized link. The backend swaps
   * the address and revokes all sessions, so the user must log in again.
   */
  async confirmEmailChange(token: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(
      `/auth/confirm-email-change?token=${encodeURIComponent(token)}`
    );
    return response.data;
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
