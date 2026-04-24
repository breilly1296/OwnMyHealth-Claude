import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Read a required environment variable. Throws immediately at module load
 * if the value is missing or empty. Used for secrets that MUST NOT have
 * fallbacks in any environment (dev, staging, preview, prod).
 *
 * Rationale: C-3 — prior to this change, JWT secrets had literal fallbacks
 * like 'access-secret-change-in-production'. Production gates caught them
 * only when NODE_ENV='production' was set explicitly. Staging / dev /
 * preview deploys with NODE_ENV unset signed tokens with publicly-known
 * repo strings.
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `This secret must be set in every environment (dev, staging, prod). ` +
      `Generate with: openssl rand -base64 32`
    );
  }
  return value;
}

// Environment-tier flags. Staging is production-like (same CORS rules,
// structured logging, rate limits) but differs on three points: Claude
// calls are locked out (BAA inactive), SendGrid is in sandbox mode so no
// real email ships, and the demo account is allowed.
const isProductionEnv = process.env.NODE_ENV === 'production';
const isStagingEnv = process.env.NODE_ENV === 'staging';
const isDevelopmentEnv = !isProductionEnv && !isStagingEnv;

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

  // Audit log encryption salt. Pre C-8 this was stored in the system_config
  // table and read at boot; that coupled startup to an admin-bypass DB call,
  // which blocks the NOBYPASSRLS role cutover. Moving the salt to an env var
  // (Secret Manager in prod) removes the dependency entirely.
  //
  // Migration note: production already has a historic salt encrypted in
  // `system_config.audit_encryption_salt`. Before this code is deployed to
  // prod, an operator must extract that salt (see docs/STAGING.md → "Audit
  // salt migration") and write the plaintext value to AUDIT_LOG_SALT in
  // Secret Manager. Rotating the salt silently would make every pre-existing
  // audit log's encrypted PHI undecryptable — hence the hard-fail below.
  auditSalt: process.env.AUDIT_LOG_SALT || '',

  // Security - JWT Configuration
  // Note: expiresIn values are in seconds (number) for type compatibility with jsonwebtoken.
  // accessSecret / refreshSecret go through requireEnv — no fallback in any environment.
  jwt: {
    // Access token - short lived (15 minutes = 900 seconds)
    accessSecret: requireEnv('JWT_ACCESS_SECRET'),
    accessExpiresIn: parseInt(process.env.JWT_ACCESS_EXPIRES_SECONDS || '900', 10),

    // Refresh token - longer lived (7 days = 604800 seconds)
    refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
    refreshExpiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_SECONDS || '604800', 10),
  },

  // Cookie Configuration
  // For cross-domain setups (frontend on domain.com, API on api.domain.com):
  // - Set COOKIE_DOMAIN=.domain.com (note the leading dot)
  // - Set COOKIE_SAME_SITE=none (required for cross-domain)
  // - Secure will be true in production (required when SameSite=none)
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    // Cross-domain requires SameSite=none; same-domain can use strict/lax
    // If COOKIE_DOMAIN is set, default to 'none' for cross-domain support
    sameSite: (process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') ||
      (process.env.COOKIE_DOMAIN ? 'none' : (process.env.NODE_ENV === 'production' ? 'lax' : 'lax')),
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAge: {
      accessToken: 15 * 60 * 1000, // 15 minutes in ms
      refreshToken: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    },
  },

  // Account Security
  security: {
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION_MINUTES || '30', 10) * 60 * 1000, // 30 min in ms
    // 13 rounds minimum recommended for healthcare/HIPAA workloads (2024+)
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '13', 10),
  },

  // CORS - allow multiple frontend ports during development
  cors: {
    origin: process.env.CORS_ORIGIN || [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      'http://localhost:3000',
    ],
    credentials: true,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // Demo Account Configuration
  // SECURITY: No hardcoded fallbacks - must be explicitly configured via env vars
  demo: {
    enabled: process.env.DEMO_ACCOUNT_ENABLED === 'true',
    email: process.env.DEMO_EMAIL || '',
    password: process.env.DEMO_PASSWORD || '',
  },

  // Email Configuration (SendGrid)
  email: {
    enabled: !!process.env.SENDGRID_API_KEY,
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
    fromEmail: process.env.EMAIL_FROM || 'noreply@ownmyhealth.com',
    fromName: process.env.EMAIL_FROM_NAME || 'OwnMyHealth',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    // SendGrid sandbox mode — validates requests (templates, recipients)
    // but never actually delivers. Staging sets this to true so test
    // accounts can trigger notification flows without spamming real users.
    sandboxMode:
      process.env.SENDGRID_SANDBOX_MODE === 'true' || isStagingEnv,
  },

  // Google Cloud Platform Configuration
  gcp: {
    bucketName: process.env.GCS_BUCKET_NAME || 'ownmyhealth-user-files',
    projectId: process.env.GCP_PROJECT_ID || '',
    // Path to service account credentials JSON file
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  },

  // Anthropic Claude API (see C-7 — BAA gate for PHI disclosure)
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    // Explicit flag that asserts a signed Business Associate Agreement
    // is in effect. Runtime callers in claudeExtraction / sbcExtraction
    // check this before sending any PDF content.
    baaActive: process.env.ANTHROPIC_BAA_ACTIVE === 'true',
  },

  // Quest Diagnostics SMART on FHIR integration.
  // Credentials are optional — the feature is disabled unless clientId is set.
  // In development without sandbox credentials, set QUEST_FHIR_BASE_URL to the
  // mock server path (e.g. http://localhost:3001/api/v1/mock-fhir/r4) to
  // exercise the full flow locally.
  quest: {
    clientId: process.env.QUEST_FHIR_CLIENT_ID || '',
    clientSecret: process.env.QUEST_FHIR_CLIENT_SECRET || '',
    fhirBaseUrl:
      process.env.QUEST_FHIR_BASE_URL || 'https://api.questdiagnostics.com/fhir/r4',
    redirectUri:
      process.env.QUEST_FHIR_REDIRECT_URI ||
      'https://api.ownmyhealth.io/api/v1/fhir/callback',
    frontendSuccessRedirect:
      process.env.QUEST_FHIR_SUCCESS_REDIRECT ||
      'http://localhost:5173/settings?labConnected=quest',
  },

  // API Versioning
  apiVersion: 'v1',

  // Validation
  isDevelopment: isDevelopmentEnv,
  isStaging: isStagingEnv,
  isProduction: isProductionEnv,
} as const;

