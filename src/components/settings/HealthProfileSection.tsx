/**
 * HealthProfileSection — self-reported health profile editor.
 *
 * Feeds into the AI Health Guide prompt. Every field is optional;
 * the profile works with whatever the user provides. Conditions and
 * medications include autocomplete against common lists but accept
 * custom entries.
 *
 * Saves are batched — editing a field sets a dirty flag and the user
 * clicks "Save Profile" to persist. Simpler than debounce autosave
 * for a form with this much input, and matches the display-name
 * pattern elsewhere in the settings page.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Loader2,
  Lock,
  Plus,
  Stethoscope,
  Trash2,
  X,
} from 'lucide-react';
import {
  settingsApi,
  type AgeRange,
  type BiologicalSex,
  type ConditionStatus,
  type ExerciseLevel,
  type HealthCondition,
  type Medication,
  type SmokingStatus,
  type UserHealthProfile,
} from '../../services/api';

interface HealthProfileSectionProps {
  onError?: (message: string) => void;
}

const COMMON_CONDITIONS = [
  'Type 1 Diabetes',
  'Type 2 Diabetes',
  'Pre-diabetes',
  'Hypertension',
  'Hypotension',
  'Hypothyroidism',
  'Hyperthyroidism',
  "Hashimoto's",
  'Osteoporosis',
  'Osteopenia',
  'PCOS',
  'Endometriosis',
  'Celiac Disease',
  "Crohn's Disease",
  'IBS',
  'Asthma',
  'COPD',
  'Rheumatoid Arthritis',
  'Lupus',
  'Anemia',
  'Iron Deficiency',
  'High Cholesterol',
  'Familial Hypercholesterolemia',
  'Kidney Disease',
  'Liver Disease',
  'Heart Disease',
  'Atrial Fibrillation',
  'Anxiety',
  'Depression',
  'Migraine',
  'Epilepsy',
  'Cancer (specify type)',
  'HIV/AIDS',
  'Sleep Apnea',
];

const COMMON_MEDICATIONS = [
  'Levothyroxine (Synthroid)',
  'Metformin',
  'Insulin',
  'Ozempic (semaglutide)',
  'Jardiance',
  'Atorvastatin (Lipitor)',
  'Rosuvastatin (Crestor)',
  'Simvastatin',
  'Lisinopril',
  'Amlodipine',
  'Losartan',
  'Metoprolol',
  'Alendronate (Fosamax)',
  'Calcium + Vitamin D',
  'Aspirin',
  'Warfarin',
  'Eliquis (apixaban)',
  'Estrogen',
  'Progesterone',
  'Testosterone',
  'Sertraline (Zoloft)',
  'Escitalopram (Lexapro)',
  'Bupropion (Wellbutrin)',
  'Omeprazole (Prilosec)',
  'Gabapentin',
  'Prednisone',
];

const EMPTY_PROFILE: UserHealthProfile = {
  conditions: [],
  medications: [],
  familyHistory: [],
};

const STATUS_OPTIONS: Array<{ value: ConditionStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'managed', label: 'Managed' },
  { value: 'resolved', label: 'Resolved' },
];

const SMOKING_OPTIONS: Array<{ value: SmokingStatus; label: string }> = [
  { value: 'never', label: 'Never' },
  { value: 'former', label: 'Former' },
  { value: 'current', label: 'Current' },
];

const EXERCISE_OPTIONS: Array<{ value: ExerciseLevel; label: string }> = [
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'light', label: 'Light' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'active', label: 'Active' },
];

const AGE_OPTIONS: AgeRange[] = ['18-29', '30-39', '40-49', '50-59', '60-69', '70+'];

export default function HealthProfileSection({ onError }: HealthProfileSectionProps) {
  const [profile, setProfile] = useState<UserHealthProfile>(EMPTY_PROFILE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Ephemeral inputs for condition/medication/family entry forms.
  const [newCondition, setNewCondition] = useState('');
  const [newMedication, setNewMedication] = useState('');
  const [newMedicationPurpose, setNewMedicationPurpose] = useState('');
  const [newFamilyHistory, setNewFamilyHistory] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await settingsApi.getHealthProfile();
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled) onError?.(err instanceof Error ? err.message : 'Failed to load health profile');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  // Auto-hide the success message after 3s.
  useEffect(() => {
    if (!saveMessage) return;
    const t = setTimeout(() => setSaveMessage(null), 3000);
    return () => clearTimeout(t);
  }, [saveMessage]);

  const updateProfile = <K extends keyof UserHealthProfile>(
    field: K,
    value: UserHealthProfile[K]
  ) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const addCondition = () => {
    const name = newCondition.trim();
    if (!name) return;
    const next: HealthCondition = { name, status: 'active' };
    updateProfile('conditions', [...profile.conditions, next]);
    setNewCondition('');
  };

  const updateCondition = (index: number, patch: Partial<HealthCondition>) => {
    const next = [...profile.conditions];
    next[index] = { ...next[index], ...patch };
    updateProfile('conditions', next);
  };

  const removeCondition = (index: number) => {
    updateProfile(
      'conditions',
      profile.conditions.filter((_, i) => i !== index)
    );
  };

  const addMedication = () => {
    const name = newMedication.trim();
    if (!name) return;
    const next: Medication = { name };
    if (newMedicationPurpose.trim()) next.purpose = newMedicationPurpose.trim();
    updateProfile('medications', [...profile.medications, next]);
    setNewMedication('');
    setNewMedicationPurpose('');
  };

  const removeMedication = (index: number) => {
    updateProfile(
      'medications',
      profile.medications.filter((_, i) => i !== index)
    );
  };

  const addFamilyHistory = () => {
    const entry = newFamilyHistory.trim();
    if (!entry || profile.familyHistory.includes(entry)) {
      setNewFamilyHistory('');
      return;
    }
    updateProfile('familyHistory', [...profile.familyHistory, entry]);
    setNewFamilyHistory('');
  };

  const removeFamilyHistory = (entry: string) => {
    updateProfile(
      'familyHistory',
      profile.familyHistory.filter((f) => f !== entry)
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const saved = await settingsApi.updateHealthProfile({
        biologicalSex: profile.biologicalSex,
        ageRange: profile.ageRange,
        conditions: profile.conditions,
        medications: profile.medications,
        familyHistory: profile.familyHistory,
        smokingStatus: profile.smokingStatus,
        exerciseLevel: profile.exerciseLevel,
        additionalContext: profile.additionalContext,
      });
      setProfile(saved);
      setDirty(false);
      setSaveMessage('Health profile saved');
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to save health profile');
    } finally {
      setIsSaving(false);
    }
  };

  const conditionSuggestions = useMemo(
    () => COMMON_CONDITIONS.filter((c) => !profile.conditions.some((p) => p.name === c)),
    [profile.conditions]
  );
  const medicationSuggestions = useMemo(
    () => COMMON_MEDICATIONS.filter((m) => !profile.medications.some((p) => p.name === m)),
    [profile.medications]
  );

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-wellness-100 dark:bg-wellness-900/30 rounded-xl flex items-center justify-center">
            <Stethoscope className="w-5 h-5 text-wellness-600 dark:text-wellness-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Health Profile</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Helps the AI Health Guide give personalized, condition-aware responses.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      ) : (
        <div className="p-6 space-y-6">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
            <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Encrypted at rest. Only used to personalize your AI Health Guide responses. All fields are optional.
            </span>
          </div>

          {/* Demographics */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Demographics</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LabeledSelect
                label="Biological sex"
                value={profile.biologicalSex ?? ''}
                onChange={(v) => updateProfile('biologicalSex', (v || undefined) as BiologicalSex | undefined)}
                options={[
                  { value: '', label: 'Prefer not to say' },
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
              />
              <LabeledSelect
                label="Age range"
                value={profile.ageRange ?? ''}
                onChange={(v) => updateProfile('ageRange', (v || undefined) as AgeRange | undefined)}
                options={[
                  { value: '', label: 'Prefer not to say' },
                  ...AGE_OPTIONS.map((a) => ({ value: a, label: a })),
                ]}
              />
            </div>
          </div>

          {/* Conditions */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Conditions</h3>
            <div className="space-y-2">
              {profile.conditions.map((c, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center gap-2 p-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg"
                >
                  <span className="text-sm font-medium text-slate-900 dark:text-white flex-1 min-w-[150px]">
                    {c.name}
                  </span>
                  <select
                    value={c.status}
                    onChange={(e) => updateCondition(idx, { status: e.target.value as ConditionStatus })}
                    className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={c.diagnosedYear ?? ''}
                    onChange={(e) =>
                      updateCondition(idx, {
                        diagnosedYear: e.target.value ? parseInt(e.target.value, 10) : undefined,
                      })
                    }
                    placeholder="Year"
                    min={1950}
                    max={2030}
                    className="w-20 px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                  />
                  <button
                    onClick={() => removeCondition(idx)}
                    className="p-1 text-slate-400 hover:text-red-500 rounded"
                    aria-label="Remove condition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <AddRow
                inputValue={newCondition}
                onInputChange={setNewCondition}
                onAdd={addCondition}
                placeholder="Condition name"
                listId="common-conditions"
                suggestions={conditionSuggestions}
              />
            </div>
          </div>

          {/* Medications */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Medications</h3>
            <div className="space-y-2">
              {profile.medications.map((m, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center gap-2 p-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg"
                >
                  <span className="text-sm font-medium text-slate-900 dark:text-white flex-1 min-w-[150px]">
                    {m.name}
                  </span>
                  {m.purpose && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{m.purpose}</span>
                  )}
                  <button
                    onClick={() => removeMedication(idx)}
                    className="p-1 text-slate-400 hover:text-red-500 rounded ml-auto"
                    aria-label="Remove medication"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={newMedication}
                  onChange={(e) => setNewMedication(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addMedication();
                    }
                  }}
                  placeholder="Medication name"
                  list="common-medications"
                  className="flex-1 min-w-[150px] px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500"
                />
                <input
                  type="text"
                  value={newMedicationPurpose}
                  onChange={(e) => setNewMedicationPurpose(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addMedication();
                    }
                  }}
                  placeholder="Purpose (optional)"
                  className="flex-1 min-w-[120px] px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500"
                />
                <datalist id="common-medications">
                  {medicationSuggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <button
                  onClick={addMedication}
                  disabled={!newMedication.trim()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Family history */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Family history</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {profile.familyHistory.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  {f}
                  <button
                    onClick={() => removeFamilyHistory(f)}
                    className="text-slate-400 hover:text-red-500"
                    aria-label="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <AddRow
              inputValue={newFamilyHistory}
              onInputChange={setNewFamilyHistory}
              onAdd={addFamilyHistory}
              placeholder="e.g. Heart disease, diabetes"
            />
          </div>

          {/* Lifestyle */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Lifestyle</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LabeledSelect
                label="Smoking"
                value={profile.smokingStatus ?? ''}
                onChange={(v) => updateProfile('smokingStatus', (v || undefined) as SmokingStatus | undefined)}
                options={[
                  { value: '', label: 'Prefer not to say' },
                  ...SMOKING_OPTIONS,
                ]}
              />
              <LabeledSelect
                label="Exercise"
                value={profile.exerciseLevel ?? ''}
                onChange={(v) => updateProfile('exerciseLevel', (v || undefined) as ExerciseLevel | undefined)}
                options={[
                  { value: '', label: 'Prefer not to say' },
                  ...EXERCISE_OPTIONS,
                ]}
              />
            </div>
          </div>

          {/* Additional context */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Additional context
            </label>
            <textarea
              value={profile.additionalContext ?? ''}
              onChange={(e) => updateProfile('additionalContext', e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Anything else you'd like the AI Health Guide to know (e.g. post-menopausal, recent DEXA scan)…"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {(profile.additionalContext ?? '').length}/500
            </p>
          </div>

          {/* Save row */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-700">
            {saveMessage ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-wellness-600 dark:text-wellness-400">
                <CheckCircle className="w-4 h-4" />
                {saveMessage}
              </span>
            ) : dirty ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                <AlertCircle className="w-4 h-4" />
                Unsaved changes
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                <Activity className="w-4 h-4" />
                Up to date
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save Profile
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- small helpers ----------

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function AddRow({
  inputValue,
  onInputChange,
  onAdd,
  placeholder,
  listId,
  suggestions,
}: {
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
  listId?: string;
  suggestions?: string[];
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd();
          }
        }}
        placeholder={placeholder}
        list={listId}
        className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500"
      />
      {listId && suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <button
        onClick={onAdd}
        disabled={!inputValue.trim()}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg disabled:opacity-50"
      >
        <Plus className="w-4 h-4" />
        Add
      </button>
    </div>
  );
}
