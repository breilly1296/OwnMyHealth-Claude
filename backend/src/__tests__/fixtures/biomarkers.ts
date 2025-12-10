/**
 * Biomarker Test Fixtures
 *
 * Provides test data for biomarker-related tests.
 */

// Test user salt for encryption (64 hex chars)
export const TEST_USER_SALT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
export const TEST_USER_ID = 'test-user-id-biomarker';
export const OTHER_USER_ID = 'other-user-id-123';

// Biomarker categories
export const CATEGORIES = {
  METABOLIC: 'Metabolic',
  LIPID: 'Lipid Panel',
  CBC: 'Complete Blood Count',
  THYROID: 'Thyroid',
  VITAMIN: 'Vitamins',
};

// Valid biomarker create inputs
export const biomarkerCreateInputs = {
  valid: {
    category: CATEGORIES.METABOLIC,
    name: 'Glucose',
    unit: 'mg/dL',
    value: 95,
    notes: 'Fasting blood glucose test',
    normalRange: {
      min: 70,
      max: 100,
      source: 'American Diabetes Association',
    },
    date: '2024-01-15',
    sourceType: 'LAB_UPLOAD' as const,
    labName: 'Quest Diagnostics',
  },

  inRange: {
    category: CATEGORIES.LIPID,
    name: 'HDL Cholesterol',
    unit: 'mg/dL',
    value: 55,
    normalRange: {
      min: 40,
      max: 60,
    },
    date: '2024-01-15',
  },

  outOfRange: {
    category: CATEGORIES.LIPID,
    name: 'LDL Cholesterol',
    unit: 'mg/dL',
    value: 180, // Above max
    normalRange: {
      min: 0,
      max: 100,
    },
    date: '2024-01-15',
  },

  minimal: {
    category: CATEGORIES.CBC,
    name: 'White Blood Cells',
    unit: 'K/uL',
    value: 7.5,
    normalRange: {
      min: 4.5,
      max: 11.0,
    },
    date: '2024-01-15',
  },

  withNotes: {
    category: CATEGORIES.VITAMIN,
    name: 'Vitamin D',
    unit: 'ng/mL',
    value: 32,
    notes: 'Taking 5000 IU daily supplement',
    normalRange: {
      min: 30,
      max: 100,
    },
    date: '2024-01-15',
  },
};

// Invalid biomarker inputs for validation testing
export const invalidBiomarkerInputs = {
  missingCategory: {
    name: 'Glucose',
    unit: 'mg/dL',
    value: 95,
    normalRange: { min: 70, max: 100 },
    date: '2024-01-15',
  },

  missingName: {
    category: CATEGORIES.METABOLIC,
    unit: 'mg/dL',
    value: 95,
    normalRange: { min: 70, max: 100 },
    date: '2024-01-15',
  },

  missingValue: {
    category: CATEGORIES.METABOLIC,
    name: 'Glucose',
    unit: 'mg/dL',
    normalRange: { min: 70, max: 100 },
    date: '2024-01-15',
  },

  invalidValue: {
    category: CATEGORIES.METABOLIC,
    name: 'Glucose',
    unit: 'mg/dL',
    value: 'not-a-number',
    normalRange: { min: 70, max: 100 },
    date: '2024-01-15',
  },

  missingNormalRange: {
    category: CATEGORIES.METABOLIC,
    name: 'Glucose',
    unit: 'mg/dL',
    value: 95,
    date: '2024-01-15',
  },
};

