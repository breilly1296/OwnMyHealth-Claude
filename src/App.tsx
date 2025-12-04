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
 *
 * Component Hierarchy:
 * App (root)
 * └── ErrorBoundary (error handling)
 *     └── AuthProvider (authentication context)
 *         └── AppContent (conditional rendering)
 *             ├── LoginPage (unauthenticated)
 *             ├── RegisterPage (registering)
 *             └── Dashboard (authenticated)
 *
 * @module App
 */

import React, { useState } from 'react';
import { Dashboard } from './components/dashboard';
import { LoginPage, RegisterPage } from './components/auth';
import { ErrorBoundary } from './components/common';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { authApi } from './services/api';
import { Loader2, Heart } from 'lucide-react';

/** Possible authentication views when user is not logged in */
type AuthView = 'login' | 'register';

/**
 * Main application wrapper that handles authentication state
 */
function AppContent() {
  const { user, isAuthenticated, isLoading, login, register, logout, error, clearError } = useAuth();
  const [authView, setAuthView] = useState<AuthView>('login');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

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

  // Not authenticated - show login or register
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

    return (
      <LoginPage
        onLogin={handleLogin}
        onDemoLogin={handleDemoLogin}
        onSwitchToRegister={switchToRegister}
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
