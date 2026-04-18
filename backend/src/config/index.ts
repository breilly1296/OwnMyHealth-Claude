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

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

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
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
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
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
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

// Validate other critical configuration in production
if (config.isProduction) {
  const requiredEnvVars = [
    'DATABASE_URL',
    'PHI_ENCRYPTION_KEY',
  ];
  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for production: ${missing.join(', ')}`);
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

  // Validate CORS origin is not localhost in production
  // Note: Using process.stderr directly to avoid circular dependency with logger
  // This is a critical security warning that must always display
  const corsOrigin = config.cors.origin;
  if (Array.isArray(corsOrigin) && corsOrigin.some(o => o.includes('localhost'))) {
    process.stderr.write(`${new Date().toISOString()} WARN [Security] CORS origin contains localhost URLs in production\n`);
  }

  // Block demo account in production - security risk
  if (config.demo.enabled) {
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
