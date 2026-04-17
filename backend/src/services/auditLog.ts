import { PrismaClient, AuditAction, ActorType } from '../../generated/prisma';
import { getEncryptionService } from './encryption.js';
import { withRLSContext } from './database.js';
import { Request } from 'express';
import { logger } from '../utils/logger.js';

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
}

interface AuditContext {
  req?: Request;
  userId?: string;
  sessionId?: string;
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
  private prisma: PrismaClient;
  private systemSalt: string = '';

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Initialize the audit service with system encryption salt
   * Call this once at startup
   *
   * CRITICAL: This MUST succeed for HIPAA compliance.
   * Audit logging is required for all PHI access.
   */
  async initialize(): Promise<void> {
    const encryptionService = getEncryptionService();

    // Run all system_config access inside an admin RLS context. This is the
    // only pre-auth / boot-time code path that touches system_config, so it
    // legitimately needs admin bypass — user context doesn't exist yet.
    //
    // Without this wrapper, a NOBYPASSRLS application role (see C-8) would
    // see findUnique return null (admin-only SELECT policy) and the
    // subsequent create/update would fail the INSERT policy. Today's
    // superuser DATABASE_URL role bypasses RLS entirely so this is a no-op;
    // after the C-8 infra cutover migrates DATABASE_URL to a NOBYPASSRLS
    // role (omh_app), this wrapper becomes load-bearing.
    await withRLSContext(
      null,
      async (tx) => {
        const config = await tx.systemConfig.findUnique({
          where: { key: 'audit_encryption_salt' },
        });

        if (!config) {
          // First-time init: generate a fresh salt, encrypt it under the
          // master key, and persist the ciphertext. The salt itself never
          // hits disk in plaintext.
          const freshSalt = encryptionService.generateUserSalt();
          const encryptedSalt = encryptionService.encryptWithMasterKey(freshSalt);

          await tx.systemConfig.create({
            data: {
              key: 'audit_encryption_salt',
              value: encryptedSalt,
              description: 'Salt used for encrypting audit log values (encrypted under PHI_ENCRYPTION_KEY master key)',
              isEncrypted: true,
            },
          });

          this.systemSalt = freshSalt;
        } else if (config.isEncrypted) {
          // Normal post-migration path: stored value is ciphertext, decrypt it.
          this.systemSalt = encryptionService.decryptWithMasterKey(config.value);
        } else {
          // Legacy row from pre-C-2 code: plaintext salt already on disk.
          // Value must be preserved exactly (rotating it would invalidate
          // every existing audit log's PHI ciphertext). Re-encrypt in place
          // so the next boot takes the normal path. Idempotent — no-op
          // after first success.
          this.systemSalt = config.value;

          const encryptedSalt = encryptionService.encryptWithMasterKey(this.systemSalt);
          await tx.systemConfig.update({
            where: { key: 'audit_encryption_salt' },
            data: {
              value: encryptedSalt,
              isEncrypted: true,
              description: 'Salt used for encrypting audit log values (encrypted under PHI_ENCRYPTION_KEY master key)',
            },
          });
          logger.startup('✓ Audit encryption salt migrated from plaintext to encrypted storage');
        }
      },
      { isAdmin: true }
    );

    // Validate the decrypted/plaintext salt, not the ciphertext. No DB
    // access here — a plain string check; doesn't need the wrapper.
    if (!this.systemSalt || this.systemSalt.length < 16) {
      throw new Error(
        'FATAL: Invalid audit encryption salt. ' +
        'HIPAA compliance requires a valid encryption salt for audit logs.'
      );
    }

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
   * Encrypt sensitive values before storing in audit log
   */
  private encryptValue(value: unknown): string | null {
    if (value === undefined || value === null) return null;

    try {
      const encryptionService = getEncryptionService();
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      return encryptionService.encrypt(stringValue, this.systemSalt);
    } catch (error) {
      logger.error('Failed to encrypt audit value', { data: { error } });
      return '[ENCRYPTION_FAILED]';
    }
  }

  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          actorType: entry.actorType,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          previousValueEncrypted: this.encryptValue(entry.previousValue),
          newValueEncrypted: this.encryptValue(entry.newValue),
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          sessionId: entry.sessionId,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        },
      });
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
    metadata?: AuditMetadata
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: context.userId ? 'USER' : 'SYSTEM',
      action: 'READ',
      resourceType,
      resourceId: resourceId || undefined,
      ipAddress: context.req ? this.getClientIp(context.req) : undefined,
      userAgent: context.req?.get('user-agent')?.substring(0, 500),
      sessionId: context.sessionId,
      metadata,
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
    metadata?: AuditMetadata
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: context.userId ? 'USER' : 'SYSTEM',
      action: 'CREATE',
      resourceType,
      resourceId,
      newValue,
      ipAddress: context.req ? this.getClientIp(context.req) : undefined,
      userAgent: context.req?.get('user-agent')?.substring(0, 500),
      sessionId: context.sessionId,
      metadata,
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
    metadata?: AuditMetadata
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: context.userId ? 'USER' : 'SYSTEM',
      action: 'UPDATE',
      resourceType,
      resourceId,
      previousValue,
      newValue,
      ipAddress: context.req ? this.getClientIp(context.req) : undefined,
      userAgent: context.req?.get('user-agent')?.substring(0, 500),
      sessionId: context.sessionId,
      metadata,
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
    metadata?: AuditMetadata
  ): Promise<void> {
    await this.log({
      userId: context.userId,
      actorType: context.userId ? 'USER' : 'SYSTEM',
      action: 'DELETE',
      resourceType,
      resourceId,
      previousValue,
      ipAddress: context.req ? this.getClientIp(context.req) : undefined,
      userAgent: context.req?.get('user-agent')?.substring(0, 500),
      sessionId: context.sessionId,
      metadata,
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
      | 'ACCOUNT_LOCKOUT'
      | 'REGISTER',
    context: AuditContext,
    metadata?: AuditMetadata
  ): Promise<void> {
    // Map auth events to AuditAction enum
    let auditAction: AuditAction;
    switch (action) {
      case 'LOGIN':
      case 'LOGIN_FAILED':
        auditAction = 'LOGIN';
        break;
      case 'LOGOUT':
        auditAction = 'LOGOUT';
        break;
      case 'REGISTER':
        auditAction = 'CREATE';
        break;
      default:
        auditAction = 'UPDATE';
    }

    await this.log({
      userId: context.userId,
      actorType: context.userId ? 'USER' : 'ANONYMOUS',
      action: auditAction,
      resourceType: 'Authentication',
      ipAddress: context.req ? this.getClientIp(context.req) : undefined,
      userAgent: context.req?.get('user-agent')?.substring(0, 500),
      sessionId: context.sessionId,
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
      actorType: context.userId ? 'USER' : 'SYSTEM',
      action: 'EXPORT',
      resourceType,
      ipAddress: context.req ? this.getClientIp(context.req) : undefined,
      userAgent: context.req?.get('user-agent')?.substring(0, 500),
      sessionId: context.sessionId,
      metadata: {
        ...metadata,
        exportFormat: format,
        recordCount: resourceIds.length,
        resourceIds: resourceIds.slice(0, 100), // Limit stored IDs
      },
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

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit || 100,
        skip: params.offset || 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  /**
   * Clean up old audit logs beyond retention period
   * Should be run as a scheduled job
   */
  async cleanupOldLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const result = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    await this.logSystem('DELETE', 'AuditLog', {
      action: 'retention_cleanup',
      deletedCount: result.count,
      cutoffDate: cutoffDate.toISOString(),
    });

    return result.count;
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
