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

import React, { useState } from 'react';
import {
  ArrowLeft,
  User,
  Palette,
  Bell,
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
import ChangePasswordModal from './ChangePasswordModal';

interface AccountSettingsPageProps {
  onBack: () => void;
}

type NotificationSetting = 'emailNotifications' | 'weeklySummary' | 'abnormalAlerts';

export default function AccountSettingsPage({ onBack }: AccountSettingsPageProps) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  // Profile state
  const [displayName, setDisplayName] = useState(user?.email?.split('@')[0] || '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);

  // Password modal
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Notification settings (stored in localStorage for now)
  const [notifications, setNotifications] = useState(() => {
    const stored = localStorage.getItem('omh-notifications');
    return stored ? JSON.parse(stored) : {
      emailNotifications: true,
      weeklySummary: false,
      abnormalAlerts: true,
    };
  });

  // Delete confirmation state
  const [deleteType, setDeleteType] = useState<'data' | 'account' | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const handleSaveName = async () => {
    setIsSavingName(true);
    try {
      // TODO: Implement API call to save display name
      await new Promise(resolve => setTimeout(resolve, 500));
      setIsEditingName(false);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleNotificationChange = (key: NotificationSetting) => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    localStorage.setItem('omh-notifications', JSON.stringify(updated));
  };

  const handleExportData = async () => {
    setIsExporting(true);
    try {
      const data = await settingsApi.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ownmyhealth-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteData = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await settingsApi.deleteAllData();
      setDeleteType(null);
      window.location.reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete data');
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
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
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
              <div className="flex items-center space-x-3">
                {isEditingName ? (
                  <>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={isSavingName}
                      className="px-4 py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    >
                      {isSavingName ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </button>
                    <button
                      onClick={() => setIsEditingName(false)}
                      className="px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-slate-900 dark:text-white">{displayName}</span>
                    <button
                      onClick={() => setIsEditingName(true)}
                      className="px-4 py-2 text-sm text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
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

        {/* Notifications Section */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center">
                <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Notifications</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">For future use</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {[
              { key: 'emailNotifications' as NotificationSetting, label: 'Email Notifications', description: 'Receive important updates via email' },
              { key: 'weeklySummary' as NotificationSetting, label: 'Weekly Summary', description: 'Get a weekly digest of your health data' },
              { key: 'abnormalAlerts' as NotificationSetting, label: 'Abnormal Results Alerts', description: 'Be notified when results are outside normal range' },
            ].map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{label}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
                </div>
                <button
                  onClick={() => handleNotificationChange(key)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    notifications[key] ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      notifications[key] ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>

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
          <div className="p-6 space-y-4">
            {/* Export Data */}
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Export All My Data</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Download all your health data as JSON</p>
              </div>
              <button
                onClick={handleExportData}
                disabled={isExporting}
                className="flex items-center px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
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
            <div className="flex items-center justify-between py-2 border-t border-slate-100 dark:border-slate-700 pt-4">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Delete All My Data</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Permanently delete all health records</p>
              </div>
              <button
                onClick={() => setDeleteType('data')}
                className="flex items-center px-4 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Data
              </button>
            </div>

            {/* Delete Account */}
            <div className="flex items-center justify-between py-2 border-t border-slate-100 dark:border-slate-700 pt-4">
              <div>
                <p className="font-medium text-red-600 dark:text-red-400">Delete My Account</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Permanently delete your account and all data</p>
              </div>
              <button
                onClick={() => setDeleteType('account')}
                className="flex items-center px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {deleteType === 'account' ? 'Delete Account' : 'Delete All Data'}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-slate-600 dark:text-slate-400 mb-4">
                {deleteType === 'account'
                  ? 'This will permanently delete your account, all your health data, and remove you from our system.'
                  : 'This will permanently delete all your biomarkers, health records, and uploaded documents.'}
              </p>

              {deleteError && (
                <div className="flex items-center space-x-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
                </div>
              )}

              {deleteType === 'account' && (
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
              )}

              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setDeleteType(null);
                    setDeletePassword('');
                    setDeleteError(null);
                  }}
                  className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteType === 'account' ? handleDeleteAccount : handleDeleteData}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete {deleteType === 'account' ? 'Account' : 'Data'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
