/**
 * Confirm Email Change Page Component
 *
 * Premium dark-themed page that completes a verified email change. Reached via
 * the tokenized link sent to the NEW address. On success the backend swaps the
 * email and revokes all sessions, so we route the user back to login to sign in
 * with their new address.
 */

import { useEffect, useState } from 'react';
import { Heart, CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';
import { authApi } from '../../services/api';

interface ConfirmEmailChangePageProps {
  token: string;
  onSuccess: () => void;
  onNavigateToLogin: () => void;
}

export default function ConfirmEmailChangePage({
  token,
  onSuccess,
  onNavigateToLogin,
}: ConfirmEmailChangePageProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const confirm = async () => {
      try {
        const result = await authApi.confirmEmailChange(token);
        setStatus('success');
        setMessage(result.message || 'Your email address has been updated.');
        // Sessions were revoked server-side — send them to login shortly.
        setTimeout(() => {
          onSuccess();
        }, 2000);
      } catch (error) {
        setStatus('error');
        setMessage(
          (error as { message?: string })?.message ||
            'Failed to change email. The link may be expired or already used.'
        );
      }
    };

    if (token) {
      confirm();
    } else {
      setStatus('error');
      setMessage('No confirmation token provided.');
    }
  }, [token, onSuccess]);

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
                  Confirming Your New Email
                </h1>
                <p className="text-slate-400">Please wait while we update your email address...</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-16 h-16 bg-wellness-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-8 h-8 text-wellness-400" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">
                  Email Updated!
                </h1>
                <p className="text-slate-400 mb-6">{message}</p>
                <p className="text-sm text-slate-500">Redirecting to login — please sign in with your new email...</p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <XCircle className="w-8 h-8 text-red-400" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">
                  Email Change Failed
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
                    Need a new link? Log in and request the change again.
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
