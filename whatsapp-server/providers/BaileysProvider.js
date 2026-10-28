'use strict';

const mongoose = require('mongoose');
const pino = require('pino');
const IWhatsAppProvider = require('./IWhatsAppProvider');
const { BaileysMongoAuthStore, validateCenterId } = require('../baileysStore');
const {
  ValidationError,
  NotRegisteredError,
  ConflictError,
  ConnectedRefusalError,
  ServiceUnavailableError,
  ProviderError,
} = require('./ProviderErrors');

// Module-level cache for dynamic @whiskeysockets/baileys import
let cachedBaileysModule = null;

async function getBaileys(customBaileys) {
  if (customBaileys) return customBaileys;
  if (!cachedBaileysModule) {
    cachedBaileysModule = await import('@whiskeysockets/baileys');
  }
  return cachedBaileysModule;
}

/**
 * Normalizes phone number into standard WhatsApp JID for Baileys (e.g. 919876543210@s.whatsapp.net).
 * @param {string|number} phone
 * @returns {string|null}
 */
function formatBaileysJid(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/\D/g, '');

  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    // already starts with 91
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = '91' + cleaned.substring(1);
  }

  if (cleaned.length < 10) return null;
  return `${cleaned}@s.whatsapp.net`;
}

/**
 * BaileysProvider: Direct WebSocket implementation of IWhatsAppProvider using @whiskeysockets/baileys.
 *
 * Replaces Chromium / Puppeteer with lightweight native WebSockets (~30MB RAM footprint).
 * Sessions and Signal keys persist directly into MongoDB via BaileysMongoAuthStore.
 */
class BaileysProvider extends IWhatsAppProvider {
  /**
   * @param {Object} [options]
   * @param {string} [options.mongodbUri]
   * @param {Object} [options.mongooseInstance]
   * @param {string} [options.collectionName]
   * @param {Function} [options.makeSocketFn] - Dependency injection for testing
   * @param {Object} [options.baileysInstance] - Dependency injection for testing
   * @param {Object} [options.pinoLogger] - Custom logger (defaults to silent pino)
   * @param {number} [options.maxReconnectAttempts=5]
   */
  constructor(options = {}) {
    super();
    this.mongodbUri = options.mongodbUri || process.env.MONGODB_URI;
    this.mongoose = options.mongooseInstance || mongoose;
    this.collectionName = options.collectionName || 'baileys_auth';
    this.makeSocketFn = options.makeSocketFn || null;
    this.customBaileys = options.baileysInstance || null;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;

    // Silent pino logger to prevent logging raw frames, tokens, or QR strings
    this.logger = options.pinoLogger || pino({ level: 'silent' });

    this.authStore = new BaileysMongoAuthStore({
      mongooseInstance: this.mongoose,
      collectionName: this.collectionName,
      baileysInstance: this.customBaileys,
    });

    this.sessions = new Map(); // centerId -> sessionState
    this.activeLocks = new Set();
    this.inFlightInitPromises = new Map();
    this.savedSessionCenters = new Set();
    this.mongoInitPromise = null;
  }

  get name() {
    return 'baileys_native';
  }

  get mongoUri() {
    return this.mongodbUri;
  }

  get isMongoConnected() {
    return Boolean(this.mongoose?.connection?.readyState === 1 && this.mongoose?.connection?.db);
  }

  get isDurable() {
    return Boolean(this.isMongoConnected);
  }

  get persistenceMode() {
    return this.isMongoConnected ? 'mongodb_native' : 'ephemeral_local';
  }

  get persistenceStatus() {
    const isConfigured = Boolean(this.mongodbUri && this.mongodbUri.trim());
    return this.isMongoConnected
      ? 'connected'
      : isConfigured
      ? 'connecting_or_disconnected'
      : 'unconfigured_ephemeral';
  }

