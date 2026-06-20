/**
 * Register Page Component
 *
 * Premium dark-themed registration page with form validation,
 * password strength requirements, and error handling.
 */

import React, { useState, useMemo } from 'react';
import {
  Heart,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  AlertCircle,
  Loader2,
  Check,
  X,
  Shield,
} from 'lucide-react';
import { authApi } from '../../services/api';

interface RegisterPageProps {
  onRegister: (email: string, password: string, firstName?: string, lastName?: string) => Promise<void>;
  onSwitchToLogin: () => void;
  error: string | null;
  isLoading: boolean;
}

interface PasswordRequirement {
  label: string;
  met: boolean;
}

export default function RegisterPage({
  onRegister,
  onSwitchToLogin,
  error,
  isLoading,
}: RegisterPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // ONB-1: after a successful registration the app used to leave the user on the
  // same form with cleared passwords and no instruction. Show an explicit
  // "check your inbox" state with a working resend (the endpoint already exists).
  const [registered, setRegistered] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  // Password strength validation
  const passwordRequirements: PasswordRequirement[] = useMemo(() => [
    { label: 'At least 12 characters', met: password.length >= 12 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /[0-9]/.test(password) },
    { label: 'One special character (!@#$%^&*)', met: /[!@#$%^&*(),.?":{}|<>]/.test(password) },
  ], [password]);

  const allRequirementsMet = passwordRequirements.every(req => req.met);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // Validation
    if (!email.trim()) {
      setLocalError('Email is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setLocalError('Please enter a valid email address');
      return;
    }

    if (!password) {
      setLocalError('Password is required');
      return;
    }

    if (!allRequirementsMet) {
      setLocalError('Password does not meet all requirements');
      return;
    }

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    try {
      await onRegister(
        email,
        password,
        firstName.trim() || undefined,
        lastName.trim() || undefined
      );
      // Clear sensitive state after successful registration
      setPassword('');
      setConfirmPassword('');
      setRegisteredEmail(email);
      setRegistered(true);
    } catch {
      // Error is handled by parent component
    }
  };

  const handleResend = async () => {
    setResendState('sending');
    try {
      await authApi.resendVerification(registeredEmail);
      setResendState('sent');
    } catch {
      setResendState('error');
    }
  };

  const displayError = localError || error;

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
      <main id="main-content" className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Register Card */}
          <div className="bg-slate-900/50 rounded-2xl border border-slate-800 shadow-xl p-8">
            {registered ? (
              <div className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-wellness-500/10 flex items-center justify-center mb-4">
                  <Mail className="w-6 h-6 text-wellness-400" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Check your inbox</h1>
                <p className="text-slate-400 mb-6">
                  We sent a verification link to{' '}
                  <span className="text-white font-medium">{registeredEmail}</span>. Click it to
                  activate your account, then sign in.
                </p>
                {resendState === 'sent' && (
                  <p role="status" aria-live="polite" className="mb-4 text-sm text-wellness-400">Verification email re-sent.</p>
                )}
                {resendState === 'error' && (
                  <p role="alert" aria-live="assertive" aria-atomic="true" className="mb-4 text-sm text-red-400">Couldn&apos;t resend — please try again.</p>
                )}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendState === 'sending'}
                  className="w-full py-3 px-4 bg-slate-800 text-white font-medium rounded-xl border border-slate-700 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {resendState === 'sending' ? 'Sending…' : "Didn't get it? Resend email"}
                </button>
                <p className="mt-6 text-center text-sm text-slate-400">
                  <button
                    type="button"
                    onClick={onSwitchToLogin}
                    className="font-semibold text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    Back to sign in
                  </button>
                </p>
              </div>
            ) : (
            <>
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
              <p className="text-slate-400">Start tracking your health journey today</p>
            </div>

            {/* Error Message */}
            {displayError && (
              <div
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{displayError}</p>
              </div>
            )}

            {/* Register Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-slate-300 mb-2">
                    First name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="w-5 h-5 text-slate-500" />
                    </div>
                    <input
                      id="firstName"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="block w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                      placeholder="John"
                      disabled={isLoading}
                      autoComplete="given-name"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-slate-300 mb-2">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="block w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                    placeholder="Doe"
                    disabled={isLoading}
                    autoComplete="family-name"
                  />
                </div>
              </div>

              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  Email address <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="w-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                    placeholder="you@example.com"
                    disabled={isLoading}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                  Password <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 pr-12 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                    placeholder="Create a strong password"
                    disabled={isLoading}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5 text-slate-500 hover:text-slate-400 transition-colors" />
                    ) : (
                      <Eye className="w-5 h-5 text-slate-500 hover:text-slate-400 transition-colors" />
                    )}
                  </button>
                </div>

                {/* Password Requirements */}
                {password && (
                  <div className="mt-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <p className="text-xs font-medium text-slate-400 mb-2">Password requirements:</p>
                    <ul className="space-y-1">
                      {passwordRequirements.map((req, index) => (
                        <li
                          key={index}
                          className={`text-xs flex items-center gap-2 ${
                            req.met ? 'text-wellness-400' : 'text-slate-500'
                          }`}
                        >
                          {req.met ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <X className="w-3.5 h-3.5" />
                          )}
                          {req.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Confirm Password Field */}
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-2">
                  Confirm password <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`block w-full pl-10 pr-12 py-3 bg-slate-900 border rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all ${
                      confirmPassword && !passwordsMatch
                        ? 'border-red-500/50 bg-red-500/5'
                        : confirmPassword && passwordsMatch
                        ? 'border-wellness-500/50 bg-wellness-500/5'
                        : 'border-slate-700'
                    }`}
                    placeholder="Confirm your password"
                    disabled={isLoading}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-5 h-5 text-slate-500 hover:text-slate-400 transition-colors" />
                    ) : (
                      <Eye className="w-5 h-5 text-slate-500 hover:text-slate-400 transition-colors" />
                    )}
                  </button>
                </div>
                {confirmPassword && !passwordsMatch && (
                  <p className="mt-1 text-xs text-red-400">Passwords do not match</p>
                )}
                {confirmPassword && passwordsMatch && (
                  <p className="mt-1 text-xs text-wellness-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Passwords match
                  </p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading || !allRequirementsMet || !passwordsMatch}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold rounded-xl hover:from-brand-600 hover:to-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-500/25"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create account'
                )}
              </button>
            </form>

            {/* Login Link */}
            <p className="mt-6 text-center text-sm text-slate-400">
              Already have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="font-semibold text-brand-400 hover:text-brand-300 transition-colors"
              >
                Sign in
              </button>
            </p>
            </>
            )}
          </div>

          {/* Privacy Notice */}
          <div className="mt-6 text-center">
            <div className="flex items-center justify-center gap-2 text-slate-500 text-xs">
              <Shield className="w-4 h-4" />
              <span>
                By creating an account, you agree to our{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline text-cyan-400 hover:text-cyan-300">Terms of Service</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline text-cyan-400 hover:text-cyan-300">Privacy Policy</a>.
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-600">Your health data is encrypted and secure.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
