
# OwnMyHealth - Project Context

## What This Is
Privacy-first osteoporosis management platform. HIPAA-compliant health data tracking with insurance navigation.

## Tech Stack
- Frontend: React + Vite + TypeScript + Tailwind
- Backend: Node.js + Hono framework
- Database: PostgreSQL + Prisma ORM
- Auth: JWT + CSRF tokens
- Encryption: AES-256-GCM for all PHI
- Target: AWS ECS Fargate, RDS, S3

## Critical Rules
1. **NEVER use localStorage/sessionStorage** - all sensitive data in memory only
2. **All PHI must be encrypted** with AES-256-GCM before database storage
3. **Every PHI access must be audit logged** - HIPAA requires 7-year retention
4. **Always include disclaimers** - we provide education, never medical advice
5. **Validate all input** - never trust user data

## Key Files
- `backend/prisma/schema.prisma` - Database models
- `backend/src/services/encryption.ts` - PHI encryption
- `backend/src/middleware/auth.ts` - Authentication
- `backend/src/services/auditLog.ts` - HIPAA audit trail

## When Reviewing Code
- Check: Is auth middleware on all protected routes?
- Check: Is PHI encrypted before storage?
- Check: Are audit logs created for PHI access?
- Check: Is input validated?
- Check: Are errors handled without leaking data?