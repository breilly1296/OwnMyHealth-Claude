/**
 * Verify Email Page Component
 *
 * Premium dark-themed page for email verification.
 */

import { useEffect, useRef, useState } from 'react';
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

  // Keep the latest onSuccess without making it an effect dependency — the
  // verification call consumes a ONE-TIME token, so it must fire exactly once,
  // but onSuccess is a fresh inline closure from App.tsx on every render.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  // Run-once guard. Without it the call fires twice — once from React
  // StrictMode's dev double-invoke, and (even in production) once more when
  // AuthContext settles its initial session check and re-renders the parent.
  // The second call hits the now-consumed token and 400s, flipping a
  // SUCCESSFUL verification to a false "failed" screen.
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;

    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    (async () => {
      try {
        const result = await authApi.verifyEmail(token);
        setStatus('success');
        setMessage(result.message || 'Your email has been verified successfully!');
        setTimeout(() => onSuccessRef.current(), 2000);
      } catch (error) {
        setStatus('error');
        setMessage(
          (error as { message?: string })?.message ||
            'Failed to verify email. The link may be expired or invalid.'
        );
      }
    })();
  }, [token]);

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
          <div className="bg-slate-900/50 rounded-2xl border border-slate-800 shadow-xl p-8 text-center">
            {status === 'loading' && (
              <>
                <div className="w-16 h-16 bg-brand-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">
                  Verifying Your Email
                </h1>
                <p className="text-slate-400">Please wait while we verify your email address...</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-16 h-16 bg-wellness-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-8 h-8 text-wellness-400" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">
                  Email Verified!
                </h1>
                <p className="text-slate-400 mb-6">{message}</p>
                <p className="text-sm text-slate-500">Redirecting to login...</p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <XCircle className="w-8 h-8 text-red-400" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">
                  Verification Failed
                </h1>
                <p className="text-slate-400 mb-6">{message}</p>
                <div className="space-y-3">
                  <button
                    onClick={onNavigateToLogin}
                    className="w-full py-3.5 px-4 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold rounded-xl hover:from-brand-600 hover:to-brand-700 transition-all shadow-lg shadow-brand-500/25"
                  >
                    Go to Login
                  </button>
                  <p className="text-sm text-slate-500 flex items-center justify-center gap-1">
                    <Mail className="w-4 h-4" />
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