  /**
   * Initialize MongoDB connection and discover saved remote sessions without socket connections.
   */
  async init() {
    if (this.mongodbUri && this.mongodbUri.trim() && !this.isMongoConnected) {
      try {
        this.mongoInitPromise = this.mongoose.connect(this.mongodbUri.trim(), {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 10000,
          maxPoolSize: 5,
        });
        await this.mongoInitPromise;
      } catch (err) {
        console.error('❌ [BaileysProvider] Failed to connect to MongoDB:', err.message);
      }
    }

    if (this.isMongoConnected) {
      try {
        const savedCenters = await this.authStore.listSavedSessions();
        for (const id of savedCenters) {
          this.savedSessionCenters.add(id);
        }
      } catch (err) {
        console.warn('⚠️ [BaileysProvider] Could not list saved sessions during init:', err.message);
      }
    }
  }

  /**
   * Destroys an existing socket and clears timers/listeners safely.
   * @param {Object} sessionObj
   */
  async destroySocketSafely(sessionObj) {
    if (!sessionObj) return;

    if (sessionObj.reconnectTimer) {
      clearTimeout(sessionObj.reconnectTimer);
      sessionObj.reconnectTimer = null;
    }

    const sock = sessionObj.sock;
    if (sock) {
      try {
        if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
          sock.ev.removeAllListeners();
        }
      } catch {}

      try {
        if (typeof sock.end === 'function') {
          sock.end(undefined);
        } else if (sock.ws && typeof sock.ws.close === 'function') {
          sock.ws.close();
        }
      } catch {}

      sessionObj.sock = null;
    }
  }

  /**
   * Retrieve normalized status for a specific center.
   * @param {string} centerId
   * @returns {Promise<NormalizedSessionState>}
   */
  async getStatus(centerId) {
    const cleanCenterId = validateCenterId(centerId).toLowerCase();

    if (this.mongoInitPromise) {
      try {
        await this.mongoInitPromise;
      } catch {}
    }

    let hasSavedSession = this.savedSessionCenters.has(cleanCenterId);
    if (!hasSavedSession && this.isMongoConnected) {
      try {
        hasSavedSession = await this.authStore.sessionExists(cleanCenterId);
        if (hasSavedSession) {
          this.savedSessionCenters.add(cleanCenterId);
        }
      } catch {}
    }

    const session = this.sessions.get(cleanCenterId);
    if (!session) {
      return {
        centerId: cleanCenterId,
        status: 'disconnected',
        hasSavedSession,
        qr: null,
        qrGeneratedAt: null,
        ready: false,
      };
    }

    return {
      centerId: cleanCenterId,
      status: session.status,
      hasSavedSession,
      qr: session.qr,
      qrGeneratedAt: session.qrGeneratedAt || null,
      ready: session.isReady,
      hasClientProcess: Boolean(session.sock),
      error: session.error || null,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Retrieve global runtime statistics and session summaries.
   * @returns {Promise<GlobalProviderStats>}
   */
  async getGlobalStats() {
    const mem = process.memoryUsage();
    let activeSocketsCount = 0;
    let readySessionsCount = 0;

    const sessionSummaries = [];
    for (const [id, s] of this.sessions.entries()) {
      if (s.sock) activeSocketsCount++;
      if (s.isReady) readySessionsCount++;
      sessionSummaries.push({
        centerId: id,
        status: s.status,
        ready: s.isReady,
        hasQR: Boolean(s.qr),
        hasClientProcess: Boolean(s.sock),
        updatedAt: s.updatedAt,
      });
    }

    return {
      engine: this.name,
      activeSessions: this.sessions.size,
      readySessions: readySessionsCount,
      savedSessions: this.savedSessionCenters.size,
      activeClientProcesses: activeSocketsCount,
      activeLocks: this.activeLocks.size,
      isMongoConnected: this.isMongoConnected,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        externalMb: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      },
      persistence: {
        mode: this.persistenceMode,
        status: this.isMongoConnected
          ? 'connected'
          : this.mongodbUri && this.mongodbUri.trim()
          ? 'error_disconnected'
          : 'unconfigured_ephemeral',
        durable: this.isDurable,
      },
      sessions: sessionSummaries,
    };
  }

  /**
   * Internal worker to spawn or recreate a single Baileys socket for a center.
   * @private
   */
  async _spawnSocket(centerId) {
    const cleanCenterId = validateCenterId(centerId).toLowerCase();

    let sessionObj = this.sessions.get(cleanCenterId);
    if (!sessionObj) {
      sessionObj = {
        centerId: cleanCenterId,
        sock: null,
        status: 'initializing',
        isReady: false,
        qr: null,
        qrGeneratedAt: null,
        error: null,
        updatedAt: new Date().toISOString(),
        authState: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        generation: 0,
      };
      this.sessions.set(cleanCenterId, sessionObj);
    }

    // Safely tear down previous socket if present
    await this.destroySocketSafely(sessionObj);

    // Increment generation token so stale socket callbacks are rejected
    const currentGen = ++sessionObj.generation;

    sessionObj.status = 'initializing';
    sessionObj.isReady = false;
    sessionObj.qr = null;
    sessionObj.qrGeneratedAt = null;
    sessionObj.error = null;
    sessionObj.updatedAt = new Date().toISOString();

    const baileys = await getBaileys(this.customBaileys);
    const { DisconnectReason } = baileys;
    const makeSocket = this.makeSocketFn || baileys.makeWASocket || baileys.default;

    if (typeof makeSocket !== 'function') {
      throw new Error('Baileys makeWASocket factory not available.');
    }

    // Load or initialize MongoDB auth state for this center
    const authState = await this.authStore.useAuthState(cleanCenterId);
    sessionObj.authState = authState;

    const sock = makeSocket({
      auth: authState.state,
      logger: this.logger,
      printQRInTerminal: false,
    });

    sessionObj.sock = sock;

    // 1. Credentials update handler
    sock.ev.on('creds.update', async () => {
      if (sessionObj.generation !== currentGen) return;
      try {
        await authState.saveCreds();
        this.savedSessionCenters.add(cleanCenterId);
      } catch (err) {
        console.warn(`[BaileysProvider] [Center: ${cleanCenterId}] Error persisting credentials:`, err.message);
      }
    });

    // 2. Connection update handler
    sock.ev.on('connection.update', async (update) => {
      if (sessionObj.generation !== currentGen) return;

      const { connection, lastDisconnect, qr } = update;

      // Handle QR code generation
      if (qr) {
        sessionObj.qr = qr;
        sessionObj.qrGeneratedAt = Date.now();
        sessionObj.status = 'qr_ready';
        sessionObj.isReady = false;
        sessionObj.updatedAt = new Date().toISOString();
      }

      // Handle open / connected state
      if (connection === 'open') {
        sessionObj.status = 'connected';
        sessionObj.isReady = true;
        sessionObj.qr = null;
        sessionObj.qrGeneratedAt = null;
        sessionObj.error = null;
        sessionObj.reconnectAttempts = 0;
        sessionObj.updatedAt = new Date().toISOString();
        this.savedSessionCenters.add(cleanCenterId);
      }

      // Handle connection close / disconnect
      if (connection === 'close') {
        sessionObj.isReady = false;
        sessionObj.qr = null;
        sessionObj.qrGeneratedAt = null;
        sessionObj.updatedAt = new Date().toISOString();

        const error = lastDisconnect?.error;
        const statusCode =
          error?.output?.statusCode || error?.status || error?.statusCode;

        const isLoggedOut =
          statusCode === DisconnectReason?.loggedOut || statusCode === 401;

        if (isLoggedOut) {
          sessionObj.status = 'disconnected';
          sessionObj.error = 'WhatsApp session logged out from device';
          await this.destroySocketSafely(sessionObj);
          try {
            await authState.clearAuth();
            this.savedSessionCenters.delete(cleanCenterId);
          } catch {}
        } else {
          sessionObj.status = 'disconnected';
          sessionObj.error = error?.message || 'Connection closed';

          // Auto-reconnect with exponential backoff if not logged out
          if (sessionObj.reconnectAttempts < this.maxReconnectAttempts) {
            sessionObj.reconnectAttempts++;
            const backoffMs = Math.min(1000 * Math.pow(2, sessionObj.reconnectAttempts - 1), 10000);

            sessionObj.reconnectTimer = setTimeout(() => {
              if (sessionObj.generation === currentGen) {
                this._spawnSocket(cleanCenterId).catch(() => {});
              }
            }, backoffMs);
          } else {
            await this.destroySocketSafely(sessionObj);
          }
        }
      }
    });

    return sessionObj;
  }

  /**
   * Initialize or resume a WhatsApp session for a specific center.
   * @param {string} centerId
   * @returns {Promise<NormalizedSessionState>}
   */
  async initializeSession(centerId) {
    const cleanCenterId = validateCenterId(centerId).toLowerCase();

    if (this.sessions.has(cleanCenterId)) {
      const existing = this.sessions.get(cleanCenterId);
      if (
        existing.status === 'connected' ||
        existing.status === 'qr_ready' ||
        existing.status === 'initializing'
      ) {
        return {
          centerId: cleanCenterId,
          status: existing.status,
          qr: existing.qr,
          qrGeneratedAt: existing.qrGeneratedAt || null,
          ready: existing.isReady,
          hasSavedSession: this.savedSessionCenters.has(cleanCenterId),
        };
      }
    }

    if (this.inFlightInitPromises.has(cleanCenterId)) {
      return this.inFlightInitPromises.get(cleanCenterId);
    }

    if (this.activeLocks.has(cleanCenterId)) {
      throw new ConflictError();
    }

    const initPromise = (async () => {
      try {
        const session = await this._spawnSocket(cleanCenterId);
        return {
          centerId: cleanCenterId,
          status: session.status,
          qr: session.qr,
          qrGeneratedAt: session.qrGeneratedAt || null,
          ready: session.isReady,
          hasSavedSession: this.savedSessionCenters.has(cleanCenterId),
        };
      } finally {
        this.inFlightInitPromises.delete(cleanCenterId);
      }
    })();

    this.inFlightInitPromises.set(cleanCenterId, initPromise);
    return initPromise;
  }

  /**
   * Reconnect an unlinked session or trigger a fresh pairing flow.
   * @param {string} centerId
   * @param {ReconnectOptions} [options]
   * @returns {Promise<NormalizedSessionState>}
   */
  async reconnectSession(centerId, options = {}) {
    const cleanCenterId = validateCenterId(centerId).toLowerCase();

    if (this.activeLocks.has(cleanCenterId) || this.inFlightInitPromises.has(cleanCenterId)) {
      throw new ConflictError();
    }

    const existing = this.sessions.get(cleanCenterId);
    if (existing && (existing.status === 'connected' || existing.isReady === true)) {
      throw new ConnectedRefusalError();
    }

    if (existing && existing.status === 'initializing') {
      throw new ConflictError('WhatsApp client is currently initializing for this center. Please wait a moment.');
    }

    this.activeLocks.add(cleanCenterId);

    try {
      if (existing) {
        await this.destroySocketSafely(existing);
        this.sessions.delete(cleanCenterId);
      }

      const isExplicitNewPairing =
        options?.action === 'new_pairing' || Boolean(options?.forceNewPairing);

      if (isExplicitNewPairing) {
        try {
          await this.authStore.clearAuth(cleanCenterId);
          this.savedSessionCenters.delete(cleanCenterId);
        } catch (delErr) {
          throw new ProviderError(
            `Failed to clear previous saved session during new pairing: ${delErr.message}`,
            500
          );
        }
      }

      const newSession = await this._spawnSocket(cleanCenterId);

      return {
        centerId: cleanCenterId,
        status: newSession.status,
        qr: newSession.qr,
        qrGeneratedAt: newSession.qrGeneratedAt || null,
        ready: newSession.isReady,
        hasSavedSession: this.savedSessionCenters.has(cleanCenterId),
      };
    } finally {
      this.activeLocks.delete(cleanCenterId);
    }
  }

  /**
   * Send an outbound text message for a center.
   * @param {SendMessageOptions} options
   * @returns {Promise<SendMessageResult>}
   */
  async sendMessage({ centerId, phone, message }) {
    if (!phone || !message) {
      throw new ValidationError("Both 'phone' and 'message' are required.");
    }

    let targetCenterId = centerId ? validateCenterId(centerId).toLowerCase() : null;
    if (!targetCenterId && this.sessions.size === 1) {
      targetCenterId = Array.from(this.sessions.keys())[0];
    }

    if (!targetCenterId) {
      throw new ValidationError('centerId is required in request body to route message to correct WhatsApp session.');
    }

    const session = this.sessions.get(targetCenterId);
    if (!session || !session.isReady || !session.sock) {
      throw new ServiceUnavailableError(
        `WhatsApp Client for center '${targetCenterId}' is not ready. Please scan the QR code in Settings.`
      );
    }

    const formattedJid = formatBaileysJid(phone);
    if (!formattedJid) {
      throw new ValidationError('Invalid phone number format.');
    }

    // Verify registration on WhatsApp if onWhatsApp is supported
    if (typeof session.sock.onWhatsApp === 'function') {
      try {
        const results = await session.sock.onWhatsApp(formattedJid);
        const registered = Array.isArray(results) && results.length > 0 && results[0]?.exists;
        if (!registered) {
          throw new NotRegisteredError();
        }
      } catch (err) {
        if (err instanceof NotRegisteredError) throw err;
        console.warn(`[BaileysProvider] Registration check notice for ${formattedJid}:`, err.message);
      }
    }

    let response;
    try {
      response = await session.sock.sendMessage(formattedJid, { text: message });
    } catch (sendErr) {
      throw new ProviderError(sendErr instanceof Error ? sendErr.message : 'Failed to send WhatsApp message.', 500);
    }

    return {
      success: true,
      centerId: targetCenterId,
      messageId: response?.key?.id || response?.id || 'sent',
      recipient: formattedJid,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Explicitly logout and clear all stored credentials for a center.
   * @param {string} centerId
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async logoutSession(centerId) {
    const cleanCenterId = validateCenterId(centerId).toLowerCase();

    if (this.activeLocks.has(cleanCenterId)) {
      throw new ConflictError();
    }

    this.activeLocks.add(cleanCenterId);

    try {
      const session = this.sessions.get(cleanCenterId);
      if (!session) {
        return {
          success: true,
          message: `No active session found for center: ${cleanCenterId}`,
        };
      }

      if (session.sock) {
        try {
          if (typeof session.sock.logout === 'function') {
            await session.sock.logout().catch(() => {});
          }
        } catch {}
        await this.destroySocketSafely(session);
      }

      this.sessions.delete(cleanCenterId);
      this.savedSessionCenters.delete(cleanCenterId);

      try {
        await this.authStore.clearAuth(cleanCenterId);
      } catch (dbErr) {
        console.warn(`[BaileysProvider] Warning clearing auth for ${cleanCenterId}:`, dbErr.message);
      }

      return {
        success: true,
        message: `WhatsApp session disconnected for center: ${cleanCenterId}. Ready for fresh pairing.`,
      };
    } finally {
      this.activeLocks.delete(cleanCenterId);
    }
  }

  /**
   * Shuts down all sockets, clears all timers and listeners.
   */
  async shutdown() {
    const destroyPromises = [];
    for (const [, s] of this.sessions.entries()) {
      destroyPromises.push(this.destroySocketSafely(s));
    }
    await Promise.allSettled(destroyPromises);
    this.sessions.clear();
  }
}

module.exports = BaileysProvider;
module.exports.formatBaileysJid = formatBaileysJid;
