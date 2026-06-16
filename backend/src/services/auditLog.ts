import { PrismaClient, Prisma, AuditAction, ActorType } from '../../generated/prisma';
import { getEncryptionService } from './encryption.js';
import { withRLSContext } from './database.js';
import { Request } from 'express';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { InternalServerError } from '../middleware/errorHandler.js';

// Audit log configuration
const RETENTION_DAYS = 2555; // ~7 years for HIPAA compliance

/**
 * Audit metadata for PHI access logging
 */
export interface AuditMetadata {
  /** Number of records accessed/modified */
  count?: number;
  /** Filter/search criteria used */
  category?: string;
  /** Search term used */
  searchTerm?: string;
  /** Total records matching query */
  total?: number;
  /** Export format if applicable */
  exportFormat?: string;
  /** Number of records exported */
  recordCount?: number;
  /** Resource IDs affected (limited to 100) */
  resourceIds?: string[];
  /** Authentication action type */
  authAction?: string;
  /** Operation type for list/bulk access (e.g., LIST, SUMMARY, HISTORY) */
  operation?: string;
  /** Any additional contextual data */
  [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * System event details for audit logging
 */
export interface SystemAuditDetails {
  /** Action being performed */
  action: string;
  /** Description of the event */
  description?: string;
  /** Number of records affected */
  count?: number;
  /** Number deleted in retention cleanup */
  deletedCount?: number;
  /** Cutoff date for retention cleanup */
  cutoffDate?: string;
  /** Error message if applicable */
  error?: string;
  /** Component that triggered the event */
  component?: string;
  /** Any additional system data */
  [key: string]: string | number | boolean | undefined;
}

interface AuditLogEntry {
  userId?: string;
  actorType: ActorType;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  metadata?: AuditMetadata;
  /**
   * Whether the recorded action SUCCEEDED. Defaults to true (the common case:
   * we audit after the operation completes). Set false when auditing a
   * privileged action that failed or was blocked, so the durable trail
   * distinguishes a completed change from an attempted/denied one
   * (HIPAA §164.312(b)). Pair with errorMessage.
   */
  success?: boolean;
  /**
   * Human-readable reason an action failed/was blocked. Only meaningful when
   * success is false. Stored as null when omitted.
   */
  errorMessage?: string;
  /**
   * When true, a failed audit write RE-THROWS so the calling PHI operation
   * fails closed rather than completing with no durable audit record
   * (HIPAA §164.312(b)). Set for create/update/delete/export. Read and
   * auth-event audits stay best-effort (logged but not fatal) so a transient
   * audit hiccup can't deny legitimate reads or logins.
   */
  failClosed?: boolean;
  /**
   * When set, the audit row is written on THIS transaction client instead of a
   * fresh admin connection. Pass the `tx` from an enclosing withRLSContext /
   * withRLSTransaction callback so the audit row commits or rolls back
   * atomically with the operation it records, and no second pooled connection
   * is opened mid-transaction (#17). Omit for standalone audits.
   */
  tx?: Prisma.TransactionClient;
}

/**
 * Outcome of an audited action, threaded through the log* wrappers so callers
 * can record a FAILURE/blocked attempt (success:false) without dropping to the
 * low-level log() API. Omit entirely for the success path — log() defaults
 * success to true. (M-1)
 */
export interface AuditOutcome {
  success?: boolean;
  errorMessage?: string;
  /**
   * Opt a READ/access audit into fail-closed behavior (a failed write re-throws).
   * Access audits are best-effort by default; set this for the rare pre-flight
   * audit that MUST be durable before an irreversible side effect — e.g. the
   * CHAT_INITIATED row written before PHI is streamed to an external AI (L42).
   */
  failClosed?: boolean;
}

interface AuditContext {
  req?: Request;
  userId?: string;
  sessionId?: string;
  /**
   * The active transaction client, when logging from inside a withRLSContext /
   * withRLSTransaction callback. Threaded into the audit write so it's atomic
   * with the enclosing operation (#17). See AuditLogEntry.tx.
   */
  tx?: Prisma.TransactionClient;
}

/**
 * HIPAA-Compliant Audit Logging Service
 *
 * Records all access, creation, modification, and deletion of PHI data.
 * Logs are encrypted and retained for 7 years per HIPAA requirements.
 *
 * Key features:
 * - Immutable audit logs (no updates/deletes)
 * - PHI values encrypted at rest
 * - Automatic context capture (IP, user agent, session)
 * - Configurable retention policies
 */
export class AuditLogService {
  // All DB access now goes through withRLSContext (which uses the
  // module-level prisma client from database.ts). The constructor
  // parameter is kept for API compatibility with getAuditLogService(prisma)
  // callers but the field is unused at runtime. Field retained (not
  // deleted) so a future refactor has a place to reinstate per-instance
  // prisma wiring without touching the factory signature.
  private readonly _prisma: PrismaClient;
  private systemSalt: string = '';

  constructor(prisma: PrismaClient) {
    this._prisma = prisma;
    void this._prisma; // Suppress unused-field warning
  }

  /**
   * Initialize the audit service with system encryption salt.
   * Call this once at startup.
   *
   * CRITICAL: This MUST succeed for HIPAA compliance. Audit logging is
   * required for all PHI access.
   *
   * The salt now comes from AUDIT_LOG_SALT (validated in config/index.ts) —
   * no DB access. The previous implementation read the salt from
   * `system_config` inside an admin RLS context, which blocked the C-8 role
   * cutover: a NOBYPASSRLS application role can't admin-bypass at startup
   * before any user session exists. See the AUDIT_LOG_SALT docblock in
   * config/index.ts for the migration path out of system_config.
   */
  async initialize(): Promise<void> {
    // config.auditSalt is length-validated at module load (config/index.ts
    // throws if it's missing or < 16 chars), so by the time we get here the
    // value is safe to use. No DB call, no async work needed — kept async
    // so the calling contract in database.ts initializeDatabase still works.
    this.systemSalt = config.auditSalt;
    logger.startup('✓ Audit logging service initialized');
  }

  /**
   * Extract audit context from Express request
   */
  extractContext(req: Request): Partial<AuditLogEntry> {
    return {
      ipAddress: this.getClientIp(req),
      userAgent: req.get('user-agent')?.substring(0, 500),
      sessionId: (req as unknown as { sessionId?: string }).sessionId,
      userId: (req as unknown as { userId?: string }).userId,
    };
  }

  /**
   * Get client IP address from request
   *
   * SECURITY: Uses Express's req.ip which respects the 'trust proxy' setting.
   * When trust proxy is enabled (see app.ts), Express correctly extracts the
   * client IP from X-Forwarded-For based on the proxy hop count configured.
   * This prevents IP spoofing attacks where malicious clients inject fake
   * X-Forwarded-For headers.
   *
   * IMPORTANT: The Express app MUST have 'trust proxy' configured for this
   * to work securely. Without it, req.ip would return the load balancer's IP.
   * See app.ts: app.set('trust proxy', 1)
   */
  private getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  /**
   * Build the context-derived fields (ip, user-agent, session, and the
   * optional enclosing tx) shared by every public log* method. Threading tx
   * here means all helpers carry it through to log() without per-method edits.
   */
  private contextFields(context: AuditContext): {
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    tx?: Prisma.TransactionClient;
  } {
    return {
      ipAddress: context.req ? this.getClientIp(context.req) : undefined,
      userAgent: context.req?.get('user-agent')?.substring(0, 500),
      sessionId: context.sessionId,
      tx: context.tx,
    };
  }

  /**
   * Derive actorType from context. ADMIN when the authenticated user has
   * role=ADMIN; USER for other authenticated users; SYSTEM when there is no
   * user (background jobs, boot).
   */
  private resolveActorType(context: AuditContext): ActorType {
    if (!context.userId) return 'SYSTEM';
    const role = (context.req as Request & { user?: { role?: string } } | undefined)?.user?.role;
    return role === 'ADMIN' ? 'ADMIN' : 'USER';
  }

  /**
   * Encrypt sensitive values before storing in audit log
   */
  private encryptValue(value: unknown): string | null {
    if (value === undefined || value === null) return null;

    try {
      const encryptionService = getEncryptionService();
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      return encryptionService.encrypt(stringValue, this.systemSalt);
    } catch (error) {
      // #28: do NOT persist a fabricated '[ENCRYPTION_FAILED]' ciphertext. That
      // produced an audit row that looked complete (success=true) but had
      // silently lost the before/after PHI change-snapshot HIPAA requires, with
      // no failure signal. Re-throw so log()'s handler fails closed for PHI
      // mutations (failClosed create/update/delete/export → InternalServerError)
      // and records a CRITICAL failure otherwise — never a counterfeit ciphertext.
      // Only value-bearing entries reach here, and those are all failClosed.
      logger.error('Failed to encrypt audit value', { data: { error } });
      throw error instanceof Error ? error : new Error('Audit value encryption failed');
    }
  }

  /**
   * Decrypt an audit row's metadata for an authorized viewer (admin audit view /
   * compliance export). Metadata is stored AES-256-GCM-encrypted in
   * `metadataEncrypted`. The legacy plaintext `metadata` column was dropped in
   * migration 20260615_drop_legacy_audit_metadata (M6), so pre-2026-06-06 rows
   * (which only had plaintext) now surface null metadata — their core audit
   * fields (who/what/when, resource_id) are unaffected. Returns the JSON string
   * (the caller/UI parses it) or null. A decrypt failure is logged and returns
   * null rather than leaking ciphertext to the client.
   */
  decryptMetadata(row: { metadataEncrypted?: string | null }): string | null {
    if (row.metadataEncrypted) {
      try {
        return getEncryptionService().decrypt(row.metadataEncrypted, this.systemSalt);
      } catch (error) {
        logger.error('Failed to decrypt audit metadata', {
          prefix: 'AuditLog',
          data: { error: error instanceof Error ? error.message : String(error) },
        });
        return null;
      }
    }
    return null;
  }

  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      // Encryption is CPU-only, outside the transaction. metadata is now
      // encrypted with the same field-level AES-256-GCM as previous/new values:
      // it can carry PHI (e.g. uploaded filenames logged on download/export), so
      // it must not sit in the audit row as plaintext JSON.
      const previousValueEncrypted = this.encryptValue(entry.previousValue);
      const newValueEncrypted = this.encryptValue(entry.newValue);
      const metadataEncrypted = this.encryptValue(entry.metadata);

      const data = {
        userId: entry.userId,
        actorType: entry.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        previousValueEncrypted,
        newValueEncrypted,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        sessionId: entry.sessionId,
        metadataEncrypted,
        success: entry.success ?? true,
        errorMessage: entry.errorMessage ?? null,
      };

      if (entry.tx) {
        // Inside an enclosing RLS transaction: write the audit row on the SAME
        // connection so it commits/rolls back atomically with the operation it
        // records, and we don't grab a second pooled connection mid-transaction
        // (which doubles pool usage and risks connectionTimeout stalls). The
        // audit_logs_insert policy now requires user_id = current_user_id()
        // (or admin / NULL context) — L40 — and every tx-threaded audit attributes
        // `userId` to the enclosing session user, so the user-scoped tx satisfies
        // the check. (#17)
        await entry.tx.auditLog.create({ data });
      } else {
        // Standalone audit: open an admin context so is_admin_session() satisfies
        // the audit_logs_insert WITH CHECK regardless of the row's user_id (L40);
        // it also sidesteps any ambient current_user_id affecting SET LOCAL.
        await withRLSContext(
          null,
          async (tx) => {
            await tx.auditLog.create({ data });
          },
          { isAdmin: true }
        );
      }
    } catch (error) {
      // Never fail silently on audit logging - this is critical for compliance
      logger.error('CRITICAL: Failed to create audit log entry', {
        prefix: 'AuditLog',
        data: {
          error: error instanceof Error ? error.message : String(error),
          entry: {
            ...entry,
            previousValue: '[REDACTED]',
            newValue: '[REDACTED]',
          },
        },
      });

      // Fail closed for PHI mutations (create/update/delete/export): re-throw
      // so the operation surfaces an error instead of completing with no
      // durable audit trail. Read/auth audits remain best-effort.
      if (entry.failClosed) {
        throw new InternalServerError(
          'Operation could not be securely recorded in the audit log and was not completed.'
        );
      }
    }
  }

