'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BaileysProvider = require('./providers/BaileysProvider');
const { ProviderError } = require('./providers/ProviderErrors');

// Load local .env safely using Node native API if file exists, without overwriting existing env
const envFilePath = path.join(__dirname, '.env');
if (fs.existsSync(envFilePath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envFilePath);
  } catch (err) {
    console.warn('Notice: Could not load local .env file:', err.message);
  }
}

// Validate WHATSAPP_INTERNAL_SECRET at startup and fail closed if missing or blank
const INTERNAL_SECRET = process.env.WHATSAPP_INTERNAL_SECRET;
if (!INTERNAL_SECRET || !INTERNAL_SECRET.trim()) {
  console.error(
    'FATAL: WHATSAPP_INTERNAL_SECRET environment variable is missing or empty. Microservice cannot start.'
  );
  process.exit(1);
}

/**
 * Creates and initializes the WhatsApp provider.
 * Standardized exclusively on BaileysProvider (lightweight WebSocket engine).
 *
 * @param {string|Object} [engineOrOptions] - Optional engine name string or options object
 * @param {Object} [options]
 * @returns {BaileysProvider}
 */
function createProvider(engineOrOptions, options = {}) {
  const mergedOptions =
    typeof engineOrOptions === 'object' && engineOrOptions !== null
      ? { ...engineOrOptions, ...options }
      : options;

  return new BaileysProvider({
    mongodbUri: mergedOptions.mongodbUri || process.env.MONGODB_URI,
    ...mergedOptions,
  });
}

// Instantiate exactly one active WhatsApp provider per process
const provider = createProvider();

const PORT = process.env.PORT || 3005;
const HOST = process.env.WHATSAPP_HOST || '0.0.0.0';

/**
 * Constant-time comparison for internal secret to prevent timing side-channel attacks
 */
function isInternalSecretValid(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const provBuf = Buffer.from(provided, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (provBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(provBuf, expBuf);
}

/**
 * Internal authentication middleware for all service requests
 */
function authenticateInternalSecret(req, res, next) {
  const providedSecret = req.headers['x-internal-secret'];

  if (!providedSecret || typeof providedSecret !== 'string') {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing internal service secret header (x-internal-secret).',
    });
  }

  if (!isInternalSecretValid(providedSecret.trim(), INTERNAL_SECRET.trim())) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid internal service secret.',
    });
  }

  next();
}

/**
 * Express application factory.
 * Binds all routes to the specified provider instance while preserving identical HTTP contracts.
 *
 * @param {import('./providers/IWhatsAppProvider')} [activeProvider=provider]
 * @returns {import('express').Express}
 */
