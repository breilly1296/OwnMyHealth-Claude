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
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // Basic validation
    if (!email.trim()) {
      setLocalError('Email is required');
      return;
    }

    if (!password) {
      setLocalError('Password is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setLocalError('Please enter a valid email address');
      return;
    }

    try {
      await onLogin(email, password);
    } catch (error) {
      logger.error('Login failed', { error });
    }
  };

  const handleDemoLogin = async () => {
    if (onDemoLogin) {
      try {
        await onDemoLogin();
      } catch (error) {
        logger.error('Demo login failed', { error });
      }
    }
  };

  const displayError = localError || error;

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

        {/* Login Form Container */}
        <main className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
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
                  Email address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Mail className="w-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full pl-11 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                    placeholder="you@example.com"
                    disabled={isLoading}
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                    Password
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
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-11 pr-12 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                    placeholder="Enter your password"
                    disabled={isLoading}
                    autoComplete="current-password"
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

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-800" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-slate-950 text-slate-500">or continue with</span>
              </div>
            </div>

            {/* Demo Login Button */}
            {onDemoLogin && (
              <button
                type="button"
                onClick={handleDemoLogin}
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-slate-800/50 text-slate-300 font-medium rounded-xl border border-slate-700 hover:bg-slate-800 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