  /**
   * Log PHI access (read operations)
   * @param resourceType - The type of resource being accessed
   * @param resourceId - The UUID of the resource, or undefined for list/bulk operations
   * @param context - Request context (req, userId, sessionId)
   * @param metadata - Additional metadata (include 'operation' for list/bulk ops)
   */
  async logAccess(
    resourceType: string,
    resourceId: string | undefined,
    context: AuditContext,
    metadata?: AuditMetadata,
    options?: AuditOutcome
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: this.resolveActorType(context),
      action: 'READ',
      resourceType,
      resourceId: resourceId || undefined,
      ...this.contextFields(context),
      metadata,
      success: options?.success,
      errorMessage: options?.errorMessage,
      failClosed: options?.failClosed,
    });
  }

  /**
   * Log PHI creation
   */
  async logCreate(
    resourceType: string,
    resourceId: string,
    newValue: unknown,
    context: AuditContext,
    metadata?: AuditMetadata,
    options?: AuditOutcome
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: this.resolveActorType(context),
      action: 'CREATE',
      resourceType,
      resourceId,
      newValue,
      ...this.contextFields(context),
      metadata,
      success: options?.success,
      errorMessage: options?.errorMessage,
      failClosed: true,
    });
  }

  /**
   * Log PHI update
   */
  async logUpdate(
    resourceType: string,
    resourceId: string,
    previousValue: unknown,
    newValue: unknown,
    context: AuditContext,
    metadata?: AuditMetadata,
    options?: AuditOutcome
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: this.resolveActorType(context),
      action: 'UPDATE',
      resourceType,
      resourceId,
      previousValue,
      newValue,
      ...this.contextFields(context),
      metadata,
      success: options?.success,
      errorMessage: options?.errorMessage,
      failClosed: true,
    });
  }

  /**
   * Log PHI deletion
   */
  async logDelete(
    resourceType: string,
    resourceId: string,
    previousValue: unknown,
    context: AuditContext,
    metadata?: AuditMetadata,
    options?: AuditOutcome
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: this.resolveActorType(context),
      action: 'DELETE',
      resourceType,
      resourceId,
      previousValue,
      ...this.contextFields(context),
      metadata,
      success: options?.success,
      errorMessage: options?.errorMessage,
      failClosed: true,
    });
  }

  /**
   * Log authentication events
   */
  async logAuth(
    action:
      | 'LOGIN'
      | 'LOGOUT'
      | 'LOGIN_FAILED'
      | 'PASSWORD_CHANGE'
      | 'PASSWORD_RESET_REQUEST'
      | 'PASSWORD_RESET_COMPLETE'
      | 'EMAIL_VERIFICATION'
      | 'EMAIL_CHANGE_REQUEST'
      | 'EMAIL_CHANGE_COMPLETE'
      | 'ACCOUNT_LOCKOUT'
      | 'REGISTER',
    context: AuditContext,
    metadata?: AuditMetadata
  ): Promise<void> {
    // Map auth events to AuditAction enum (default UPDATE covers
    // PASSWORD_CHANGE / PASSWORD_RESET_* / EMAIL_VERIFICATION /
    // EMAIL_CHANGE_* / ACCOUNT_LOCKOUT).
    const AUTH_ACTION_MAP: Partial<Record<typeof action, AuditAction>> = {
      LOGIN: 'LOGIN',
      LOGIN_FAILED: 'LOGIN',
      LOGOUT: 'LOGOUT',
      REGISTER: 'CREATE',
    };
    const auditAction: AuditAction = AUTH_ACTION_MAP[action] ?? 'UPDATE';

    await this.log({
      userId: context.userId,
      actorType: context.userId ? 'USER' : 'ANONYMOUS',
      action: auditAction,
      resourceType: 'Authentication',
      ...this.contextFields(context),
      metadata: { ...metadata, authAction: action },
    });
  }

  /**
   * Log data export events (important for HIPAA)
   */
  async logExport(
    resourceType: string,
    resourceIds: string[],
    format: string,
    context: AuditContext,
    metadata?: AuditMetadata
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: this.resolveActorType(context),
      action: 'EXPORT',
      resourceType,
      ...this.contextFields(context),
      metadata: {
        ...metadata,
        exportFormat: format,
        recordCount: resourceIds.length,
        resourceIds: resourceIds.slice(0, 100), // Limit stored IDs
      },
      failClosed: true,
    });
  }

  /**
   * Log system events
   */
  async logSystem(
    action: AuditAction,
    resourceType: string,
    details: SystemAuditDetails
  ): Promise<void> {
    await this.log({
      actorType: 'SYSTEM',
      action,
      resourceType,
      metadata: details,
    });
  }

  /**
   * Query audit logs (for compliance reporting)
   */
  async queryLogs(params: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: unknown[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (params.userId) where.userId = params.userId;
    if (params.resourceType) where.resourceType = params.resourceType;
    if (params.resourceId) where.resourceId = params.resourceId;
    if (params.action) where.action = params.action;

    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) (where.createdAt as Record<string, Date>).gte = params.startDate;
      if (params.endDate) (where.createdAt as Record<string, Date>).lte = params.endDate;
    }

    // Admin context — queryLogs is called from adminRoutes /audit-logs,
    // which is already RBAC-gated to ADMIN. The audit_logs_select policy
    // permits `user_id = current_user_id() OR is_admin_session()`; admin
    // wrapping is the correct path here.
    return withRLSContext(
      null,
      async (tx) => {
        const [rawLogs, total] = await Promise.all([
          tx.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: params.limit || 100,
            skip: params.offset || 0,
          }),
          tx.auditLog.count({ where }),
        ]);
        // Decrypt metadata for the authorized viewer and strip the raw
        // ciphertext column so it never leaves the service.
        const logs = rawLogs.map((row) => {
          const r = row as Record<string, unknown> & {
            metadataEncrypted?: string | null;
          };
          const metadata = this.decryptMetadata(r);
          const { metadataEncrypted: _enc, ...rest } = r;
          return { ...rest, metadata };
        });
        return { logs, total };
      },
      { isAdmin: true }
    );
  }

  /**
   * Clean up old audit logs beyond retention period
   * Should be run as a scheduled job
   */
  async cleanupOldLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    // Wrap only the deleteMany — the system-log call below opens its own
    // wrapper via this.log(), so keeping them as separate logical ops
    // avoids nested transactions and a rollback of the delete if the
    // follow-up audit entry fails for some reason.
    const deletedCount = await withRLSContext(
      null,
      async (tx) => {
        const result = await tx.auditLog.deleteMany({
          where: {
            createdAt: { lt: cutoffDate },
          },
        });
        return result.count;
      },
      { isAdmin: true }
    );

    await this.logSystem('DELETE', 'AuditLog', {
      action: 'retention_cleanup',
      deletedCount,
      cutoffDate: cutoffDate.toISOString(),
    });

    return deletedCount;
  }
}

