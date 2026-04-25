/**
 * Login Page Component
 *
 * Premium dark-themed login page with professional branding.
 * Provides user login functionality with form validation and error handling.
 */

import React, { useState } from 'react';
import {
  Heart,
  Eye,
  EyeOff,
  Mail,
  Lock,
  AlertCircle,
  Loader2,
  Shield,
  FileText,
  TrendingUp,
  Activity,
} from 'lucide-react';
import { logger } from '../../utils/logger';

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onDemoLogin?: () => Promise<void>;
  onSwitchToRegister: () => void;
  onForgotPassword?: () => void;
  error: string | null;
  isLoading: boolean;
}

export default function LoginPage({
  onLogin,
  onDemoLogin,
  onSwitchToRegister,
  onForgotPassword,
  error,
  isLoading,
}: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setPasswordError(null);

    // Field-level validation. Both errors render inline below their field;
    // we set them all up-front (instead of returning on first miss) so the
    // user sees every problem in one pass.
    let hasError = false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) {
      setEmailError('Email is required');
      hasError = true;
    } else if (!emailRegex.test(email)) {
      setEmailError('Please enter a valid email address');
      hasError = true;
    }
    if (!password) {
      setPasswordError('Password is required');
      hasError = true;
    }
    if (hasError) return;

    try {
      await onLogin(email, password);
    } catch (err) {
      // Keep email so a mistyped password doesn't force re-typing the address.
      // Clear the password field — wrong-credential or any failure should
      // require fresh entry.
      setPassword('');
      // DEV-only log. Error objects can carry request bodies / headers in
      // their nested fields; logging them in production is a leak risk.
      if (import.meta.env.DEV) {
        logger.error('Login failed', { error: err });
      }
    }
  };

  const handleDemoLogin = async () => {
    if (onDemoLogin) {
      try {
        await onDemoLogin();
      } catch (err) {
        if (import.meta.env.DEV) {
          logger.error('Demo login failed', { error: err });
        }
      }
    }
  };

  const displayError = error;

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-12 flex-col justify-between relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 left-0 w-96 h-96 bg-brand-500 rounded-full filter blur-3xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-wellness-500 rounded-full filter blur-3xl" />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/25">
              <Heart className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-2xl font-bold text-white">OwnMyHealth</span>
              <p className="text-sm text-slate-400">Personal Health Platform</p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="relative z-10 max-w-lg">
          <h1 className="text-4xl xl:text-5xl font-bold text-white mb-6 leading-tight">
            Take control of your
            <span className="bg-gradient-to-r from-brand-400 to-wellness-400 bg-clip-text text-transparent"> health data</span>
          </h1>
          <p className="text-lg text-slate-400 mb-10">
            Track biomarkers, understand your insurance coverage, and make informed decisions about your health journey.
          </p>

          {/* Feature Pills */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
              <div className="w-10 h-10 bg-brand-500/20 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">Biomarker Tracking</p>
                <p className="text-slate-500 text-xs">Monitor your vitals</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
              <div className="w-10 h-10 bg-wellness-500/20 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-wellness-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">Trend Analysis</p>
                <p className="text-slate-500 text-xs">See your progress</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
              <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">Lab Reports</p>
                <p className="text-slate-500 text-xs">Upload & extract data</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
              <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">Insurance Intel</p>
                <p className="text-slate-500 text-xs">Understand coverage</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Text */}
        <div className="relative z-10">
          <p className="text-slate-500 text-sm">
            HIPAA-compliant security. Your data is encrypted and never shared.
          </p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col">
        {/* Mobile Header */}
        <header className="lg:hidden p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/25">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold text-white">OwnMyHealth</span>
              <p className="text-xs text-slate-500">Personal Health Platform</p>
            </div>
          </div>
        </header>

        {/* Mobile Value Proposition */}
        <div className="lg:hidden px-6 py-6 border-b border-slate-800 bg-slate-900/50">
          <h1 className="text-xl font-bold text-white mb-4 text-center">
            Take control of your
            <span className="bg-gradient-to-r from-brand-400 to-wellness-400 bg-clip-text text-transparent"> health data</span>
          </h1>

          {/* Condensed Feature Pills */}
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            <div className="flex items-center gap-1.5 bg-slate-800/50 rounded-full px-3 py-1.5 border border-slate-700/50">
              <Activity className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-xs text-slate-300">Biomarkers</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-800/50 rounded-full px-3 py-1.5 border border-slate-700/50">
              <TrendingUp className="w-3.5 h-3.5 text-wellness-400" />
              <span className="text-xs text-slate-300">Trends</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-800/50 rounded-full px-3 py-1.5 border border-slate-700/50">
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs text-slate-300">Lab Reports</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-800/50 rounded-full px-3 py-1.5 border border-slate-700/50">
              <Shield className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs text-slate-300">Insurance</span>
            </div>
          </div>

          {/* Trust Badges */}
          <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Lock className="w-3 h-3" />
              <span>256-bit encrypted</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              <span>HIPAA-compliant</span>
            </div>
          </div>
        </div>

        {/* Login Form Container */}
        <main className="flex-1 flex items-center justify-center px-6 py-8 lg:py-12 lg:px-12">
          <div className="w-full max-w-md">
            {/* Welcome Text */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Welcome back</h2>
              <p className="text-slate-400">Sign in to access your health dashboard</p>
            </div>

            {/* Error Message */}
            {displayError && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{displayError}</p>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  Email address <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Mail className="w-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    className="block w-full pl-11 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                    placeholder="you@example.com"
                    disabled={isLoading}
                    autoComplete="email"
                    required
                  />
                </div>
                {emailError && (
                  <p className="mt-1 text-xs text-red-400">{emailError}</p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                    Password <span className="text-red-400">*</span>
                  </label>
                  {onForgotPassword && (
                    <button
                      type="button"
                      onClick={onForgotPassword}
                      className="text-sm text-brand-400 hover:text-brand-300 font-medium transition-colors"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    className="block w-full pl-11 pr-12 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                    placeholder="Enter your password"
                    disabled={isLoading}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5 text-slate-500 hover:text-slate-400 transition-colors" />
                    ) : (
                      <Eye className="w-5 h-5 text-slate-500 hover:text-slate-400 transition-colors" />
                    )}
                  </button>
                </div>
                {passwordError && (
                  <p className="mt-1 text-xs text-red-400">{passwordError}</p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold rounded-xl hover:from-brand-600 hover:to-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-500/25"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>

            {/* Demo Login Button (dev/staging only — onDemoLogin is undefined in prod) */}
            {onDemoLogin && (
              <button
                type="button"
                onClick={handleDemoLogin}
                disabled={isLoading}
                className="mt-6 w-full py-3.5 px-4 bg-slate-800/50 text-slate-300 font-medium rounded-xl border border-slate-700 hover:bg-slate-800 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Try Demo Account
              </button>
            )}

            {/* Register Link */}
            <p className="mt-8 text-center text-sm text-slate-400">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="font-semibold text-brand-400 hover:text-brand-300 transition-colors"
              >
                Create one
              </button>
            </p>

            {/* Security Notice */}
            <div className="mt-8 pt-8 border-t border-slate-800">
              <div className="flex items-center justify-center gap-2 text-slate-500 text-xs">
                <Shield className="w-4 h-4" />
                <span>256-bit encrypted. Your health data stays private.</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
