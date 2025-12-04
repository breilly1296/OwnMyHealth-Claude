/**
 * AuthContext Tests
 *
 * Tests the authentication context provider functionality.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';

// Mock the api module
vi.mock('../../services/api', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
  },
  clearAuthToken: vi.fn(),
}));

import { authApi, clearAuthToken } from '../../services/api';

// Test component to access auth context
function TestComponent({ onRender }: { onRender?: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  if (onRender) {
    onRender(auth);
  }
  return (
    <div>
      <span data-testid="is-authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="is-loading">{String(auth.isLoading)}</span>
      <span data-testid="user-email">{auth.user?.email || 'none'}</span>
      <span data-testid="error">{auth.error || 'none'}</span>
    </div>
  );
}

// Component for testing actions - catches errors since AuthContext re-throws them
function ActionTestComponent() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="is-authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="is-loading">{String(auth.isLoading)}</span>
      <span data-testid="user-email">{auth.user?.email || 'none'}</span>
      <span data-testid="error">{auth.error || 'none'}</span>
      <button
        data-testid="login-btn"
        onClick={() => auth.login('test@example.com', 'password123').catch(() => {})}
      >
        Login
      </button>
      <button
        data-testid="register-btn"
        onClick={() => auth.register('new@example.com', 'password123', 'John', 'Doe').catch(() => {})}
      >
        Register
      </button>
      <button data-testid="logout-btn" onClick={() => auth.logout().catch(() => {})}>
        Logout
      </button>
      <button data-testid="clear-error-btn" onClick={() => auth.clearError()}>
        Clear Error
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing session
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initial State', () => {
    it('should start with loading true', async () => {
      // Make getCurrentUser hang to catch the loading state
      vi.mocked(authApi.getCurrentUser).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      expect(screen.getByTestId('is-loading').textContent).toBe('true');
    });

    it('should set loading to false after checking auth', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });
    });

    it('should be not authenticated initially when no session exists', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
      });
    });

    it('should have no user initially when no session exists', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('user-email').textContent).toBe('none');
      });
    });

    it('should restore session if token exists', async () => {
      const mockUser = { id: '1', email: 'existing@example.com', role: 'user' };
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
        expect(screen.getByTestId('user-email').textContent).toBe('existing@example.com');
      });
    });
  });

  describe('Login', () => {
    it('should update state correctly on successful login', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      vi.mocked(authApi.login).mockResolvedValue({ user: mockUser, token: 'mock-token' });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      // Wait for initial auth check
      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // Click login
      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
        expect(screen.getByTestId('user-email').textContent).toBe('test@example.com');
      });
    });

    it('should call authApi.login with correct credentials', async () => {
      vi.mocked(authApi.login).mockResolvedValue({
        user: { id: '1', email: 'test@example.com', role: 'user' },
        token: 'mock-token',
      });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      expect(authApi.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should set error on login failure', async () => {
      vi.mocked(authApi.login).mockRejectedValue(new Error('Invalid credentials'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Invalid credentials');
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
      });
    });

    it('should set loading during login', async () => {
      let resolveLogin: (value: any) => void;
      vi.mocked(authApi.login).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLogin = resolve;
          })
      );

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // Start login
      act(() => {
        screen.getByTestId('login-btn').click();
      });

      // Should be loading
      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('true');
      });

      // Complete login
      await act(async () => {
        resolveLogin!({
          user: { id: '1', email: 'test@example.com', role: 'user' },
          token: 'mock-token',
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });
    });
  });

  describe('Register', () => {
    it('should call authApi.register with correct data', async () => {
      vi.mocked(authApi.register).mockResolvedValue({
        user: { id: '1', email: 'new@example.com', role: 'user' },
        token: 'mock-token',
      });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('register-btn').click();
      });

      expect(authApi.register).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should NOT set user after registration (requires verification)', async () => {
      vi.mocked(authApi.register).mockResolvedValue({
        user: { id: '1', email: 'new@example.com', role: 'user' },
        token: 'mock-token',
      });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('register-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // User should NOT be authenticated after registration
      expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    });

    it('should set error on registration failure', async () => {
      vi.mocked(authApi.register).mockRejectedValue(new Error('Email already exists'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('register-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Email already exists');
      });
    });
  });

  describe('Logout', () => {
    it('should clear user state on logout', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      // Wait for session restore
      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
      });

      // Logout
      await act(async () => {
        screen.getByTestId('logout-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
        expect(screen.getByTestId('user-email').textContent).toBe('none');
      });
    });

    it('should call clearAuthToken on logout', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
      });

      await act(async () => {
        screen.getByTestId('logout-btn').click();
      });

      expect(clearAuthToken).toHaveBeenCalled();
    });

    it('should clear state even if logout API fails', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(authApi.logout).mockRejectedValue(new Error('Network error'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
      });

      await act(async () => {
        screen.getByTestId('logout-btn').click();
      });

      // Should still clear state even on API error
      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
      });
    });
  });

  describe('Error Handling', () => {
    it('should clear error with clearError', async () => {
      vi.mocked(authApi.login).mockRejectedValue(new Error('Login failed'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // Trigger an error
      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Login failed');
      });

      // Clear the error
      await act(async () => {
        screen.getByTestId('clear-error-btn').click();
      });

      expect(screen.getByTestId('error').textContent).toBe('none');
    });

    it('should use default error message if none provided', async () => {
      vi.mocked(authApi.login).mockRejectedValue({});

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Login failed');
      });
    });
  });

  describe('useAuth Hook', () => {
    it('should throw when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });
});
