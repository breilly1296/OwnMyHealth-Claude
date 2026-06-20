/**
 * ChangeEmailModal - Modal for requesting a verified email-address change.
 *
 * Unlike the password change, this does NOT take effect immediately: submitting
 * re-authenticates with the current password and sends a confirmation link to
 * the NEW address (plus a security notice to the old one). The swap only happens
 * once the user clicks that link (handled by the /confirm-email-change route).
 */

import React, { useState } from 'react';
import { X, Mail, Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { authApi } from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface ChangeEmailModalProps {
  isOpen: boolean;
  currentEmail?: string;
  onClose: () => void;
}

// Pragmatic client-side check; the backend (Zod) is the authority.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ChangeEmailModal({ isOpen, currentEmail, onClose }: ChangeEmailModalProps) {
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const resetForm = () => {
    setNewEmail('');
    setCurrentPassword('');
    setError(null);
    setSentTo(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, handleClose);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = newEmail.trim().toLowerCase();

    if (!EMAIL_RE.test(normalized)) {
      setError('Please enter a valid email address');
      return;
    }
    if (normalized === currentEmail?.toLowerCase()) {
      setError('That is already your email address');
      return;
    }
    if (!currentPassword) {
      setError('Please enter your current password');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.requestEmailChange(normalized, currentPassword);
      setSentTo(normalized);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to request email change'));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-email-title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl w-full md:max-w-md max-h-[95vh] md:max-h-[90vh] overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-brand-100 dark:bg-brand-900/30 rounded-xl flex items-center justify-center">
              <Mail className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            </div>
            <h2 id="change-email-title" className="text-lg font-semibold text-slate-900 dark:text-white">Change Email</h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 overflow-y-auto max-h-[calc(95vh-80px)] md:max-h-none">
          {sentTo ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-lg font-medium text-slate-900 dark:text-white">Confirmation sent</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                We sent a confirmation link to <span className="font-medium">{sentTo}</span>. Open it to
                finish changing your email. The link expires in 1 hour, and your current address stays
                active until then.
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-6 px-4 py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors font-medium"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center space-x-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              <p className="text-sm text-slate-600 dark:text-slate-400">
                Enter the new address and your current password. We'll send a confirmation link to the
                new address — the change only takes effect once you open it.
              </p>

              {/* New Email */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  New Email Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                  required
                />
              </div>

              {/* Current Password */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full px-4 py-2.5 pr-10 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-3 sm:py-2.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 px-4 py-3 sm:py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center font-medium"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    'Send Confirmation Link'
                  )}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