// Singleton instance
let auditLogServiceInstance: AuditLogService | null = null;

export function getAuditLogService(prisma: PrismaClient): AuditLogService {
  if (!auditLogServiceInstance) {
    auditLogServiceInstance = new AuditLogService(prisma);
  }
  return auditLogServiceInstance;
}

// ============================================
// Audit Log Cleanup Scheduler
// ============================================

let auditCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the audit log cleanup scheduler
 * Runs daily to remove logs older than 7-year retention period
 */
export function startAuditCleanup(prisma: PrismaClient): void {
  // #38: when retention cleanup is delegated to Cloud Scheduler (a shared-secret
  // POST to /internal/audit-cleanup), skip the in-process interval. The 24h
  // setInterval rarely fires on scale-to-zero Cloud Run — the instance is
  // usually reaped long before 24h, so retention would never run.
  if (config.scheduler.auditCleanupToken) {
    logger.info('Audit retention cleanup delegated to Cloud Scheduler; in-process interval disabled', {
      prefix: 'AuditLog',
    });
    return;
  }

  if (auditCleanupInterval) {
    return; // Already running
  }

  const service = getAuditLogService(prisma);

  // Run cleanup daily (every 24 hours)
  auditCleanupInterval = setInterval(async () => {
    try {
      const count = await service.cleanupOldLogs();
      if (count > 0) {
        logger.info(`Cleaned up ${count} old audit logs`, { prefix: 'AuditLog' });
      }
    } catch (error) {
      logger.error('Cleanup failed', { prefix: 'AuditLog', data: { error } });
    }
  }, 24 * 60 * 60 * 1000);

  logger.info('Cleanup scheduler started (runs daily)', { prefix: 'AuditLog' });
}

/**
 * Stop the audit log cleanup scheduler
 */
export function stopAuditCleanup(): void {
  if (auditCleanupInterval) {
    clearInterval(auditCleanupInterval);
    auditCleanupInterval = null;
    logger.info('Cleanup scheduler stopped', { prefix: 'AuditLog' });
  }
}

export default AuditLogService;
