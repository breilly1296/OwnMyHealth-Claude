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

import React, { useState, useEffect } from 'react';
import { Dashboard } from './components/dashboard';
import {
  LoginPage,
  RegisterPage,
  VerifyEmailPage,
  ResetPasswordPage,
  ForgotPasswordPage,
} from './components/auth';
import { ErrorBoundary, AdminOnly } from './components/common';
import { AdminPanel } from './components/admin';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { authApi } from './services/api';
import { Loader2, Heart } from 'lucide-react';

/** Possible authentication views when user is not logged in */
type AuthView = 'login' | 'register' | 'forgot-password';

/** URL-based routes that should be handled regardless of auth state */
interface SpecialRoute {
  type: 'verify-email' | 'reset-password' | 'admin';
  token?: string;
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

  if (path === '/admin' || path.startsWith('/admin/')) {
    return { type: 'admin' };
  }

  return null;
}

/**
 * Navigate to admin panel
 */
function navigateToAdmin() {
  window.history.pushState({}, '', '/admin');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Navigate to home/dashboard
 */
function navigateToHome() {
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
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

  // Handle special routes first (verify-email, reset-password, admin)
  if (specialRoute) {
    if (specialRoute.type === 'verify-email' && specialRoute.token) {
      return (
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
      );
    }

    if (specialRoute.type === 'reset-password' && specialRoute.token) {
      return (
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
      );
    }

    // Admin panel route - requires authentication and ADMIN role
    if (specialRoute.type === 'admin') {
      if (!isAuthenticated) {
        // Redirect to login if not authenticated
        navigateToLogin();
        setSpecialRoute(null);
      } else {
        return (
          <AdminOnly
            fallback={
              <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                  <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
                  <p className="text-slate-600 mb-4">You do not have permission to access the admin panel.</p>
                  <button
                    onClick={() => {
                      navigateToHome();
                      setSpecialRoute(null);
                    }}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                  >
                    Return to Dashboard
                  </button>
                </div>
              </div>
            }
          >
            <AdminPanel
              onBack={() => {
                navigateToHome();
                setSpecialRoute(null);
              }}
            />
          </AdminOnly>
        );
      }
    }
  }

  // Show loading screen while checking auth status
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/25">
            <Heart className="w-8 h-8 text-white" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-brand-500 mx-auto mb-3" />
          <p className="text-slate-600">Loading OwnMyHealth...</p>
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
        <RegisterPage
          onRegister={handleRegister}
          onSwitchToLogin={switchToLogin}
          error={error}
          isLoading={isAuthLoading}
        />
      );
    }

    if (authView === 'forgot-password') {
      return (
        <ForgotPasswordPage
          onNavigateToLogin={switchToLogin}
        />
      );
    }

    return (
      <LoginPage
        onLogin={handleLogin}
        onDemoLogin={handleDemoLogin}
        onSwitchToRegister={switchToRegister}
        onForgotPassword={switchToForgotPassword}
        error={error}
        isLoading={isAuthLoading}
      />
    );
  }

  // Authenticated - show dashboard
  return <Dashboard user={user} onLogout={logout} />;
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
