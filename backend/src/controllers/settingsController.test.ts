/**
 * settingsController C-6 regression tests.
 *
 * Scope: the GCS-cleanup behavior added by C-6 to `deleteAllData` and
 * `deleteAccount`. Intentionally narrow — these are control-flow /
 * sequencing tests. Full unit coverage of settingsController is out of
 * scope here.
 *
 * Two invariants under test for each handler:
 *   1. GCS deletion runs BEFORE any DB deletion.
 *   2. If any GCS delete fails (non-404), the handler throws and the DB
 *      stays intact, so the user's next retry still has the storageKeys
 *      to delete.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Mocked tx — shared handle for both controllers ---------------------------
const mockTx = {
  userFile: { findMany: vi.fn(), deleteMany: vi.fn() },
  biomarker: { deleteMany: vi.fn() },
  insurancePlan: { deleteMany: vi.fn() },
  healthNeed: { deleteMany: vi.fn() },
  healthGoal: { deleteMany: vi.fn() },
  costAnalysis: { deleteMany: vi.fn() },
  expenseActual: { deleteMany: vi.fn() },
  expenseProjection: { deleteMany: vi.fn() },
  providerPatient: { deleteMany: vi.fn() },
  labConnection: { findMany: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn(), delete: vi.fn() },
};

// -- Mocks — hoisted by vitest, so the factories run before imports -----------
vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: typeof mockTx) => unknown) =>
    fn(mockTx)
  ),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: typeof mockTx) => unknown) =>
    fn(mockTx)
  ),
}));

const mockAuditService = {
  logDelete: vi.fn(),
  logSystem: vi.fn(),
};
vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mockAuditService),
}));

vi.mock('../services/storageService.js', () => ({
  storageService: { deleteFiles: vi.fn() },
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({})),
}));

// deleteAllData/deleteAccount now best-effort revoke lab OAuth tokens at the
// upstream provider before wiping LabConnection rows (mirrors deleteAccount).
// Stub it so these sequencing tests don't hit the real FHIR/network path.
vi.mock('../services/fhir/labSyncService.js', () => ({
  revokeAllUserConnections: vi.fn(),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../services/authService.js', () => ({
  verifyPassword: vi.fn(async () => true),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() },
}));

// -- Imports AFTER mocks so the mocked modules resolve -------------------------
import { deleteAllData, deleteAccount, exportUserData } from './settingsController.js';
import { storageService } from '../services/storageService.js';
import { verifyPassword } from '../services/authService.js';
import { getEncryptionService } from '../services/encryption.js';

// Narrow helper for the res stub.
// `set` returns `this` in Express for chaining; the mock mirrors that —
// exportUserData (post-F-10) calls `res.set({ Cache-Control: ... })`
// before `res.json`.
function mockRes() {
  const res: {
    json: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  } = {
    json: vi.fn(),
    set: vi.fn(function (this: unknown) {
      return this;
    }),
  };
  return res as unknown as import('express').Response;
}

function mockReq(userId: string, body: Record<string, unknown> = {}) {
  return {
    user: { id: userId },
    body,
  } as unknown as import('../types/index.js').AuthenticatedRequest;
}

describe('deleteAllData (C-6)', () => {
  beforeEach(() => {
    // clearAllMocks preserves mock implementations (withRLSContext/Transaction
    // still invoke the fn arg). resetAllMocks would wipe them.
    vi.clearAllMocks();

    mockTx.user.findUnique.mockResolvedValue({
      id: 'user-123',
      passwordHash: '$hash',
    });
    mockTx.userFile.findMany.mockResolvedValue([
      { id: 'f1', storageKey: 'user-123/f1.pdf', filename: 'labs.pdf' },
      { id: 'f2', storageKey: 'user-123/f2.pdf', filename: 'sbc.pdf' },
    ]);
    mockTx.biomarker.deleteMany.mockResolvedValue({ count: 3 });
    mockTx.insurancePlan.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.healthNeed.deleteMany.mockResolvedValue({ count: 2 });
    mockTx.healthGoal.deleteMany.mockResolvedValue({ count: 4 });
    mockTx.userFile.deleteMany.mockResolvedValue({ count: 2 });
    mockTx.costAnalysis.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.expenseActual.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.expenseProjection.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.providerPatient.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.labConnection.deleteMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes all GCS objects before any DB deletion, then deletes DB rows', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
      { storageKey: 'user-123/f2.pdf', ok: true },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await deleteAllData(req, res);

    expect(storageService.deleteFiles).toHaveBeenCalledWith([
      'user-123/f1.pdf',
      'user-123/f2.pdf',
    ]);
    expect(mockTx.userFile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
    expect(mockTx.biomarker.deleteMany).toHaveBeenCalled();
    expect(mockAuditService.logDelete).toHaveBeenCalledWith(
      'UserData',
      'user-123',
      expect.objectContaining({
        deletedBiomarkers: 3,
        deletedUserFiles: 2,
        deletedGcsObjects: 2,
      }),
      expect.any(Object)
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('aborts and does NOT delete any DB rows if any GCS delete fails', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
      { storageKey: 'user-123/f2.pdf', ok: false, error: 'GCS 500' },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await expect(deleteAllData(req, res)).rejects.toThrow(/Failed to delete 1 of 2 files/);

    expect(mockTx.biomarker.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.insurancePlan.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthNeed.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthGoal.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.userFile.deleteMany).not.toHaveBeenCalled();

    expect(mockAuditService.logSystem).toHaveBeenCalledWith(
      'DELETE',
      'UserData',
      expect.objectContaining({
        action: 'DELETE_DATA_FAILED',
        component: 'settingsController.deleteAllData',
        count: 1,
      })
    );
    // M-1: the aborted wipe is now recorded as a FAILED primary audit row
    // (success:false) so a "WHERE success = false" HIPAA query surfaces it,
    // in addition to the DELETE_DATA_FAILED system event above.
    expect(mockAuditService.logDelete).toHaveBeenCalledWith(
      'UserData',
      'user-123',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'DELETE_DATA_BLOCKED' }),
      expect.objectContaining({ success: false })
    );
  });

  it('handles a user with zero files (empty GCS call, DB deletion still runs)', async () => {
    mockTx.userFile.findMany.mockResolvedValue([]);
    vi.mocked(storageService.deleteFiles).mockResolvedValue([]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await deleteAllData(req, res);

    expect(storageService.deleteFiles).toHaveBeenCalledWith([]);
    expect(mockTx.biomarker.deleteMany).toHaveBeenCalled();
    expect(mockTx.userFile.deleteMany).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('deleteAccount (C-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTx.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      passwordHash: '$hash',
    });
    mockTx.userFile.findMany.mockResolvedValue([
      { id: 'f1', storageKey: 'user-123/f1.pdf' },
    ]);
    mockTx.labConnection.findMany.mockResolvedValue([]);
    mockTx.user.delete.mockResolvedValue({ id: 'user-123' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes GCS objects before cascading the user delete', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await deleteAccount(req, res);

    expect(storageService.deleteFiles).toHaveBeenCalledWith(['user-123/f1.pdf']);
    expect(mockTx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-123' } });
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('does NOT cascade-delete the user if any GCS delete fails', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: false, error: 'network timeout' },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await expect(deleteAccount(req, res)).rejects.toThrow(/Your account was not deleted/);
    expect(mockTx.user.delete).not.toHaveBeenCalled();
    expect(mockAuditService.logSystem).toHaveBeenCalledWith(
      'DELETE',
      'User',
      expect.objectContaining({
        action: 'DELETE_ACCOUNT_FAILED',
        component: 'settingsController.deleteAccount',
      })
    );
  });

  // #19: audit_logs.user_id is FK → users(id) ON DELETE SET NULL, so the
  // User-deleted success row must be inserted on the SAME tx BEFORE
  // tx.user.delete (a post-delete standalone insert with the deleted userId
  // raises 23503 and 500s an already-completed deletion).
  it('writes the success audit row inside the delete tx, before user.delete (#19)', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await deleteAccount(req, res);

    // Threaded onto the enclosing tx, with the deleted id preserved in
    // metadata for attribution after the FK SET NULLs user_id at delete time.
    expect(mockAuditService.logDelete).toHaveBeenCalledWith(
      'User',
      'user-123',
      expect.objectContaining({ email: 'user@example.com', reason: 'user_requested' }),
      expect.objectContaining({ userId: 'user-123', tx: mockTx }),
      expect.objectContaining({ deletedUserId: 'user-123' })
    );
    expect(mockAuditService.logDelete.mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.user.delete.mock.invocationCallOrder[0]
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('does NOT delete the user when the in-tx success audit write fails (failClosed, #19)', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
    ]);
    mockAuditService.logDelete.mockRejectedValueOnce(new Error('audit insert failed'));

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    // The failClosed re-throw propagates out of the tx callback, rolling the
    // delete back — audit-before-delete means user.delete never even runs.
    await expect(deleteAccount(req, res)).rejects.toThrow(/audit insert failed/);
    expect(mockTx.user.delete).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

// =============================================================================
// exportUserData — PHI category coverage + decryption + audit + no-secrets
// =============================================================================

// Extend the shared mockTx with the read-side findMany handles exportUserData
// needs. These live alongside the existing deleteMany mocks on mockTx; the
// existing C-6 describes never call these, so adding them is safe.
type FindManyMock = ReturnType<typeof vi.fn>;
interface ExportMockTx {
  biomarker: { findMany: FindManyMock; deleteMany: FindManyMock };
  insurancePlan: { findMany: FindManyMock; deleteMany: FindManyMock };
  healthGoal: { findMany: FindManyMock; deleteMany: FindManyMock };
  healthNeed: { findMany: FindManyMock; deleteMany: FindManyMock };
  expenseProjection: { findMany: FindManyMock; deleteMany: FindManyMock };
  expenseActual: { findMany: FindManyMock; deleteMany: FindManyMock };
  costAnalysis: { findMany: FindManyMock; deleteMany: FindManyMock };
  userFile: { findMany: FindManyMock; deleteMany: FindManyMock };
  providerPatient: { findMany: FindManyMock; deleteMany: FindManyMock };
  user: { findUnique: FindManyMock; delete: FindManyMock };
}

function ensureExportMocks(tx: typeof mockTx): ExportMockTx {
  // Attach findMany handles for the read-side models that exportUserData uses.
  // (insurancePlan/healthGoal/healthNeed/expenseProjection/expenseActual/
  // costAnalysis/providerPatient on the base mockTx only have deleteMany.)
  const ex = tx as unknown as ExportMockTx;
  ex.biomarker.findMany ??= vi.fn();
  ex.insurancePlan.findMany ??= vi.fn();
  ex.healthGoal.findMany ??= vi.fn();
  ex.healthNeed.findMany ??= vi.fn();
  ex.expenseProjection.findMany ??= vi.fn();
  ex.expenseActual.findMany ??= vi.fn();
  ex.costAnalysis.findMany ??= vi.fn();
  ex.providerPatient.findMany ??= vi.fn();
  return ex;
}

describe('exportUserData', () => {
  const userId = 'user-export-1';
  const now = new Date('2026-01-15T00:00:00.000Z');
  const decryptMock = vi.fn((cipher: string, _salt: string) => {
    // Strip the "enc:" prefix our test fixtures use so assertions can match
    // plaintext. A real encryption service would return actual plaintext.
    if (typeof cipher !== 'string') return '';
    return cipher.startsWith('enc:') ? cipher.slice(4) : cipher;
  });
  let ex: ExportMockTx;

  beforeEach(() => {
    vi.clearAllMocks();
    ex = ensureExportMocks(mockTx);

    // logAccess isn't in the existing mockAuditService shape; attach it once.
    (mockAuditService as unknown as { logAccess?: ReturnType<typeof vi.fn> }).logAccess ??=
      vi.fn();
    (mockAuditService as unknown as { logAccess: ReturnType<typeof vi.fn> }).logAccess.mockClear();

    vi.mocked(getEncryptionService).mockReturnValue({
      decrypt: decryptMock,
    } as unknown as ReturnType<typeof getEncryptionService>);
    decryptMock.mockClear();

    ex.user.findUnique.mockResolvedValue({
      email: 'user@example.com',
      role: 'PATIENT',
      createdAt: now,
      firstNameEncrypted: 'enc:Jane',
      lastNameEncrypted: 'enc:Doe',
      dateOfBirthEncrypted: 'enc:1990-01-01',
      phoneEncrypted: 'enc:555-1234',
      addressEncrypted: 'enc:123 Main St',
      // Sensitive fields that MUST NOT surface in the export payload:
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$SHOULD_NOT_LEAK',
      encryptionKeyDerivation: 'SHOULD_NOT_LEAK_salt',
    });

    ex.biomarker.findMany.mockResolvedValue([
      {
        id: 'b1',
        name: 'Glucose',
        category: 'metabolic',
        unit: 'mg/dL',
        valueEncrypted: 'enc:95',
        notesEncrypted: 'enc:fasting',
        measurementDate: now,
        isOutOfRange: false,
        normalRangeMin: 70,
        normalRangeMax: 100,
        normalRangeSource: 'standard',
        sourceType: 'MANUAL_ENTRY',
        labName: null,
        sourceFile: null,
        history: [
          {
            valueEncrypted: 'enc:92',
            measurementDate: new Date('2025-12-01T00:00:00.000Z'),
          },
        ],
      },
      {
        id: 'b2',
        name: 'LDL',
        category: 'lipids',
        unit: 'mg/dL',
        valueEncrypted: 'enc:145',
        notesEncrypted: null,
        measurementDate: now,
        isOutOfRange: true,
        normalRangeMin: 0,
        normalRangeMax: 100,
        normalRangeSource: 'standard',
        sourceType: 'LAB_UPLOAD',
        labName: 'Quest',
        sourceFile: null,
        history: [],
      },
    ]);

    ex.insurancePlan.findMany.mockResolvedValue([
      {
        id: 'p1',
        planName: 'Premium PPO',
        insurerName: 'BCBS',
        planType: 'PPO',
        effectiveDate: now,
        terminationDate: null,
        isActive: true,
        isPrimary: true,
        deductibleIndividual: 1500,
        deductibleFamily: 3000,
        oopMaxIndividual: 5000,
        oopMaxFamily: 10000,
        memberIdEncrypted: 'enc:MEM123',
        groupIdEncrypted: 'enc:GRP456',
        // Benefits are now included via { include: { benefits: true } } in
        // exportUserData and surfaced as ExportInsurancePlan.benefits[].
        benefits: [
          {
            serviceName: 'Primary Care Visit',
            serviceCategory: 'office-visit',
            inNetworkCovered: true,
            inNetworkCopay: 25,
            inNetworkCoinsurance: null,
            inNetworkDeductible: false,
            outNetworkCovered: true,
            outNetworkCopay: null,
            outNetworkCoinsurance: 40,
            outNetworkDeductible: true,
            preAuthRequired: false,
            limitations: null,
          },
        ],
      },
    ]);

    ex.healthGoal.findMany.mockResolvedValue([
      {
        id: 'g1',
        name: 'Lower LDL',
        descriptionEncrypted: 'enc:reduce LDL by 20',
        category: 'lipids',
        targetValue: 100,
        currentValue: 145,
        startValue: 160,
        unit: 'mg/dL',
        direction: 'DECREASE',
        startDate: now,
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
        status: 'IN_PROGRESS',
        progress: 30,
        milestones: null,
        reminderFrequency: null,
        progressHistory: [
          {
            value: 150,
            progress: 25,
            noteEncrypted: 'enc:feeling better',
            recordedAt: now,
          },
        ],
      },
    ]);

    ex.healthNeed.findMany.mockResolvedValue([
      {
        id: 'n1',
        name: 'Cardiology consult',
        needType: 'REFERRAL',
        descriptionEncrypted: 'enc:need cardiology follow-up',
        urgency: 'MEDIUM',
        status: 'OPEN',
        relatedBiomarkerIds: ['b2'],
        createdAt: now,
        resolvedAt: null,
      },
    ]);

    ex.expenseProjection.findMany.mockResolvedValue([
      {
        id: 'ep1',
        serviceTypeEncrypted: 'enc:Office visit',
        estimatedCostEncrypted: 'enc:150',
        frequencyPerYear: 4,
        isInNetwork: true,
        notesEncrypted: 'enc:primary care',
        planId: 'p1',
      },
    ]);

    ex.expenseActual.findMany.mockResolvedValue([
      {
        id: 'ea1',
        serviceTypeEncrypted: 'enc:Lab panel',
        providerNameEncrypted: 'enc:Quest',
        billedAmountEncrypted: 'enc:200',
        insurancePaidEncrypted: 'enc:150',
        patientPaidEncrypted: 'enc:50',
        appliedToDeductibleEncrypted: 'enc:50',
        appliedToOopEncrypted: 'enc:50',
        dateOfService: now,
        isInNetwork: true,
        claimStatus: 'PAID',
        notesEncrypted: null,
      },
    ]);

    ex.costAnalysis.findMany.mockResolvedValue([
      {
        id: 'ca1',
        // Renamed 2026-04-24 from `claudeResponse` (migration
        // 20260424_align_uuid_defaults_and_rename_claude_response). Export
        // shape still emits the legacy `claudeResponse` field name to keep
        // the user-facing JSON contract stable.
        claudeResponseEncrypted: 'enc:Your projected OOP is $500',
        totalProjectedOopEncrypted: 'enc:500',
        analysisDate: now,
      },
    ]);

    ex.userFile.findMany.mockResolvedValue([
      {
        id: 'f1',
        // storageKey is included in the export so users can correlate
        // metadata against signed-URL downloads from /files/:id.
        storageKey: 'user-export-1/f1.pdf',
        originalFilename: 'labs.pdf',
        fileType: 'application/pdf',
        fileSize: 12345,
        labName: 'Quest',
        labDate: now,
        biomarkersExtracted: 7,
        createdAt: now,
      },
    ]);

    ex.providerPatient.findMany.mockResolvedValue([
      {
        id: 'pp1',
        patientId: userId,
        providerId: 'provider-1',
        relationshipType: 'PRIMARY_CARE',
        status: 'ACTIVE',
        canViewBiomarkers: true,
        canViewInsurance: false,
        canViewHealthNeeds: true,
        canEditData: false,
        consentGrantedAt: now,
        consentExpiresAt: null,
        notesEncrypted: 'enc:trusted provider',
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns all PHI categories in the export payload', async () => {
    const req = mockReq(userId);
    const res = mockRes();

    await exportUserData(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const call = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.success).toBe(true);
    const data = call.data;

    // Controller currently emits 10 top-level PHI categories + summary/filesNote.
    // The instruction's "11 PHI categories" counts biomarker history as its own
    // category — the controller folds that into each biomarker (see
    // ExportBiomarker.history). Assert all exposed category keys exist.
    expect(data).toHaveProperty('user');
    expect(data).toHaveProperty('biomarkers');
    expect(Array.isArray(data.biomarkers)).toBe(true);
    expect(data.biomarkers[0]).toHaveProperty('history');
    expect(data).toHaveProperty('insurancePlans');
    expect(data).toHaveProperty('healthGoals');
    expect(data.healthGoals[0]).toHaveProperty('progressHistory');
    expect(data).toHaveProperty('healthNeeds');
    expect(data).toHaveProperty('expenseProjections');
    expect(data).toHaveProperty('expenseActuals');
    expect(data).toHaveProperty('costAnalyses');
    expect(data).toHaveProperty('files');
    expect(data).toHaveProperty('providerRelationships');
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('exportDate');
  });

  it('decrypts encrypted PHI fields and returns plaintext in the payload', async () => {
    const req = mockReq(userId);
    const res = mockRes();

    await exportUserData(req, res);

    const data = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data;

    // User profile fields decrypted
    expect(data.user.firstName).toBe('Jane');
    expect(data.user.lastName).toBe('Doe');
    expect(data.user.dateOfBirth).toBe('1990-01-01');

    // Biomarker value + notes + history values decrypted
    expect(data.biomarkers[0].value).toBe(95);
    expect(data.biomarkers[0].notes).toBe('fasting');
    expect(data.biomarkers[0].history[0].value).toBe(92);
    expect(data.biomarkers[1].value).toBe(145);

    // Insurance encrypted IDs
    expect(data.insurancePlans[0].memberId).toBe('MEM123');
    expect(data.insurancePlans[0].groupId).toBe('GRP456');

    // Health goal description + progressHistory note
    expect(data.healthGoals[0].description).toBe('reduce LDL by 20');
    expect(data.healthGoals[0].progressHistory[0].note).toBe('feeling better');

    // Health need description
    expect(data.healthNeeds[0].description).toBe('need cardiology follow-up');

    // Expense projection + actual encrypted fields
    expect(data.expenseProjections[0].serviceType).toBe('Office visit');
    expect(data.expenseProjections[0].estimatedCost).toBe(150);
    expect(data.expenseProjections[0].notes).toBe('primary care');
    expect(data.expenseActuals[0].serviceType).toBe('Lab panel');
    expect(data.expenseActuals[0].providerName).toBe('Quest');
    expect(data.expenseActuals[0].billedAmount).toBe(200);
    expect(data.expenseActuals[0].patientPaid).toBe(50);

    // Cost analysis claudeResponse + totalProjectedOop
    expect(data.costAnalyses[0].claudeResponse).toBe('Your projected OOP is $500');
    expect(data.costAnalyses[0].totalProjectedOop).toBe(500);

    // Provider relationship notes
    expect(data.providerRelationships[0].notes).toBe('trusted provider');

    // decrypt was invoked many times (confirms it's being called, not bypassed)
    expect(decryptMock).toHaveBeenCalled();
    expect(decryptMock.mock.calls.length).toBeGreaterThan(10);
  });

  it('never leaks passwordHash, encryptionKeyDerivation, or ciphertext fields', async () => {
    const req = mockReq(userId);
    const res = mockRes();

    await exportUserData(req, res);

    const data = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    // Serialize + regex-scan the entire payload for sensitive tokens.
    const serialized = JSON.stringify(data);

    expect(serialized).not.toMatch(/passwordHash/i);
    expect(serialized).not.toMatch(/encryptionKeyDerivation/i);
    expect(serialized).not.toContain('$argon2id$');
    expect(serialized).not.toContain('SHOULD_NOT_LEAK');

    // Encrypted-ciphertext columns should not appear as keys in the payload;
    // only their decrypted counterparts should.
    expect(serialized).not.toMatch(/Encrypted"/);
    // And the "enc:" prefix our fixture uses should also be absent, since
    // everything should have been decrypted.
    expect(serialized).not.toContain('enc:');
  });

  it('emits an audit-log EXPORT event with per-category counts matching the payload', async () => {
    const req = mockReq(userId);
    const res = mockRes();

    await exportUserData(req, res);

    const logAccess = (
      mockAuditService as unknown as { logAccess: ReturnType<typeof vi.fn> }
    ).logAccess;
    expect(logAccess).toHaveBeenCalledTimes(1);
    const [resourceType, resourceId, context, metadata] = logAccess.mock.calls[0];
    expect(resourceType).toBe('UserData');
    expect(resourceId).toBe(userId);
    expect(context).toEqual(expect.objectContaining({ userId }));

    // Counts in the audit metadata must match the categories returned.
    expect(metadata).toEqual(
      expect.objectContaining({
        operation: 'EXPORT',
        biomarkerCount: 2,
        insurancePlanCount: 1,
        healthGoalCount: 1,
        healthNeedCount: 1,
        expenseProjectionCount: 1,
        expenseActualCount: 1,
        costAnalysisCount: 1,
        fileCount: 1,
        providerRelationshipCount: 1,
      })
    );
  });

  it('returns 200-style payload via res.json with success=true', async () => {
    const req = mockReq(userId);
    const res = mockRes();

    await exportUserData(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toBeDefined();
    expect(payload.data.summary.totalBiomarkers).toBe(2);
    expect(payload.data.summary.abnormalCount).toBe(1);
    expect(payload.data.summary.normalCount).toBe(1);
  });
});

// =============================================================================
// deleteAllData — password verification paths
// =============================================================================

describe('deleteAllData — password verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.user.findUnique.mockResolvedValue({
      id: 'user-123',
      passwordHash: '$hash',
    });
    mockTx.userFile.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when password is missing and touches no DB deletes', async () => {
    // verifyPassword on undefined should return false; controller should
    // throw UnauthorizedError('Invalid password') before any delete runs.
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    const req = mockReq('user-123', {}); // no password field
    const res = mockRes();

    await expect(deleteAllData(req, res)).rejects.toThrow(/Invalid password/);

    expect(mockTx.biomarker.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.insurancePlan.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthNeed.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthGoal.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.userFile.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.costAnalysis.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.expenseActual.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.expenseProjection.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.providerPatient.deleteMany).not.toHaveBeenCalled();
    expect(storageService.deleteFiles).not.toHaveBeenCalled();
  });

  it('rejects when the password is wrong and touches no DB deletes', async () => {
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    const req = mockReq('user-123', { password: 'wrong-password' });
    const res = mockRes();

    await expect(deleteAllData(req, res)).rejects.toThrow(/Invalid password/);

    expect(mockTx.biomarker.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.insurancePlan.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthNeed.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthGoal.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.userFile.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.costAnalysis.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.expenseActual.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.expenseProjection.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.providerPatient.deleteMany).not.toHaveBeenCalled();
    expect(storageService.deleteFiles).not.toHaveBeenCalled();
  });
});

// =============================================================================
// deleteAllData — full table cascade on the happy path
// =============================================================================

describe('deleteAllData — full table cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTx.user.findUnique.mockResolvedValue({
      id: 'user-123',
      passwordHash: '$hash',
    });
    mockTx.userFile.findMany.mockResolvedValue([
      { id: 'f1', storageKey: 'user-123/f1.pdf', filename: 'labs.pdf' },
    ]);
    mockTx.biomarker.deleteMany.mockResolvedValue({ count: 3 });
    mockTx.insurancePlan.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.healthNeed.deleteMany.mockResolvedValue({ count: 2 });
    mockTx.healthGoal.deleteMany.mockResolvedValue({ count: 4 });
    mockTx.userFile.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.costAnalysis.deleteMany.mockResolvedValue({ count: 5 });
    mockTx.expenseActual.deleteMany.mockResolvedValue({ count: 6 });
    mockTx.expenseProjection.deleteMany.mockResolvedValue({ count: 7 });
    mockTx.providerPatient.deleteMany.mockResolvedValue({ count: 8 });
    mockTx.labConnection.deleteMany.mockResolvedValue({ count: 10 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invokes deleteMany exactly once for every PHI table the controller deletes', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await deleteAllData(req, res);

    // Full cascade — one deleteMany per category. labConnection is deleted
    // explicitly because deleteAllData preserves the User row, so its
    // cascade-from-User FK doesn't fire (unlike deleteAccount).
    expect(mockTx.biomarker.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.insurancePlan.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.healthNeed.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.healthGoal.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.userFile.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.costAnalysis.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.expenseActual.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.expenseProjection.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.providerPatient.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.labConnection.deleteMany).toHaveBeenCalledTimes(1);

    // All scoped to this user. providerPatient scopes by OR(patientId, providerId)
    // to also unwind provider-side relationships.
    const userScoped = { where: { userId: 'user-123' } };
    expect(mockTx.biomarker.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.insurancePlan.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.healthNeed.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.healthGoal.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.userFile.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.costAnalysis.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.expenseActual.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.expenseProjection.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.labConnection.deleteMany).toHaveBeenCalledWith(userScoped);
    expect(mockTx.providerPatient.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ patientId: 'user-123' }, { providerId: 'user-123' }] },
    });

    // Audit metadata carries per-category counts that match the deleteMany stubs.
    expect(mockAuditService.logDelete).toHaveBeenCalledWith(
      'UserData',
      'user-123',
      expect.objectContaining({
        deletedBiomarkers: 3,
        deletedInsurancePlans: 1,
        deletedHealthNeeds: 2,
        deletedHealthGoals: 4,
        deletedUserFiles: 1,
        deletedCostAnalyses: 5,
        deletedExpenseActuals: 6,
        deletedExpenseProjections: 7,
        deletedProviderRelationships: 8,
        deletedLabConnections: 10,
        deletedGcsObjects: 1,
      }),
      expect.any(Object)
    );
  });
});

// =============================================================================
// deleteAccount — password verification paths
// =============================================================================

describe('deleteAccount — password verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      passwordHash: '$hash',
    });
    mockTx.labConnection.findMany.mockResolvedValue([]);
    mockTx.userFile.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when password is missing and never calls tx.user.delete', async () => {
    // deleteAccount short-circuits on !password BEFORE fetching the user,
    // so user.findUnique should not even run.
    const req = mockReq('user-123', {}); // no password
    const res = mockRes();

    await expect(deleteAccount(req, res)).rejects.toThrow(/Password is required/);

    expect(mockTx.user.delete).not.toHaveBeenCalled();
    expect(storageService.deleteFiles).not.toHaveBeenCalled();
    expect(mockTx.user.findUnique).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('rejects on wrong password and never calls tx.user.delete', async () => {
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    const req = mockReq('user-123', { password: 'wrong' });
    const res = mockRes();

    await expect(deleteAccount(req, res)).rejects.toThrow(/Invalid password/);

    expect(verifyPassword).toHaveBeenCalledWith('wrong', '$hash');
    expect(mockTx.user.delete).not.toHaveBeenCalled();
    expect(storageService.deleteFiles).not.toHaveBeenCalled();
  });
});
