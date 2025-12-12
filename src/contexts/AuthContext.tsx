/**
 * AuthContext.tsx - Authentication Context Provider
 *
 * This module provides global authentication state management for the application.
 * It handles user login, registration, logout, and session persistence.
 *
 * Key Design Decisions:
 * 1. ONLY user identity (id, email, role) is stored in context - no PHI
 * 2. Authentication tokens are stored in httpOnly cookies (not accessible to JS)
 * 3. PHI data is fetched on-demand from API and not persisted in memory
 * 4. Session is checked on mount by calling the /auth/me endpoint
 *
 * Security Features:
 * - Tokens stored in httpOnly, Secure, SameSite cookies
 * - No sensitive data in localStorage or sessionStorage
 * - Automatic session validation on app load
 * - Clean logout clears all auth state
 *
 * Usage:
 * ```tsx
 * // Wrap app with provider
 * <AuthProvider>
 *   <App />
 * </AuthProvider>
 *
 * // Use in components
 * const { user, isAuthenticated, login, logout } = useAuth();
 * ```
 *
 * @module contexts/AuthContext
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authApi, clearAuthToken, type AuthResponse } from '../services/api';

/**
 * User object stored in auth context
 * Contains only non-PHI identification data
 */
interface User {
  id: string;
  email: string;
  role: string; // 'PATIENT' | 'PROVIDER' | 'ADMIN'
}

/**
 * Authentication context type definition
 * Provides all auth-related state and methods
 */
interface AuthContextType {
  /** Current authenticated user (null if not logged in) */
  user: User | null;
  /** Convenience boolean for auth status */
  isAuthenticated: boolean;
  /** True while checking auth status or performing auth operation */
  isLoading: boolean;
  /** Authenticate user with email/password */
  login: (email: string, password: string) => Promise<void>;
  /** Create new user account */
  register: (email: string, password: string, firstName?: string, lastName?: string) => Promise<void>;
  /** End current session and clear auth state */
  logout: () => Promise<void>;
  /** Current error message (null if no error) */
  error: string | null;
  /** Clear any existing error */
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Try to get current user (if token exists in httpOnly cookie)
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
      } catch {
        // Not authenticated, that's fine
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response: AuthResponse = await authApi.login({ email, password });
      setUser(response.user);
    } catch (err) {
      const message = (err as { message?: string }).message || 'Login failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(
    async (email: string, password: string, firstName?: string, lastName?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        // Register but DO NOT set user - they must verify email and login first
        await authApi.register({
          email,
          password,
          firstName,
          lastName,
        });
        // User is NOT authenticated until they verify email and login
        // The response contains user info but we don't set it to avoid
        // isAuthenticated becoming true before verification
      } catch (err) {
        const message = (err as { message?: string }).message || 'Registration failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      clearAuthToken();
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    error,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

