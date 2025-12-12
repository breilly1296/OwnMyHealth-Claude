/**
 * Express Request Type Extensions
 *
 * Extends Express Request type to include custom properties
 * added by our middleware (auth, RBAC, etc.)
 *
 * This eliminates the need for unsafe double type assertions
 * like `(req as unknown as { user?: {...} }).user`
 */

import { UserRole } from './index.js';

declare global {
  namespace Express {
    interface Request {
      /**
       * Authenticated user information (set by auth middleware)
       */
      user?: {
        id: string;
        email: string;
        role: UserRole;
      };

      /**
       * Session ID for audit logging
       */
      sessionId?: string;

      /**
       * User ID (may differ from req.user.id in provider access scenarios)
       */
      userId?: string;

      /**
       * User scope for RBAC (set by rbac middleware)
       */
      userScope?: {
        type: 'self' | 'provider' | 'admin';
        userId?: string;
        providerId?: string;
      };

      /**
       * Provider-patient relationship (set by checkPatientAccess middleware)
       */
      providerPatientRelationship?: {
        id: string;
        providerId: string;
        patientId: string;
        canViewBiomarkers: boolean;
        canViewInsurance: boolean;
        canViewDna: boolean;
        canViewHealthNeeds: boolean;
        canEditData: boolean;
        status: string;
      };
    }
  }
}

export {};
