/**
 * App.tsx - Root Application Component
 *
 * This is the main entry point for the OwnMyHealth React application.
 * It provides the following functionality:
 *
 * 1. Authentication Provider - Wraps the app with AuthContext for global auth state
 * 2. Error Boundary - Catches and handles React rendering errors gracefully
 * 3. Routing Logic - Conditionally renders Login, Register, or Dashboard based on auth state
 * 4. Loading States - Shows loading spinner while checking authentication status
 * 5. URL-based Routes - Handles /verify-email and /reset-password routes
 *
 * Component Hierarchy:
 * App (root)
 * └── ErrorBoundary (error handling)
 *     └── AuthProvider (authentication context)
 *         └── AppContent (conditional rendering)
 *             ├── VerifyEmailPage (email verification)
 *             ├── ResetPasswordPage (password reset)
 *             ├── ForgotPasswordPage (request password reset)
 *             ├── LoginPage (unauthenticated)
 *             ├── RegisterPage (registering)
 *             └── Dashboard (authenticated)
 *
 * @module App
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { ErrorBoundary } from './components/common';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { authApi } from './services/api';
import { Loader2, Heart } from 'lucide-react';

// Lazy load heavy components for code splitting
// Import directly from files to enable proper tree-shaking
const Dashboard = lazy(() => import('./components/dashboard/Dashboard'));
const LoginPage = lazy(() => import('./components/auth/LoginPage'));
const RegisterPage = lazy(() => import('./components/auth/RegisterPage'));
const VerifyEmailPage = lazy(() => import('./components/auth/VerifyEmailPage'));
const ResetPasswordPage = lazy(() => import('./components/auth/ResetPasswordPage'));
const ForgotPasswordPage = lazy(() => import('./components/auth/ForgotPasswordPage'));

/** Loading fallback for lazy-loaded components */
function LoadingFallback() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/25">
          <Heart className="w-8 h-8 text-white" />
        </div>
        <Loader2 className="w-6 h-6 animate-spin text-brand-400 mx-auto mb-3" />
        <p className="text-slate-400">Loading...</p>
      </div>
    </div>
  );
}

/** Possible authentication views when user is not logged in */
type AuthView = 'login' | 'register' | 'forgot-password';

/** URL-based routes that should be handled regardless of auth state */
interface SpecialRoute {
  type: 'verify-email' | 'reset-password';
  token: string;
}

/**
 * Parse URL to determine if we're on a special route
 */
function getSpecialRoute(): SpecialRoute | null {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (path === '/verify-email' && token) {
    return { type: 'verify-email', token };
  }

  if (path === '/reset-password' && token) {
    return { type: 'reset-password', token };
  }

  return null;
}

/**
 * Navigate to home/login (clears special routes)
 */
function navigateToLogin() {
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Main application wrapper that handles authentication state
 */
function AppContent() {
  const { user, isAuthenticated, isLoading, login, register, logout, error, clearError } = useAuth();
  const [authView, setAuthView] = useState<AuthView>('login');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [specialRoute, setSpecialRoute] = useState<SpecialRoute | null>(getSpecialRoute);

  // Listen for URL changes (back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      setSpecialRoute(getSpecialRoute());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // SECURITY: Clear sensitive tokens from URL immediately after reading
  // This prevents token leakage via browser history, Referer headers, and server logs
  useEffect(() => {
    if (specialRoute?.token) {
      // Clear the query string but keep the path (e.g., /verify-email or /reset-password)
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [specialRoute]);

  // Handle special routes first (verify-email, reset-password)
  if (specialRoute) {
    if (specialRoute.type === 'verify-email') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <VerifyEmailPage
            token={specialRoute.token}
            onSuccess={() => {
              navigateToLogin();
              setSpecialRoute(null);
            }}
            onNavigateToLogin={() => {
              navigateToLogin();
              setSpecialRoute(null);
            }}
          />
        </Suspense>
      );
    }

    if (specialRoute.type === 'reset-password') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <ResetPasswordPage
            token={specialRoute.token}
            onSuccess={() => {
              navigateToLogin();
              setSpecialRoute(null);
            }}
            onNavigateToLogin={() => {
              navigateToLogin();
              setSpecialRoute(null);
            }}
          />
        </Suspense>
      );
    }
  }

  // Show loading screen while checking auth status
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/25">
            <Heart className="w-8 h-8 text-white" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-brand-400 mx-auto mb-3" />
          <p className="text-slate-400">Loading OwnMyHealth...</p>
        </div>
      </div>
    );
  }

  // Handle login
  const handleLogin = async (email: string, password: string) => {
    clearError();
    setIsAuthLoading(true);
    try {
      await login(email, password);
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Handle demo login
  const handleDemoLogin = async () => {
    clearError();
    setIsAuthLoading(true);
    try {
      // Try demo endpoint first
      await authApi.demoLogin();
      // Refresh auth state by getting current user
      window.location.reload();
    } catch {
      // Fall back to regular login with demo credentials
      try {
        await login('demo@ownmyhealth.com', 'Demo123!');
      } catch {
        // Error handled by context
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Handle registration
  const handleRegister = async (email: string, password: string, firstName?: string, lastName?: string) => {
    clearError();
    setIsAuthLoading(true);
    try {
      await register(email, password, firstName, lastName);
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Switch auth views and clear errors
  const switchToLogin = () => {
    clearError();
    setAuthView('login');
  };

  const switchToRegister = () => {
    clearError();
    setAuthView('register');
  };

  const switchToForgotPassword = () => {
    clearError();
    setAuthView('forgot-password');
  };

  // Not authenticated - show login, register, or forgot password
  if (!isAuthenticated) {
    if (authView === 'register') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <RegisterPage
            onRegister={handleRegister}
            onSwitchToLogin={switchToLogin}
            error={error}
            isLoading={isAuthLoading}
          />
        </Suspense>
      );
    }

    if (authView === 'forgot-password') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <ForgotPasswordPage
            onNavigateToLogin={switchToLogin}
          />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<LoadingFallback />}>
        <LoginPage
          onLogin={handleLogin}
          onDemoLogin={handleDemoLogin}
          onSwitchToRegister={switchToRegister}
          onForgotPassword={switchToForgotPassword}
          error={error}
          isLoading={isAuthLoading}
        />
      </Suspense>
    );
  }

  // Authenticated - show dashboard
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Dashboard user={user} onLogout={logout} />
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
