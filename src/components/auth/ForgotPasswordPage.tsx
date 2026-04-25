/**
 * Forgot Password Page Component
 *
 * Premium dark-themed page for password reset requests.
 */

import React, { useState } from 'react';
import { Heart, Mail, AlertCircle, Loader2, CheckCircle, ArrowLeft, Shield } from 'lucide-react';
import { authApi } from '../../services/api';

interface ForgotPasswordPageProps {
  onNavigateToLogin: () => void;
}

export default function ForgotPasswordPage({
  onNavigateToLogin,
}: ForgotPasswordPageProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSuccess(true);
    } catch (err) {
      // We still show success to not reveal if email exists
      // But handle network errors
      const errorMessage = (err as { message?: string })?.message;
      if (errorMessage?.includes('network') || errorMessage?.includes('connect')) {
        setError(errorMessage);
      } else {
        setSuccess(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <header className="p-6 border-b border-slate-800">
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

        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md">
            <div className="bg-slate-900/50 rounded-2xl border border-slate-800 shadow-xl p-8 text-center">
              <div className="w-16 h-16 bg-wellness-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-8 h-8 text-wellness-400" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Check Your Email</h1>
              <p className="text-slate-400 mb-6">
                If an account exists with <strong className="text-white">{email}</strong>, we've sent a password reset link.
              </p>
              <p className="text-sm text-slate-500 mb-6">
                The link will expire in 1 hour. Check your spam folder if you don't see it.
              </p>
              <button
                onClick={onNavigateToLogin}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold rounded-xl hover:from-brand-600 hover:to-brand-700 transition-all shadow-lg shadow-brand-500/25"
              >
                Back to Login
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="p-6 border-b border-slate-800">
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

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-slate-900/50 rounded-2xl border border-slate-800 shadow-xl p-8">
            {/* Back button */}
            <button
              onClick={onNavigateToLogin}
              className="flex items-center text-slate-400 hover:text-white mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to login
            </button>

            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-white mb-2">Forgot Password?</h1>
              <p className="text-slate-400">
                Enter your email and we'll send you a link to reset your password.
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

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

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold rounded-xl hover:from-brand-600 hover:to-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-500/25"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </form>
          </div>

          {/* Security Notice */}
          <div className="mt-6 text-center">
            <div className="flex items-center justify-center gap-2 text-slate-500 text-xs">
              <Shield className="w-4 h-4" />
              <span>Secure password reset via encrypted email link.</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
