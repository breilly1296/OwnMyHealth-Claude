/**
 * app.ts - Express Application Server Entry Point
 *
 * This is the main entry point for the OwnMyHealth backend API server.
 * It configures and initializes all middleware, routes, and server infrastructure.
 *
 * Middleware Stack (in order):
 * 1. Helmet - Security HTTP headers (CSP, X-Frame-Options, etc.)
 * 2. CORS - Cross-Origin Resource Sharing configuration
 * 3. Cookie Parser - Parse cookies for authentication
 * 4. CSRF Protection - Prevent cross-site request forgery
 * 5. Rate Limiting - Prevent abuse and DoS attacks
 * 6. Morgan - HTTP request logging
 * 7. Body Parser - Parse JSON and URL-encoded bodies
 * 8. Routes - API endpoint handlers
 * 9. Error Handler - Centralized error handling
 *
 * Security Features:
 * - Helmet.js for HTTP security headers
 * - CORS with environment-specific origins
 * - CSRF token validation for state-changing requests
 * - Rate limiting (100 requests per 15 minutes)
 * - Trust proxy for reverse proxy deployments
 *
 * Initialization Process:
 * 1. Configure middleware stack
 * 2. Initialize database connection (Prisma)
 * 3. Create demo user (development/staging only)
 * 4. Start session cleanup scheduler
 * 5. Listen on configured port
 * 6. Set up graceful shutdown handlers
 *
 * Environment Variables:
 * - PORT: Server port (default: 3001)
 * - NODE_ENV: Environment (development/production)
 * - CORS_ORIGIN: Allowed origins (required in production)
 * - DATABASE_URL: PostgreSQL connection string
 *
 * @module app
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { standardLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { csrfProtection, csrfTokenHandler } from './middleware/csrf.js';
import { requireJsonContentType } from './middleware/validation.js';
import { initializeDatabase, disconnectDatabase, checkDatabaseHealth, getPrismaClient } from './services/database.js';
import { initializeDemoUser, startSessionCleanup, stopSessionCleanup } from './services/authService.js';
import { startAuditCleanup, stopAuditCleanup } from './services/auditLog.js';
import { logger } from './utils/logger.js';

// Production frontend origins that are always allowed, independent of the
// CORS_ORIGIN env var. Baked into the image so a misconfigured env var on
// Cloud Run can't silently break browser requests from the real frontend.
// Add to this list if you stand up a new frontend host.
const HARDCODED_PRODUCTION_ORIGINS = [
  'https://app.ownmyhealth.io',
  'https://ownmyhealth.io',
];

// SECURITY: Get safe CORS origins for the environment.
//
// Always parses CORS_ORIGIN as comma-separated and unions with the
// hardcoded production hosts. This runs in every environment — NOT
// gated on config.isProduction — because Cloud Run revisions have been
// observed to run with NODE_ENV=development, which would previously
// bypass the union entirely and break browser requests from the real
// frontend. Localhost-in-production guard is still scoped to the
// production branch.
function getSafeCorsOrigins(): string | string[] {
  const envValue = process.env.CORS_ORIGIN;

  if (config.isProduction) {
    if (!envValue) {
      throw new Error('CORS_ORIGIN must be set in production');
    }
    const envOrigins = envValue.split(',').map(o => o.trim()).filter(Boolean);
    if (envOrigins.some(o => o.includes('localhost') || o.includes('127.0.0.1'))) {
      throw new Error('CORS_ORIGIN cannot contain localhost in production');
    }
    const origins = Array.from(new Set([...envOrigins, ...HARDCODED_PRODUCTION_ORIGINS]));
    return origins.length === 1 ? origins[0] : origins;
  }

  // Non-production: allow whatever CORS_ORIGIN specifies (parsed as
  // comma-separated) plus the hardcoded production hosts plus the
  // localhost fallback when env is unset.
  const envOrigins = envValue
    ? envValue.split(',').map(o => o.trim()).filter(Boolean)
    : [];
  const localDefaults = Array.isArray(config.cors.origin) ? config.cors.origin : [];
  const origins = Array.from(new Set([
    ...envOrigins,
    ...HARDCODED_PRODUCTION_ORIGINS,
    ...localDefaults,
  ]));
  return origins.length === 1 ? origins[0] : origins;
}

// Create Express app
const app = express();

// SECURITY: Trust proxy - REQUIRED for secure IP address handling
// Cloud Run / load balancers set X-Forwarded-For headers. With trust proxy enabled,
// Express correctly parses these headers and sets req.ip to the real client IP.
// This is CRITICAL for:
// - Rate limiting (prevents all requests appearing from load balancer IP)
// - Audit logging (see auditLog.ts getClientIp - relies on this for HIPAA compliance)
// - IP-based security controls
// The value '1' means trust the first proxy hop (Cloud Run's load balancer)
app.set('trust proxy', 1);

// Security middleware
// When using cross-domain cookies (COOKIE_DOMAIN set), we need to relax some policies
const isCrossDomain = !!config.cookie.domain;
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
  // CRITICAL: Must disable for cross-domain setups, otherwise blocks CORS requests
  crossOriginResourcePolicy: isCrossDomain ? false : { policy: 'same-origin' as const },
}));

// CORS configuration - use safe origins based on environment
// For cross-domain cookies (sameSite=none), CORS must:
// 1. Set Access-Control-Allow-Origin to the exact origin (not *)
// 2. Set Access-Control-Allow-Credentials: true
// 3. Handle OPTIONS preflight requests
const allowedOrigins = getSafeCorsOrigins();
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is allowed
    const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
    if (origins.includes(origin)) {
      return callback(null, origin); // Return the specific origin, not true
    }

    // Log rejected origins for debugging
    logger.warn('CORS rejected origin', { data: { origin, allowedOrigins: origins } });
    return callback(new Error(`CORS policy: Origin ${origin} not allowed`));
  },
  credentials: true, // Required for cross-domain cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'], // Allow frontend to read CSRF token header
  // Ensure preflight requests are handled properly
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400, // Cache preflight for 24 hours
};

// Log CORS configuration on startup for debugging
logger.info('CORS configuration', {
  data: {
    allowedOrigins: Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins],
    credentials: true,
    isCrossDomain,
  },
});

// Apply CORS middleware
app.use(cors(corsOptions));

// Explicit OPTIONS handler for preflight requests (belt and suspenders)
app.options('*', cors(corsOptions));

// Cookie parsing (must be before routes)
app.use(cookieParser());

// CSRF protection for state-changing requests
// Skip in development if DISABLE_CSRF=true for easier testing
if (!config.isDevelopment || process.env.DISABLE_CSRF !== 'true') {
  app.use(csrfProtection);
}

// Rate limiting
app.use(standardLimiter);

// Request logging
if (config.isDevelopment) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Content-Type validation for JSON requests
app.use(requireJsonContentType);

// API routes
app.use(`/api/${config.apiVersion}`, routes);

// Dev-only mock FHIR server — lets the Quest SMART-on-FHIR integration
// be exercised end-to-end locally without real sandbox credentials.
// Never mounted in production; the service's mountMockFhirServer also
// double-checks NODE_ENV as a belt-and-suspenders guard.
if (config.isDevelopment) {
  // Lazy import so production builds don't carry the mock data.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import('./services/fhir/mockFhirServer.js').then(({ mountMockFhirServer }) => {
    mountMockFhirServer(app);
  });
}

// CSRF token endpoint - allows SPA to fetch a fresh CSRF token
app.get(`/api/${config.apiVersion}/csrf-token`, csrfTokenHandler);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: 'OwnMyHealth API',
      version: config.apiVersion,
      environment: config.nodeEnv,
      documentation: `/api/${config.apiVersion}`,
    },
  });
});

// Health check endpoint for Docker/Kubernetes/monitoring
// This endpoint does NOT require authentication
app.get('/health', async (_req, res) => {
  const dbHealth = await checkDatabaseHealth();
  const isHealthy = dbHealth.connected;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbHealth.connected ? 'connected' : 'disconnected',
    },
  });
});

// Legacy database health check endpoint (kept for backwards compatibility)
app.get('/api/health/db', async (_req, res) => {
  const health = await checkDatabaseHealth();
  res.status(health.connected ? 200 : 503).json({
    success: health.connected,
    data: health,
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection
    await initializeDatabase();

    // Initialize demo user (non-production only)
    await initializeDemoUser();

    // Start session cleanup scheduler
    startSessionCleanup();

    // Start audit log cleanup scheduler (runs daily)
    startAuditCleanup(getPrismaClient());

    const server = app.listen(config.port, () => {
      // Log cookie configuration for debugging cross-domain issues
      logger.info('Cookie configuration', {
        data: {
          domain: config.cookie.domain || '(not set - will use request domain)',
          sameSite: config.cookie.sameSite,
          secure: config.cookie.secure,
        },
      });

      logger.startup(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🏥  OwnMyHealth API Server                          ║
║                                                       ║
║   Environment: ${config.nodeEnv.padEnd(38)}║
║   Port:        ${String(config.port).padEnd(38)}║
║   API:         /api/${config.apiVersion}${' '.repeat(33)}║
║   Database:    Connected                              ║
║                                                       ║
║   Endpoints:                                          ║
║   • GET  /health                      - Health check (Docker) ║
║   • GET  /api/${config.apiVersion}/biomarkers          - Biomarkers API     ║
║   • GET  /api/${config.apiVersion}/insurance           - Insurance API      ║
║   • GET  /api/${config.apiVersion}/health              - API health check   ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown handler
    const gracefulShutdown = async (signal: string) => {
      logger.startup(`${signal} received, shutting down gracefully...`);
      stopSessionCleanup();
      stopAuditCleanup();
      server.close(async () => {
        await disconnectDatabase();
        logger.startup('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server', { data: { error } });
    process.exit(1);
  }
}

startServer();

export default app;