// Mock Prisma biomarker records (as stored in DB with encrypted values)
export const mockBiomarkerRecords = {
  glucose: {
    id: 'biomarker-glucose-123',
    userId: TEST_USER_ID,
    category: CATEGORIES.METABOLIC,
    name: 'Glucose',
    unit: 'mg/dL',
    valueEncrypted: 'encrypted-95', // Will be mocked
    notesEncrypted: 'encrypted-notes',
    normalRangeMin: 70,
    normalRangeMax: 100,
    normalRangeSource: 'ADA',
    measurementDate: new Date('2024-01-15'),
    sourceType: 'LAB_UPLOAD' as const,
    sourceFile: null,
    extractionConfidence: null,
    labName: 'Quest',
    isOutOfRange: false,
    isAcknowledged: false,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
  },

  ldl: {
    id: 'biomarker-ldl-456',
    userId: TEST_USER_ID,
    category: CATEGORIES.LIPID,
    name: 'LDL Cholesterol',
    unit: 'mg/dL',
    valueEncrypted: 'encrypted-180',
    notesEncrypted: null,
    normalRangeMin: 0,
    normalRangeMax: 100,
    normalRangeSource: null,
    measurementDate: new Date('2024-01-15'),
    sourceType: 'MANUAL' as const,
    sourceFile: null,
    extractionConfidence: null,
    labName: null,
    isOutOfRange: true,
    isAcknowledged: false,
    createdAt: new Date('2024-01-15T11:00:00Z'),
    updatedAt: new Date('2024-01-15T11:00:00Z'),
  },

  vitaminD: {
    id: 'biomarker-vitd-789',
    userId: TEST_USER_ID,
    category: CATEGORIES.VITAMIN,
    name: 'Vitamin D',
    unit: 'ng/mL',
    valueEncrypted: 'encrypted-32',
    notesEncrypted: 'encrypted-supplement-note',
    normalRangeMin: 30,
    normalRangeMax: 100,
    normalRangeSource: 'Endocrine Society',
    measurementDate: new Date('2024-01-10'),
    sourceType: 'LAB_UPLOAD' as const,
    sourceFile: 'labs-jan.pdf',
    extractionConfidence: 0.95,
    labName: 'LabCorp',
    isOutOfRange: false,
    isAcknowledged: false,
    createdAt: new Date('2024-01-10T09:00:00Z'),
    updatedAt: new Date('2024-01-10T09:00:00Z'),
  },

  // Biomarker belonging to another user (for ownership tests)
  otherUserBiomarker: {
    id: 'biomarker-other-user',
    userId: OTHER_USER_ID,
    category: CATEGORIES.METABOLIC,
    name: 'Glucose',
    unit: 'mg/dL',
    valueEncrypted: 'encrypted-100',
    notesEncrypted: null,
    normalRangeMin: 70,
    normalRangeMax: 100,
    normalRangeSource: null,
    measurementDate: new Date('2024-01-15'),
    sourceType: 'MANUAL' as const,
    sourceFile: null,
    extractionConfidence: null,
    labName: null,
    isOutOfRange: false,
    isAcknowledged: false,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
  },
};

// Mock history records
export const mockHistoryRecords = [
  {
    id: 'history-1',
    biomarkerId: 'biomarker-glucose-123',
    valueEncrypted: 'encrypted-90',
    measurementDate: new Date('2024-01-01'),
    createdAt: new Date('2024-01-15T10:00:00Z'),
  },
  {
    id: 'history-2',
    biomarkerId: 'biomarker-glucose-123',
    valueEncrypted: 'encrypted-92',
    measurementDate: new Date('2024-01-08'),
    createdAt: new Date('2024-01-15T10:00:00Z'),
  },
];

// Bulk create payloads
export const bulkBiomarkerInputs = {
  allValid: [
    biomarkerCreateInputs.valid,
    biomarkerCreateInputs.inRange,
    biomarkerCreateInputs.minimal,
  ],

  mixedValid: [
    biomarkerCreateInputs.valid,
    invalidBiomarkerInputs.missingValue, // This one will fail
    biomarkerCreateInputs.inRange,
  ],

  allInvalid: [
    invalidBiomarkerInputs.missingCategory,
    invalidBiomarkerInputs.missingName,
    invalidBiomarkerInputs.invalidValue,
  ],
};

// Update payloads
export const biomarkerUpdateInputs = {
  valueOnly: {
    value: 100,
  },

  notesOnly: {
    notes: 'Updated notes after retest',
  },

  rangeChange: {
    normalRange: {
      min: 65,
      max: 110,
    },
  },

  multipleFields: {
    value: 88,
    notes: 'Improved after diet changes',
    category: CATEGORIES.METABOLIC,
  },

  triggersOutOfRange: {
    value: 150, // Above max of 100
  },
};

// Mock user encryption key record
export const mockUserEncryptionKey = {
  id: 'key-id-123',
  userId: TEST_USER_ID,
  keyType: 'phi_encryption',
  keyHash: TEST_USER_SALT.substring(0, 64),
  encryptedKey: 'encrypted-salt-value', // Will be handled by mock
  version: 1,
  isActive: true,
  createdAt: new Date(),
  rotatedAt: null,
};
