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
import { initializeDatabase, disconnectDatabase, checkDatabaseHealth } from './services/database.js';
import { initializeDemoUser, startSessionCleanup, stopSessionCleanup } from './services/authService.js';
import { logger } from './utils/logger.js';

// SECURITY: Get safe CORS origins for the environment
function getSafeCorsOrigins(): string | string[] {
  // In production, reject localhost origins
  if (config.isProduction) {
    const origin = process.env.CORS_ORIGIN;
    if (!origin) {
      throw new Error('CORS_ORIGIN must be set in production');
    }
    // Parse comma-separated list if provided
    const origins = origin.split(',').map(o => o.trim());
    // Validate no localhost in production
    if (origins.some(o => o.includes('localhost') || o.includes('127.0.0.1'))) {
      throw new Error('CORS_ORIGIN cannot contain localhost in production');
    }
    return origins.length === 1 ? origins[0] : origins;
  }
  // Development: allow localhost ports
  return config.cors.origin;
}

// Create Express app
const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
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
}));

// CORS configuration - use safe origins based on environment
app.use(cors({
  origin: getSafeCorsOrigins(),
  credentials: config.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
}));

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

// API routes
app.use(`/api/${config.apiVersion}`, routes);

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

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Database health check endpoint
app.get('/api/health/db', async (_req, res) => {
  const health = await checkDatabaseHealth();
  res.status(health.connected ? 200 : 503).json({
    success: health.connected,
    data: health,
  });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection
    await initializeDatabase();

    // Initialize demo user (non-production only)
    await initializeDemoUser();

    // Start session cleanup scheduler
    startSessionCleanup();

    const server = app.listen(config.port, () => {
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
║   • GET  /api/${config.apiVersion}/health              - Health check       ║
║   • GET  /api/${config.apiVersion}/biomarkers          - Biomarkers API     ║
║   • GET  /api/${config.apiVersion}/insurance           - Insurance API      ║
║   • GET  /api/health/db               - DB health check   ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown handler
    const gracefulShutdown = async (signal: string) => {
      logger.startup(`${signal} received, shutting down gracefully...`);
      stopSessionCleanup();
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
