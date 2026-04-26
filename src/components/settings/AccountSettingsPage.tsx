/**
 * AccountSettingsPage - User account settings and preferences
 *
 * Sections:
 * 1. Profile - Display name, email, password
 * 2. Appearance - Theme toggle (light/dark/system)
 * 3. Notifications - Email notification preferences
 * 4. Data & Privacy - Export/delete data and account
 * 5. Health Focus Areas - Placeholder for future features
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  User,
  Palette,
  Shield,
  Heart,
  Lock,
  Mail,
  Download,
  Trash2,
  AlertTriangle,
  Loader2,
  Sun,
  Moon,
  Monitor,
  CheckCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { settingsApi } from '../../services/api';
import { logger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHelpers';

const settingsLogger = logger.createLogger('Settings');
import ChangePasswordModal from './ChangePasswordModal';
import HealthProfileSection from './HealthProfileSection';
import PlanSection from './PlanSection';
import NotificationSettingsSection from './NotificationSettingsSection';

function composeDisplayName(firstName: string | null, lastName: string | null, fallback: string): string {
  const parts = [firstName, lastName].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(' ') : fallback;
}

function splitDisplayName(displayName: string): { firstName: string; lastName: string } {
  const trimmed = displayName.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: '' };
  }
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim(),
  };
}

interface AccountSettingsPageProps {
  onBack: () => void;
}

export default function AccountSettingsPage({ onBack }: AccountSettingsPageProps) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  const emailLocal = user?.email?.split('@')[0] || '';

  // Profile state. Start blank — the email-local fallback only kicks in
  // *after* the profile fetch resolves and we know there's no real name.
  // Initializing with emailLocal caused the field to flash the email
  // username before the real "First Last" rendered.
  const [displayName, setDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  // Password modal
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Delete confirmation state
  const [deleteType, setDeleteType] = useState<'data' | 'account' | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast((current) => (current?.message === message ? null : current)), 3000);
  }, []);

  // Load profile from backend on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const profile = await settingsApi.getProfile();
        if (cancelled) return;
        setDisplayName(composeDisplayName(profile.firstName, profile.lastName, emailLocal));
      } catch (err) {
        if (cancelled) return;
        setProfileLoadError(extractErrorMessage(err, 'Failed to load profile'));
      } finally {
        if (!cancelled) setIsLoadingProfile(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [emailLocal]);

  const handleSaveName = async () => {
    setIsSavingName(true);
    try {
      const { firstName, lastName } = splitDisplayName(displayName);
      const profile = await settingsApi.updateProfile({ firstName, lastName });
      setDisplayName(composeDisplayName(profile.firstName, profile.lastName, emailLocal));
      setIsEditingName(false);
      showToast('Display name updated', 'success');
    } catch (err) {
      showToast(extractErrorMessage(err, 'Failed to update display name'), 'error');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleExportData = async () => {
    setIsExporting(true);
    try {
      const data = await settingsApi.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ownmyhealth_export_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (err) {
      const message = extractErrorMessage(err, 'Data export failed');
      settingsLogger.error('Data export failed', { error: message });
      showToast(message, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteData = async () => {
    if (!deletePassword) {
      setDeleteError('Please enter your password');
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await settingsApi.deleteAllData(deletePassword);
      setDeleteType(null);
      setDeletePassword('');
      setToast({ message: 'All health data deleted', type: 'success' });
      // Redirect to dashboard after showing toast
      setTimeout(() => {
        onBack();
      }, 1500);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to delete data');
      setDeleteError(message);
      setToast({ message, type: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError('Please enter your password');
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await settingsApi.deleteAccount(deletePassword);
      // Redirect to login after account deletion
      window.location.href = '/';
    } catch (err) {
      setDeleteError(extractErrorMessage(err, 'Failed to delete account'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 overflow-x-hidden">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <button
              onClick={onBack}
              className="flex items-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors mr-4"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              <span className="hidden sm:inline">Back to Dashboard</span>
            </button>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Account Settings</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Profile Section */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-brand-100 dark:bg-brand-900/30 rounded-xl flex items-center justify-center">
                <User className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Profile</h2>
            </div>
          </div>
          <div className="p-6 space-y-6">
            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Display Name
              </label>
              {isLoadingProfile ? (
                <div className="h-10 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
              ) : profileLoadError ? (
                <div className="flex items-center space-x-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-600 dark:text-red-400">{profileLoadError}</p>
                </div>
              ) : isEditingName ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                  <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
                    <button
                      onClick={() => setIsEditingName(false)}
                      className="flex-1 sm:flex-none px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveName}
                      disabled={isSavingName}
                      className="flex-1 sm:flex-none px-4 py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors flex items-center justify-center"
                    >
                      {isSavingName ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-slate-900 dark:text-white">{displayName}</span>
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="px-4 py-2 text-sm text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Email Address
              </label>
              <div className="flex items-center space-x-3">
                <div className="flex-1 flex items-center px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl">
                  <Mail className="w-4 h-4 text-slate-400 mr-3" />
                  <span className="text-slate-900 dark:text-white">{user?.email}</span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
                  Read-only
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Email changes aren't supported yet. Contact support if you need to update your email.
              </p>
            </div>

            {/* Change Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Password
              </label>
              <button
                onClick={() => setIsPasswordModalOpen(true)}
                className="flex items-center px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <Lock className="w-4 h-4 mr-2" />
                Change Password
              </button>
            </div>
          </div>
        </section>

        {/* Appearance Section */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                <Palette className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Appearance</h2>
            </div>
          </div>
          <div className="p-6">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              Theme
            </label>
            <div className="flex flex-wrap gap-3">
              {[
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
                { value: 'system', label: 'System', icon: Monitor },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value as 'light' | 'dark' | 'system')}
                  className={`flex items-center px-4 py-3 rounded-xl border-2 transition-all ${
                    theme === value
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Icon className="w-5 h-5 mr-2" />
                  {label}
                  {theme === value && <CheckCircle className="w-4 h-4 ml-2" />}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Notifications Section — new nested-shape toggles. Replaces the
            previous flat 3-toggle block; the new component handles the full
            set (master + 5 sub-toggles) and persists via PATCH on change. */}
        <NotificationSettingsSection
          onError={(message) => showToast(message, 'error')}
        />

        {/* Plan & Usage Section */}
        <PlanSection onError={(message) => showToast(message, 'error')} />

        {/* Health Profile Section */}
        <HealthProfileSection
          onError={(message) => showToast(message, 'error')}
        />

        {/* Data & Privacy Section */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Data & Privacy</h2>
            </div>
          </div>
          <div className="p-4 md:p-6 space-y-4">
            {/* Export Data */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 py-2 min-w-0">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Export All My Data</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Download all your health data as JSON</p>
              </div>
              <button
                onClick={handleExportData}
                disabled={isExporting}
                className="flex items-center justify-center px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors w-full sm:w-auto"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : exportSuccess ? (
                  <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                {exportSuccess ? 'Downloaded!' : 'Export'}
              </button>
            </div>

            {/* Delete All Data */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 py-2 border-t border-slate-100 dark:border-slate-700 pt-4 min-w-0">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Delete All My Data</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Permanently delete all health records</p>
              </div>
              <button
                onClick={() => setDeleteType('data')}
                className="flex items-center justify-center px-4 py-2.5 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full sm:w-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Data
              </button>
            </div>

            {/* Delete Account */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 py-2 border-t border-slate-100 dark:border-slate-700 pt-4 min-w-0">
              <div>
                <p className="font-medium text-red-600 dark:text-red-400">Delete My Account</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Permanently delete your account and all data</p>
              </div>
              <button
                onClick={() => setDeleteType('account')}
                className="flex items-center justify-center px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors w-full sm:w-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Account
              </button>
            </div>
          </div>
        </section>

        {/* Health Focus Areas Section */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                <Heart className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Health Focus Areas</h2>
            </div>
          </div>
          <div className="p-6">
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Heart className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 font-medium">Coming Soon</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Customize your dashboard for specific health conditions
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

      {/* Delete Confirmation Modal */}
      {deleteType && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl w-full md:max-w-md max-h-[95vh] md:max-h-[90vh] shadow-xl overflow-y-auto">
            <div className="p-4 md:p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {deleteType === 'account' ? 'Delete Account' : 'Delete All Health Data'}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-slate-600 dark:text-slate-400 mb-4">
                {deleteType === 'account'
                  ? 'This will permanently delete your account, all your health data, and remove you from our system.'
                  : 'This will permanently delete all your biomarker measurements, uploaded files, and health records. This action cannot be undone.'}
              </p>

              {deleteError && (
                <div className="flex items-center space-x-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Enter your password to confirm
                </label>
                <div className="relative">
                  <input
                    type={showDeletePassword ? 'text' : 'password'}
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Your password"
                    className="w-full px-4 py-2.5 pr-10 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeletePassword(!showDeletePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showDeletePassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
                <button
                  onClick={() => {
                    setDeleteType(null);
                    setDeletePassword('');
                    setDeleteError(null);
                  }}
                  className="flex-1 px-4 py-3 sm:py-2.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteType === 'account' ? handleDeleteAccount : handleDeleteData}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-3 sm:py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center font-medium"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      {deleteType === 'account' ? 'Delete Account' : 'Delete Everything'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
          <div
            className={`flex items-center space-x-3 px-4 py-3 rounded-xl shadow-lg ${
              toast.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
            <span className="font-medium">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-2 hover:opacity-80"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
