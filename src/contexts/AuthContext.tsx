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

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { authApi, clearAuthToken, setOnAuthFailure, type AuthResponse } from '../services/api';
import { authLogger } from '../utils/logger';

// HIPAA §164.312(a)(2)(iii) — automatic logoff after a predetermined time
// of inactivity. 15 minutes is the common healthcare baseline; the 2-minute
// warning gives a user at the keyboard time to extend without surprise.
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const INACTIVITY_WARNING_MS = 13 * 60 * 1000; // 2 minutes before logout
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

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
  /** Set an error message (pass null to clear) */
  setError: (message: string | null) => void;
  /** Clear any existing error */
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [idleWarningVisible, setIdleWarningVisible] = useState(false);

  // Timer refs live outside React state so the ticks don't cause re-renders.
  // Each activity-event firing resets both timers; we want cheap mutation.
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // CRITICAL FIX: Call refreshToken FIRST to get a fresh access token.
        // The access token cookie expires after 15 min, but refresh token lasts 7 days.
        // If we call getCurrentUser first with an expired access token, it fails with 401
        // and we never reach the refreshToken call.
        //
        // Order matters:
        // 1. refreshToken() - uses refresh_token cookie (7 days) to get new access token
        // 2. getCurrentUser() - now works with fresh access token in cookie + memory
        try {
          await authApi.refreshToken();
          // Routed through authLogger so the message is gated on production
          // and goes through the PHI-redaction sanitizer. Raw console.log
          // leaked auth-flow details to the browser console (audit F-18).
          authLogger.debug('Access token refreshed from refresh token');
        } catch {
          // Refresh token invalid or expired - user must re-login
          authLogger.debug('Refresh token invalid, user not authenticated');
          setUser(null);
          setIsLoading(false);
          return;
        }

        // Now get current user with the fresh access token
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
        authLogger.debug('Session restored successfully');
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
      setIdleWarningVisible(false);
    }
  }, []);

  // Reset both idle timers — called on user activity and when the user
  // clicks "Stay signed in" on the warning dialog. Memoized so the effect
  // below doesn't re-subscribe event listeners on every render.
  const resetIdleTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    setIdleWarningVisible(false);
    warnTimerRef.current = setTimeout(() => setIdleWarningVisible(true), INACTIVITY_WARNING_MS);
    logoutTimerRef.current = setTimeout(() => {
      // Force-reload to login so any in-memory PHI in other open tabs/pages
      // is discarded; a plain SPA route change would keep the React tree.
      void logout().finally(() => {
        window.location.href = '/?sessionExpired=true';
      });
    }, INACTIVITY_TIMEOUT_MS);
  }, [logout]);

  // Inactivity watchdog — only runs while authenticated. Activity events
  // are the standard HIPAA-scope set: typing, clicking, touching, scrolling.
  // Mouse MOVE is deliberately excluded — a wandering cursor from an open
  // tab in another monitor would keep the session alive against HIPAA intent.
  useEffect(() => {
    if (!user) {
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      setIdleWarningVisible(false);
      return;
    }

    const handleActivity = () => resetIdleTimers();
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handleActivity, { passive: true });
    }
    resetIdleTimers();

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handleActivity);
      }
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, [user, resetIdleTimers]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Wire logout to API client auth failure callback
  // When a 401 occurs and refresh fails, this triggers automatic logout
  useEffect(() => {
    setOnAuthFailure(() => {
      logout();
    });
    return () => setOnAuthFailure(() => {});
  }, [logout]);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    error,
    setError,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {idleWarningVisible && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="idle-warning-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h2
              id="idle-warning-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Session about to expire
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              You'll be signed out in 2 minutes due to inactivity. HIPAA requires
              we automatically end idle sessions to protect your health data.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  void logout().finally(() => {
                    window.location.href = '/?sessionExpired=true';
                  });
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Sign out now
              </button>
              <button
                type="button"
                onClick={resetIdleTimers}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                autoFocus
              >
                Stay signed in
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