// Universal JWT-secret-quality checks — run in EVERY environment, not just prod.
// The hardcoded-default strings no longer reach this code (the fallbacks were
// removed in C-3 via requireEnv), but we still reject anyone who tries to set
// them explicitly via a leaked .env.example. Length validation is also universal —
// a short secret in dev is still a bad habit, and dev DBs often contain real-ish
// PHI during testing.
const BLOCKED_JWT_VALUES = new Set([
  'access-secret-change-in-production',
  'refresh-secret-change-in-production',
  'fallback-secret-change-in-production',
  'change-me',
  'secret',
  'jwt-secret',
]);

if (BLOCKED_JWT_VALUES.has(config.jwt.accessSecret)) {
  throw new Error(
    'JWT_ACCESS_SECRET is set to a known-weak placeholder value. ' +
    'Generate a real secret with: openssl rand -base64 32'
  );
}
if (BLOCKED_JWT_VALUES.has(config.jwt.refreshSecret)) {
  throw new Error(
    'JWT_REFRESH_SECRET is set to a known-weak placeholder value. ' +
    'Generate a real secret with: openssl rand -base64 32'
  );
}

const MIN_JWT_SECRET_LENGTH = 32;
if (config.jwt.accessSecret.length < MIN_JWT_SECRET_LENGTH) {
  throw new Error(
    `JWT_ACCESS_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. ` +
    `Current length: ${config.jwt.accessSecret.length}. ` +
    `Generate with: openssl rand -base64 32`
  );
}
if (config.jwt.refreshSecret.length < MIN_JWT_SECRET_LENGTH) {
  throw new Error(
    `JWT_REFRESH_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. ` +
    `Current length: ${config.jwt.refreshSecret.length}. ` +
    `Generate with: openssl rand -base64 32`
  );
}

// Audit salt validation — fail hard if missing or too short. Silently
// generating a new salt would render existing audit logs undecryptable, so
// we refuse to boot rather than risk that. Length check mirrors
// AuditLogService.initialize()'s prior runtime check (see auditLog.ts).
const MIN_AUDIT_SALT_LENGTH = 16;
if (!config.auditSalt || config.auditSalt.length < MIN_AUDIT_SALT_LENGTH) {
  throw new Error(
    `AUDIT_LOG_SALT must be set and at least ${MIN_AUDIT_SALT_LENGTH} characters. ` +
    `Historic audit logs are encrypted with this salt — rotating it breaks decryption. ` +
    `For new environments, generate with: openssl rand -hex 32. ` +
    `For existing production envs, extract the plaintext salt from ` +
    `system_config.audit_encryption_salt (decrypt with PHI_ENCRYPTION_KEY) ` +
    `before setting AUDIT_LOG_SALT.`
  );
}

