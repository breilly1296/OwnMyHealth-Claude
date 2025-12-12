/**
 * Verify Email Page Component
 *
 * Handles email verification when user clicks the link from their email.
 * Automatically verifies on mount and shows appropriate status.
 */

import React, { useEffect, useState } from 'react';
import { Heart, CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';
import { authApi } from '../../services/api';

interface VerifyEmailPageProps {
  token: string;
  onSuccess: () => void;
  onNavigateToLogin: () => void;
}

export default function VerifyEmailPage({
  token,
  onSuccess,
  onNavigateToLogin,
}: VerifyEmailPageProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        const result = await authApi.verifyEmail(token);
        setStatus('success');
        setMessage(result.message || 'Your email has been verified successfully!');
        // Wait a moment then redirect
        setTimeout(() => {
          onSuccess();
        }, 2000);
      } catch (error) {
        setStatus('error');
        setMessage(
          (error as { message?: string })?.message ||
            'Failed to verify email. The link may be expired or invalid.'
        );
      }
    };

    if (token) {
      verifyEmail();
    } else {
      setStatus('error');
      setMessage('No verification token provided.');
    }
  }, [token, onSuccess]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 flex flex-col">
      {/* Header */}
      <header className="p-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/25">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              OwnMyHealth
            </span>
            <p className="text-xs text-slate-500 -mt-0.5">Your personal health companion</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/50 p-8 text-center">
            {status === 'loading' && (
              <>
                <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                  Verifying Your Email
                </h1>
                <p className="text-slate-500">Please wait while we verify your email address...</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                  Email Verified!
                </h1>
                <p className="text-slate-500 mb-6">{message}</p>
                <p className="text-sm text-slate-400">Redirecting to login...</p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <XCircle className="w-8 h-8 text-red-600" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                  Verification Failed
                </h1>
                <p className="text-slate-500 mb-6">{message}</p>
                <div className="space-y-3">
                  <button
                    onClick={onNavigateToLogin}
                    className="w-full py-3 px-4 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-colors"
                  >
                    Go to Login
                  </button>
                  <p className="text-sm text-slate-500">
                    <Mail className="w-4 h-4 inline mr-1" />
                    Need a new verification link? Log in and request one.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
