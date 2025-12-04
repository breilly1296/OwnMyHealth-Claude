import { PrismaClient, AuditAction, ActorType } from '../generated/prisma';
import { getEncryptionService } from './encryption.js';
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
    // Get or create system salt for encrypting audit log values
    let config = await this.prisma.systemConfig.findUnique({
      where: { key: 'audit_encryption_salt' },
    });

    if (!config) {
      const encryptionService = getEncryptionService();
      this.systemSalt = encryptionService.generateUserSalt();

      config = await this.prisma.systemConfig.create({
        data: {
          key: 'audit_encryption_salt',
          value: this.systemSalt,
          description: 'Salt used for encrypting audit log values',
          isEncrypted: false, // The salt itself is not encrypted
        },
      });
    }

    this.systemSalt = config.value;

    // Validate that we have a valid salt
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
   * Get client IP address (handling proxies)
   */
  private getClientIp(req: Request): string {
    const forwarded = req.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
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

export default AuditLogService;
