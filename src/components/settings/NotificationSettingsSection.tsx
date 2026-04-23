/**
 * NotificationSettingsSection
 *
 * Toggle UI for the nested `email.*` preferences shape. Changes save on
 * toggle — no save button. The master `enabled` flag disables (greys out)
 * the rest so users see visually that sub-toggles are inert when email is
 * off globally, but their stored values are preserved (so flipping email
 * back on restores the old choices).
 *
 * Failed PATCHes roll the local state back to the previous value.
 */

import { useEffect, useState } from 'react';
import { Bell, AlertTriangle, Loader2 } from 'lucide-react';
import { settingsApi } from '../../services/api';
import type { EmailNotificationPreferences, NotificationPreferences } from '../../services/api';

interface NotificationSettingsSectionProps {
  onError?: (message: string) => void;
}

interface ToggleRow {
  key: keyof EmailNotificationPreferences;
  label: string;
  description: string;
}

const TOGGLE_ROWS: ToggleRow[] = [
  { key: 'newResults', label: 'New results available', description: 'When a lab upload finishes extracting' },
  { key: 'outOfRangeAlerts', label: 'Out-of-range alerts', description: 'When a biomarker is flagged abnormal' },
  { key: 'goalReminders', label: 'Weekly goal reminders', description: 'Monday check-in on active goals' },
  { key: 'weeklySummary', label: 'Weekly health summary', description: 'Snapshot of your tracked metrics' },
  { key: 'planExpiring', label: 'Plan expiring', description: '7 days before your plan downgrades' },
];

export default function NotificationSettingsSection({ onError }: NotificationSettingsSectionProps) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<keyof EmailNotificationPreferences | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await settingsApi.getNotificationPreferences();
        if (!cancelled) setPrefs(p);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load notification preferences';
        setLoadError(message);
        onError?.(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  async function handleToggle(key: keyof EmailNotificationPreferences) {
    if (!prefs || savingKey) return;
    const previous = prefs;
    const nextValue = !prefs.email[key];
    // Optimistic update — both the nested source of truth and the legacy
    // flat aliases (kept in sync so other consumers of this response stay
    // consistent).
    setPrefs({
      ...prefs,
      email: { ...prefs.email, [key]: nextValue },
      emailNotifications: key === 'enabled' ? nextValue : prefs.emailNotifications,
      weeklySummary: key === 'weeklySummary' ? nextValue : prefs.weeklySummary,
      abnormalAlerts: key === 'outOfRangeAlerts' ? nextValue : prefs.abnormalAlerts,
    });
    setSavingKey(key);
    try {
      const updated = await settingsApi.updateNotificationPreferences({ [key]: nextValue });
      setPrefs(updated);
    } catch (err) {
      setPrefs(previous);
      const message = err instanceof Error ? err.message : 'Failed to update preference';
      onError?.(message);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Email Notifications</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Choose which engagement emails we send</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading preferences…</span>
          </div>
        ) : loadError || !prefs ? (
          <div className="flex items-center space-x-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-600 dark:text-red-400">{loadError ?? 'Preferences unavailable'}</p>
          </div>
        ) : (
          <>
            {/* Master switch — disables all sub-toggles visually. Stored values
                are kept so flipping back on restores the user's previous choices. */}
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Email notifications</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Master switch for all emails</p>
              </div>
              <Toggle
                value={prefs.email.enabled}
                onToggle={() => handleToggle('enabled')}
                disabled={savingKey === 'enabled'}
              />
            </div>

            {TOGGLE_ROWS.map((row) => {
              const value = prefs.email[row.key];
              const disabled = !prefs.email.enabled || savingKey === row.key;
              return (
                <div
                  key={row.key}
                  className={`flex items-center justify-between py-2 ${!prefs.email.enabled ? 'opacity-50' : ''}`}
                >
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{row.label}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{row.description}</p>
                  </div>
                  <Toggle
                    value={value}
                    onToggle={() => handleToggle(row.key)}
                    disabled={disabled}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

function Toggle({
  value,
  onToggle,
  disabled,
}: {
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={value}
      className={`relative w-12 h-6 rounded-full transition-colors disabled:cursor-not-allowed ${
        value ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          value ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