function createApp(activeProvider = provider) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  /**
   * Health check endpoint for orchestrators (e.g. Render)
   * Reports HTTP service health, memory usage, and persistence configuration status.
   * Does not require internal secret.
   */
  app.get('/health', (req, res) => {
    const isConfigured = Boolean(activeProvider.mongoUri && activeProvider.mongoUri.trim());
    const isDegraded = isConfigured && !activeProvider.isMongoConnected;
    const mem = process.memoryUsage();

    res.status(isDegraded ? 503 : 200).json({
      status: isDegraded ? 'degraded' : 'ok',
      service: 'tuitiondesk-whatsapp',
      persistence: {
        mode: activeProvider.persistenceMode,
        status: activeProvider.persistenceStatus,
        durable: activeProvider.isDurable,
      },
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Authenticate all subsequent routes with x-internal-secret
  app.use(authenticateInternalSecret);

  /**
   * Global status and diagnostics endpoint
   */
  app.get('/status', async (req, res) => {
    try {
      const stats = await activeProvider.getGlobalStats();
      res.json({
        success: true,
        service: 'WhatsApp Multi-Tenant Automation Microservice',
        uptimeSeconds: stats.uptimeSeconds,
        memory: stats.memory,
        counts: {
          totalTrackedSessions: stats.activeSessions,
          activeClientProcesses: stats.activeClientProcesses,
          readySessions: stats.readySessions,
          activeLocks: stats.activeLocks,
          savedSessions: stats.savedSessions,
          isMongoConnected: stats.isMongoConnected,
        },
        persistence: stats.persistence,
        sessions: stats.sessions,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /status/:centerId
   * Returns the specific status and QR code for that center.
   */
  app.get('/status/:centerId', async (req, res) => {
    const cleanCenterId = String(req.params.centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      return res.status(400).json({ success: false, error: 'centerId is required' });
    }

    try {
      const statusObj = await activeProvider.getStatus(cleanCenterId);
      return res.json({
        success: true,
        centerId: statusObj.centerId,
        status: statusObj.status,
        hasSavedSession: statusObj.hasSavedSession,
        qr: statusObj.qr,
        qrGeneratedAt: statusObj.qrGeneratedAt || null,
        ready: statusObj.ready,
        ...(statusObj.hasClientProcess !== undefined ? { hasClientProcess: statusObj.hasClientProcess } : {}),
        service: 'WhatsApp Multi-Tenant Automation Microservice',
        ...(statusObj.engine ? { engine: statusObj.engine } : {}),
        ...(statusObj.persistence ? { persistence: statusObj.persistence } : {}),
        ...(statusObj.updatedAt ? { updatedAt: statusObj.updatedAt } : {}),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const statusCode = err instanceof ProviderError ? err.statusCode : 500;
      return res.status(statusCode).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /init/:centerId
   * Idempotently initializes or returns active QR for this center.
   */
  app.post('/init/:centerId', async (req, res) => {
    const cleanCenterId = String(req.params.centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      return res.status(400).json({ success: false, error: 'centerId is required' });
    }

    try {
      const session = await activeProvider.initializeSession(cleanCenterId);
      return res.json({
        success: true,
        centerId: cleanCenterId,
        status: session.status,
        qr: session.qr,
        qrGeneratedAt: session.qrGeneratedAt || null,
        ready: session.ready,
        message: `WhatsApp client initialized for center: ${cleanCenterId}`,
      });
    } catch (err) {
      const statusCode = err instanceof ProviderError ? err.statusCode : 500;
      return res.status(statusCode).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to initialize client',
      });
    }
  });

  /**
   * POST /reconnect/:centerId
   * Refreshes an unlinked session or executes an explicit new-pairing flow.
   */
  app.post('/reconnect/:centerId', async (req, res) => {
    const cleanCenterId = String(req.params.centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      return res.status(400).json({ success: false, error: 'centerId is required' });
    }

    try {
      const session = await activeProvider.reconnectSession(cleanCenterId, req.body);
      return res.json({
        success: true,
        centerId: cleanCenterId,
        status: session.status,
        qr: session.qr,
        qrGeneratedAt: session.qrGeneratedAt || null,
        ready: session.ready,
        message: `Fresh QR generation initiated for center: ${cleanCenterId}`,
      });
    } catch (err) {
      const statusCode = err instanceof ProviderError ? err.statusCode : 500;
      return res.status(statusCode).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to reconnect WhatsApp client',
      });
    }
  });

  /**
   * POST /send-message
   * Body: { centerId: string, phone: string, message: string }
   */
  app.post('/send-message', async (req, res) => {
    try {
      const result = await activeProvider.sendMessage(req.body || {});
      return res.json(result);
    } catch (err) {
      const statusCode = err instanceof ProviderError ? err.statusCode : 500;
      return res.status(statusCode).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to send WhatsApp message.',
        ...(err.statusCode === 503 && req.body?.centerId ? { centerId: req.body.centerId, status: 'disconnected' } : {}),
      });
    }
  });

  /**
   * POST /logout/:centerId
   * Calls client.logout() and clears session from persistence.
   */
  app.post('/logout/:centerId', async (req, res) => {
    const cleanCenterId = String(req.params.centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      return res.status(400).json({ success: false, error: 'centerId is required' });
    }

    try {
      const result = await activeProvider.logoutSession(cleanCenterId);
      return res.json({
        success: true,
        centerId: cleanCenterId,
        message: result.message,
      });
    } catch (err) {
      const statusCode = err instanceof ProviderError ? err.statusCode : 500;
      return res.status(statusCode).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to logout session',
      });
    }
  });

  return app;
}

const app = createApp(provider);

let server = null;
if (require.main === module) {
  if (typeof provider.init === 'function') {
    provider.init().catch((err) => {
      console.error('❌ Failed to initialize WhatsApp provider on startup:', err.message);
    });
  }

  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Multi-Tenant WhatsApp Microservice listening on http://${HOST}:${PORT}`);
  });
}

// Graceful shutdown handling
let isShuttingDown = false;
async function handleGracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown of WhatsApp Microservice...`);

  if (server) {
    server.close(() => {
      console.log('🔒 HTTP server closed to new connections.');
    });
  }

  await provider.shutdown();
  console.log('👋 Graceful shutdown complete. Exiting process.');
  process.exit(0);
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection in WhatsApp Server:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception in WhatsApp Server:', err);
});

module.exports = app;
module.exports.provider = provider;
module.exports.createProvider = createProvider;
module.exports.createApp = createApp;
module.exports.handleGracefulShutdown = handleGracefulShutdown;
