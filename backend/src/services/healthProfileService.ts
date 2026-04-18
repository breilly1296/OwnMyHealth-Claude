/**
 * Health Profile Service
 *
 * Shared helpers for reading the user's self-reported health profile
 * (conditions, medications, demographics, lifestyle). The profile lives
 * as an encrypted JSON blob on User.healthProfileEncrypted.
 *
 * Separated from settingsController so healthContextService can inject
 * the profile into AI prompts without a controller-layer circular
 * import.
 */

import { withRLSContext } from './database.js';
import { getEncryptionService } from './encryption.js';
import { getUserEncryptionSalt } from './userEncryption.js';
import { logger } from '../utils/logger.js';

export type BiologicalSex = 'male' | 'female';
export type AgeRange = '18-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70+';
export type ConditionStatus = 'active' | 'managed' | 'resolved';
export type SmokingStatus = 'never' | 'former' | 'current';
export type ExerciseLevel = 'sedentary' | 'light' | 'moderate' | 'active';

export interface HealthCondition {
  name: string;
  status: ConditionStatus;
  diagnosedYear?: number;
}

export interface Medication {
  name: string;
  purpose?: string;
}

export interface UserHealthProfile {
  biologicalSex?: BiologicalSex;
  ageRange?: AgeRange;
  conditions: HealthCondition[];
  medications: Medication[];
  familyHistory: string[];
  smokingStatus?: SmokingStatus;
  exerciseLevel?: ExerciseLevel;
  additionalContext?: string;
  updatedAt?: string;
}

export const EMPTY_HEALTH_PROFILE: UserHealthProfile = {
  conditions: [],
  medications: [],
  familyHistory: [],
};

/**
 * Fetch and decrypt the user's health profile. Returns the empty
 * profile shape when the user has never set one (so callers don't
 * need to handle undefined).
 */
export async function getDecryptedHealthProfile(userId: string): Promise<UserHealthProfile> {
  const user = await withRLSContext(userId, async (tx) => {
    return tx.user.findUnique({
      where: { id: userId },
      select: { healthProfileEncrypted: true },
    });
  });

  if (!user?.healthProfileEncrypted) {
    return { ...EMPTY_HEALTH_PROFILE };
  }

  try {
    const encryption = getEncryptionService();
    const salt = await getUserEncryptionSalt(userId);
    const json = encryption.decrypt(user.healthProfileEncrypted, salt);
    const parsed = JSON.parse(json) as Partial<UserHealthProfile>;
    return {
      ...EMPTY_HEALTH_PROFILE,
      ...parsed,
      conditions: parsed.conditions ?? [],
      medications: parsed.medications ?? [],
      familyHistory: parsed.familyHistory ?? [],
    };
  } catch (err) {
    logger.warn('Failed to decrypt health profile', {
      data: { userId, error: err instanceof Error ? err.message : 'unknown' },
    });
    return { ...EMPTY_HEALTH_PROFILE };
  }
}

/**
 * Encrypt and persist a health profile. Caller is responsible for
 * merging partial updates before calling (the controller does that
 * so the audit log can capture "fields updated").
 */
export async function saveHealthProfile(
  userId: string,
  profile: UserHealthProfile
): Promise<UserHealthProfile> {
  const encryption = getEncryptionService();
  const salt = await getUserEncryptionSalt(userId);
  const stamped: UserHealthProfile = { ...profile, updatedAt: new Date().toISOString() };
  const ciphertext = encryption.encrypt(JSON.stringify(stamped), salt);

  await withRLSContext(userId, async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { healthProfileEncrypted: ciphertext },
    });
  });

  return stamped;
}

/**
 * Is the user's profile effectively empty? Used for audit metadata +
 * frontend "profile active" indicator.
 */
export function isEmptyProfile(profile: UserHealthProfile): boolean {
  return (
    !profile.biologicalSex &&
    !profile.ageRange &&
    !profile.smokingStatus &&
    !profile.exerciseLevel &&
    (profile.conditions?.length ?? 0) === 0 &&
    (profile.medications?.length ?? 0) === 0 &&
    (profile.familyHistory?.length ?? 0) === 0 &&
    !profile.additionalContext?.trim()
  );
}
