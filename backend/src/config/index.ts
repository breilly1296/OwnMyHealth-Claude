import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

  // Security - JWT Configuration
  // Note: expiresIn values are in seconds (number) for type compatibility with jsonwebtoken
  jwt: {
    // Access token - short lived (15 minutes = 900 seconds)
    accessSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-production',
    accessExpiresIn: parseInt(process.env.JWT_ACCESS_EXPIRES_SECONDS || '900', 10),

    // Refresh token - longer lived (7 days = 604800 seconds)
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production',
    refreshExpiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_SECONDS || '604800', 10),

    // Legacy support (15 minutes = 900 seconds)
    secret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'fallback-secret-change-in-production',
    expiresIn: parseInt(process.env.JWT_EXPIRES_SECONDS || '900', 10),
  },

  // Cookie Configuration
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    // Use 'lax' in development for cross-port requests, 'strict' in production
    sameSite: (process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') || (process.env.NODE_ENV === 'production' ? 'strict' : 'lax'),
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

  // Email Configuration (SendGrid)
  email: {
    enabled: process.env.SENDGRID_API_KEY ? true : false,
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
    fromEmail: process.env.EMAIL_FROM || 'noreply@ownmyhealth.io',
    fromName: process.env.EMAIL_FROM_NAME || 'OwnMyHealth',
    // Frontend URL for email links (verification, password reset)
    frontendUrl: process.env.FRONTEND_URL || 'https://ownmyhealth.io',
  },

  // API Versioning
  apiVersion: 'v1',

  // Validation
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Demo Account - allows demo login even in production
  // Set ALLOW_DEMO_ACCOUNT=true to enable demo account in production
  // This is separate from NODE_ENV so you can have production security + demo access
  allowDemoAccount: process.env.ALLOW_DEMO_ACCOUNT === 'true' || process.env.NODE_ENV === 'development',
} as const;

// Validate critical configuration in production
if (config.isProduction) {
  const requiredEnvVars = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'DATABASE_URL',
    'PHI_ENCRYPTION_KEY',
  ];
  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for production: ${missing.join(', ')}`);
  }

  // Ensure secrets are changed from defaults
  const defaultSecrets = [
    'access-secret-change-in-production',
    'refresh-secret-change-in-production',
    'fallback-secret-change-in-production',
  ];

  if (defaultSecrets.includes(config.jwt.accessSecret)) {
    throw new Error('JWT_ACCESS_SECRET must be changed in production');
  }

  if (defaultSecrets.includes(config.jwt.refreshSecret)) {
    throw new Error('JWT_REFRESH_SECRET must be changed in production');
  }

  // Validate JWT secret minimum length (at least 32 characters for 256-bit security)
  const MIN_JWT_SECRET_LENGTH = 32;

  if (config.jwt.accessSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. Current length: ${config.jwt.accessSecret.length}. ` +
      `Generate with: openssl rand -base64 32`
    );
  }

  if (config.jwt.refreshSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_REFRESH_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. Current length: ${config.jwt.refreshSecret.length}. ` +
      `Generate with: openssl rand -base64 32`
    );
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
}