// C-7 — require explicit acknowledgment of Anthropic BAA coverage before
// Claude calls are allowed. Production refuses to boot with API key set
// but BAA flag unset; dev/staging log a prominent warning (the runtime
// gates in claudeExtraction / sbcExtraction are the load-bearing check
// there — see "Claude extraction is disabled" errors).
if (config.anthropic.apiKey && !config.anthropic.baaActive) {
  if (config.isProduction) {
    throw new Error(
      'ANTHROPIC_BAA_ACTIVE must be set to "true" in production when ANTHROPIC_API_KEY is configured. ' +
      'This flag asserts that a signed Business Associate Agreement is in effect. ' +
      'If no BAA is in place, unset ANTHROPIC_API_KEY to disable AI features.'
    );
  } else {
    process.stderr.write(
      '⚠️  ANTHROPIC_BAA_ACTIVE is not set to "true". Claude calls will be blocked by the runtime gate. ' +
      'Set ANTHROPIC_BAA_ACTIVE=true after confirming BAA coverage.\n'
    );
  }
}

// Validate critical configuration in production AND staging. Staging is
// production-like — same DB/encryption requirements, same CORS sanity
// check — with two explicit carveouts: demo account is allowed (needed
// for testing flows) and BAA gate stays a warning (staging uses no real
// PHI, so Claude calls being blocked by the runtime gate is the intended
// behavior).
if (config.isProduction || config.isStaging) {
  const envLabel = config.isProduction ? 'production' : 'staging';

  const requiredEnvVars = [
    'DATABASE_URL',
    'PHI_ENCRYPTION_KEY',
  ];
  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for ${envLabel}: ${missing.join(', ')}`);
  }

  // Validate PHI_ENCRYPTION_KEY format and security
  const phiKey = process.env.PHI_ENCRYPTION_KEY!;
  const hexRegex = /^[0-9a-fA-F]+$/;

  if (phiKey.length < 64) {
    throw new Error(
      `PHI_ENCRYPTION_KEY must be at least 64 hex characters (256 bits). Current length: ${phiKey.length}. ` +
      `Generate with: openssl rand -hex 32`
    );
  }

  if (!hexRegex.test(phiKey)) {
    throw new Error(
      'PHI_ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f, A-F)'
    );
  }

  // Check for known insecure/placeholder keys
  const insecureKeys = [
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '0000000000000000000000000000000000000000000000000000000000000000',
  ];

  if (insecureKeys.includes(phiKey.toLowerCase())) {
    throw new Error(
      'PHI_ENCRYPTION_KEY appears to be a placeholder/test key. ' +
      'Generate a secure key with: openssl rand -hex 32'
    );
  }

  // Validate CORS origin is not localhost in prod/staging.
  // Note: Using process.stderr directly to avoid circular dependency with logger
  // This is a critical security warning that must always display
  const corsOrigin = config.cors.origin;
  if (Array.isArray(corsOrigin) && corsOrigin.some(o => o.includes('localhost'))) {
    process.stderr.write(`${new Date().toISOString()} WARN [Security] CORS origin contains localhost URLs in ${envLabel}\n`);
  }

  // Demo account: blocked in prod only. Staging needs it for testing.
  if (config.isProduction && config.demo.enabled) {
    throw new Error(
      'DEMO_ACCOUNT_ENABLED cannot be true in production. ' +
      'Demo mode bypasses security controls and is only for development/testing. ' +
      'Set DEMO_ACCOUNT_ENABLED=false or remove it from environment variables.'
    );
  }

  // Non-fatal warnings for optional service credentials
  // These services degrade gracefully but should be configured for full functionality
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(`${new Date().toISOString()} WARN [Config] ANTHROPIC_API_KEY is not set — AI features (biomarker guidance, document extraction, cost analysis) will be unavailable\n`);
  }
  if (!process.env.SENDGRID_API_KEY) {
    process.stderr.write(`${new Date().toISOString()} WARN [Config] SENDGRID_API_KEY is not set — email functionality (verification, password reset) will be unavailable\n`);
  }
  if (!process.env.GCP_PROJECT_ID) {
    process.stderr.write(`${new Date().toISOString()} WARN [Config] GCP_PROJECT_ID is not set — cloud storage and OCR services will be unavailable\n`);
  }
}
