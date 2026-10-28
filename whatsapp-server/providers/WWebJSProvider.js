'use strict';

const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client, RemoteAuth, LocalAuth } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const IWhatsAppProvider = require('./IWhatsAppProvider');
const MongoStore = require('../mongoStore');
const { migrateLocalSessionToRemote } = require('../sessionMigration');
const {
  ValidationError,
  NotRegisteredError,
  ConflictError,
  ConnectedRefusalError,
  ServiceUnavailableError,
  ProviderError,
} = require('./ProviderErrors');

const CHROME_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe')
    : null,
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function getExecutablePath() {
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH &&
    process.env.PUPPETEER_EXECUTABLE_PATH.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  const linuxChromium = '/usr/bin/chromium';
  if (fs.existsSync(linuxChromium)) return linuxChromium;

  for (const p of CHROME_PATHS) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

function formatWhatsAppId(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/\D/g, '');

  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    // already starts with 91
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = '91' + cleaned.substring(1);
  }

  return `${cleaned}@c.us`;
}

class WWebJSProvider extends IWhatsAppProvider {
  constructor({ mongodbUri, backupSyncIntervalMs = 900000 } = {}) {
    super();
    this.mongodbUri = mongodbUri || process.env.MONGODB_URI;
    // Operational balance: 15 minutes bounds staleness while preventing high-frequency zip compression spikes
    this.backupSyncIntervalMs = backupSyncIntervalMs;
    this.mongoStore = null;
    this.isMongoConnected = false;
    this.mongoInitPromise = null;

    this.sessions = new Map();
    this.activeLocks = new Set();
    this.inFlightInitPromises = new Map();
    this.savedSessionCenters = new Set();
    this.chromePath = getExecutablePath();
  }

  get name() {
    return 'wwebjs_remoteauth';
  }

  get mongoUri() {
    return this.mongodbUri;
  }

  get isDurable() {
    return Boolean(this.isMongoConnected);
  }

  get persistenceMode() {
    return this.isMongoConnected ? 'mongodb_remote' : 'ephemeral_local';
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
   * Initialize MongoDB connection and discover saved remote sessions without launching Chromium
   */
  async init() {
    if (!this.mongodbUri || !this.mongodbUri.trim()) {
      console.warn(
        '⚠️ [WWebJSProvider] MONGODB_URI not provided. Sessions will use ephemeral LocalAuth.'
      );
      this.scanLocalDiskSessions();
      return;
    }

    try {
      console.log('🔌 [WWebJSProvider] Connecting to MongoDB for session persistence...');
      this.mongoInitPromise = mongoose.connect(this.mongodbUri.trim(), {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        maxPoolSize: 5,
      });

      await this.mongoInitPromise;
      this.isMongoConnected = true;
      this.mongoStore = new MongoStore({
        mongooseInstance: mongoose,
        dataPath: './.wwebjs_auth',
      });
      console.log('✅ [WWebJSProvider] MongoDB connected successfully for RemoteAuth.');

      mongoose.connection.on('disconnected', () => {
        this.isMongoConnected = false;
        console.warn('⚠️ [WWebJSProvider] MongoDB disconnected. RemoteAuth temporarily degraded.');
      });

      mongoose.connection.on('reconnected', () => {
        this.isMongoConnected = true;
        console.log('✅ [WWebJSProvider] MongoDB reconnected.');
      });

      // Fast O(1) discovery of remote centers without launching Chromium
      const savedRemoteCenters = await this.mongoStore.listSavedCenterIds();
      for (const id of savedRemoteCenters) {
        this.savedSessionCenters.add(id);
        console.log(
          `📁 [WWebJSProvider] Discovered saved remote session for center: ${id} (lazy on-demand ready)`
        );
      }
    } catch (err) {
      this.isMongoConnected = false;
      this.mongoStore = null;
      console.error('❌ [WWebJSProvider] Failed to connect to MongoDB:', err.message);
      console.warn('⚠️ [WWebJSProvider] Falling back to ephemeral LocalAuth.');
    }

    this.scanLocalDiskSessions();
  }

  scanLocalDiskSessions() {
    try {
      const authRoot = path.join(__dirname, '..', '.wwebjs_auth');
      if (fs.existsSync(authRoot)) {
        const entries = fs.readdirSync(authRoot, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isDirectory()) {
            let id = null;
            if (ent.name.startsWith('RemoteAuth-')) {
              id = ent.name.replace('RemoteAuth-', '').trim().toLowerCase();
            } else if (ent.name.startsWith('session-')) {
              id = ent.name.replace('session-', '').trim().toLowerCase();
            }
            if (id) {
              this.savedSessionCenters.add(id);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  async destroyClientSafely(client, centerId) {
    if (!client) return;
    try {
      if (client.authStrategy && typeof client.authStrategy.destroy === 'function') {
        try {
          await client.authStrategy.destroy();
        } catch {}
      }

      if (typeof client.removeAllListeners === 'function') {
        client.removeAllListeners();
      }

      const browser = client.pupBrowser;
      const proc = browser?.process ? browser.process() : null;

      const closePromise = (async () => {
        try {
          if (browser?.isConnected?.()) {
            await browser.close();
          } else if (typeof client.destroy === 'function') {
            await client.destroy();
          }
        } catch {}
      })();

      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3000));
      await Promise.race([closePromise, timeoutPromise]);

      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL');
          console.log(`[WWebJSProvider] [Center: ${centerId}] Sent SIGKILL to browser (PID: ${proc.pid})`);
        } catch {}
      }
    } catch (err) {
      console.warn(`[WWebJSProvider] [Center: ${centerId}] Exception destroying client:`, err?.message || err);
    }
  }

  async getStatus(centerId) {
    const cleanCenterId = String(centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      throw new ValidationError('centerId is required');
    }

    if (this.mongoInitPromise) {
      try {
        await this.mongoInitPromise;
      } catch {}
    }

    let hasSavedSession = this.savedSessionCenters.has(cleanCenterId);
    if (!hasSavedSession && this.mongoStore && this.isMongoConnected) {
      try {
        hasSavedSession = await this.mongoStore.sessionExists({
          session: `RemoteAuth-${cleanCenterId}`,
        });
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
      hasClientProcess: Boolean(session.client),
      error: session.error || null,
      updatedAt: session.updatedAt,
    };
  }

  async getGlobalStats() {
    const mem = process.memoryUsage();
    let activeClientsCount = 0;
    let readySessionsCount = 0;

    const sessionSummaries = [];
    for (const [id, s] of this.sessions.entries()) {
      if (s.client) activeClientsCount++;
      if (s.isReady) readySessionsCount++;
      sessionSummaries.push({
        centerId: id,
        status: s.status,
        ready: s.isReady,
        hasQR: Boolean(s.qr),
        hasClientProcess: Boolean(s.client),
        updatedAt: s.updatedAt,
      });
    }

    return {
      engine: this.name,
      activeSessions: this.sessions.size,
      readySessions: readySessionsCount,
      savedSessions: this.savedSessionCenters.size,
      activeClientProcesses: activeClientsCount,
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

  async initializeSession(centerId) {
    const cleanCenterId = String(centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      throw new ValidationError('centerId is required');
    }

    // Return active or initializing session idempotently
    if (this.sessions.has(cleanCenterId)) {
      const existing = this.sessions.get(cleanCenterId);
      if (
        existing.status === 'connected' ||
        existing.status === 'qr_ready' ||
        existing.status === 'initializing' ||
        existing.status === 'authenticated'
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

    // Deduplicate in-flight concurrent initialization requests
    if (this.inFlightInitPromises.has(cleanCenterId)) {
      const session = await this.inFlightInitPromises.get(cleanCenterId);
      return {
        centerId: cleanCenterId,
        status: session.status,
        qr: session.qr,
        qrGeneratedAt: session.qrGeneratedAt || null,
        ready: session.isReady,
        hasSavedSession: this.savedSessionCenters.has(cleanCenterId),
      };
    }

    if (this.activeLocks.has(cleanCenterId)) {
      throw new ConflictError();
    }

    this.activeLocks.add(cleanCenterId);
    const initPromise = (async () => {
      try {
        return await this.spawnClient(cleanCenterId);
      } finally {
        this.activeLocks.delete(cleanCenterId);
        this.inFlightInitPromises.delete(cleanCenterId);
      }
    })();

    this.inFlightInitPromises.set(cleanCenterId, initPromise);

    const session = await initPromise;
    return {
      centerId: cleanCenterId,
      status: session.status,
      qr: session.qr,
      qrGeneratedAt: session.qrGeneratedAt || null,
      ready: session.isReady,
      hasSavedSession: this.savedSessionCenters.has(cleanCenterId),
    };
  }

  async spawnClient(cleanCenterId) {
    if (this.sessions.has(cleanCenterId)) {
      const existing = this.sessions.get(cleanCenterId);
      if (existing.client) {
        await this.destroyClientSafely(existing.client, cleanCenterId);
        existing.client = null;
      }
    }

    if (this.mongoInitPromise) {
      try {
        await this.mongoInitPromise;
      } catch {}
    }

    if (this.mongodbUri && this.mongodbUri.trim() && !this.isMongoConnected) {
      throw new ServiceUnavailableError(
        'Persistent session storage (MongoDB) is configured but currently unavailable. Halting client launch to protect session state.'
      );
    }

    if (this.savedSessionCenters.has(cleanCenterId) && !this.isMongoConnected) {
      throw new ServiceUnavailableError(
        `Center '${cleanCenterId}' has a saved session, but persistent storage (MongoDB) is unavailable. Halting Chromium launch to prevent session overwrite.`
      );
    }

    const resolvedExecutable = getExecutablePath() || this.chromePath;

    // Single active client guard: on 512MB RAM tier, tear down any other running browser
    for (const [id, s] of this.sessions.entries()) {
      if (id !== cleanCenterId && s.client) {
        console.warn(
          `⚠️ [WWebJSProvider] Active client exists for center '${id}'. Tearing down idle browser to keep memory under 512MB.`
        );
        await this.destroyClientSafely(s.client, id);
        s.client = null;
        s.status = 'disconnected';
        s.isReady = false;
        s.qr = null;
      }
    }

    let authStrategy;
    if (this.mongoStore && this.isMongoConnected) {
      try {
        await migrateLocalSessionToRemote({
          centerId: cleanCenterId,
          store: this.mongoStore,
          dataPath: './.wwebjs_auth',
        });
      } catch (migErr) {
        console.warn(`[WWebJSProvider] [Center: ${cleanCenterId}] LocalAuth migration notice:`, migErr.message);
      }

      authStrategy = new RemoteAuth({
        clientId: cleanCenterId,
        store: this.mongoStore,
        backupSyncIntervalMs: this.backupSyncIntervalMs,
        dataPath: './.wwebjs_auth',
      });
    } else {
      authStrategy = new LocalAuth({
        clientId: cleanCenterId,
        dataPath: './.wwebjs_auth',
      });
    }

    const client = new Client({
      authStrategy,
      puppeteer: {
        headless: true,
        executablePath: resolvedExecutable || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-component-extensions-with-background-pages',
          '--mute-audio',
          '--no-default-browser-check',
          '--disable-breakpad',
          '--disable-component-update',
          '--renderer-process-limit=1',
          '--enable-low-end-device-mode',
          '--js-flags=--max-old-space-size=128',
          '--disable-site-isolation-trials',
          '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints,AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
        ],
      },
    });

    const sessionObj = {
      centerId: cleanCenterId,
      client,
      status: 'initializing',
      qr: null,
      qrGeneratedAt: null,
      isReady: false,
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(cleanCenterId, sessionObj);

    client.on('qr', (qr) => {
      sessionObj.qr = qr;
      sessionObj.qrGeneratedAt = Date.now();
      sessionObj.status = 'qr_ready';
      sessionObj.isReady = false;
      sessionObj.updatedAt = new Date().toISOString();
      qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
      sessionObj.status = 'authenticated';
      sessionObj.qr = null;
      sessionObj.qrGeneratedAt = null;
      sessionObj.isReady = false;
      sessionObj.updatedAt = new Date().toISOString();
    });

    client.on('ready', () => {
      sessionObj.status = 'connected';
      sessionObj.isReady = true;
      sessionObj.qr = null;
      sessionObj.qrGeneratedAt = null;
      sessionObj.error = null;
      sessionObj.updatedAt = new Date().toISOString();
      console.log(`✅ [WWebJSProvider] [Center: ${cleanCenterId}] WhatsApp Client is Ready!`);
    });

    client.on('remote_session_saved', () => {
      this.savedSessionCenters.add(cleanCenterId);
      console.log(`💾 [WWebJSProvider] [Center: ${cleanCenterId}] Session backed up to MongoDB.`);
    });

    client.on('auth_failure', async (msg) => {
      sessionObj.status = 'disconnected';
      sessionObj.isReady = false;
      sessionObj.qr = null;
      sessionObj.qrGeneratedAt = null;
      sessionObj.error = msg;
      sessionObj.updatedAt = new Date().toISOString();
      await this.destroyClientSafely(client, cleanCenterId);
      sessionObj.client = null;
    });

    client.on('disconnected', async () => {
      sessionObj.status = 'disconnected';
      sessionObj.isReady = false;
      sessionObj.qr = null;
      sessionObj.qrGeneratedAt = null;
      sessionObj.updatedAt = new Date().toISOString();
      await this.destroyClientSafely(client, cleanCenterId);
      sessionObj.client = null;
    });

    client.initialize().catch(async (err) => {
      sessionObj.status = 'disconnected';
      sessionObj.isReady = false;
      sessionObj.error = err instanceof Error ? err.message : String(err);
      sessionObj.updatedAt = new Date().toISOString();
      await this.destroyClientSafely(client, cleanCenterId);
      sessionObj.client = null;
    });

    return sessionObj;
  }

  async reconnectSession(centerId, options = {}) {
    const cleanCenterId = String(centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      throw new ValidationError('centerId is required');
    }

    if (this.activeLocks.has(cleanCenterId) || this.inFlightInitPromises.has(cleanCenterId)) {
      throw new ConflictError();
    }

    const existing = this.sessions.get(cleanCenterId);
    if (existing && (existing.status === 'connected' || existing.isReady === true)) {
      throw new ConnectedRefusalError();
    }

    if (existing && (existing.status === 'initializing' || existing.status === 'authenticated')) {
      throw new ConflictError('WhatsApp client is currently initializing for this center. Please wait a moment.');
    }

    this.activeLocks.add(cleanCenterId);

    try {
      if (existing && existing.client) {
        await this.destroyClientSafely(existing.client, cleanCenterId);
        existing.client = null;
      }

      this.sessions.delete(cleanCenterId);

      const isExplicitNewPairing =
        options?.action === 'new_pairing' || Boolean(options?.forceNewPairing);

      if (isExplicitNewPairing) {
        if (this.mongoStore && this.isMongoConnected) {
          try {
            await this.mongoStore.delete({ session: `RemoteAuth-${cleanCenterId}` });
            this.savedSessionCenters.delete(cleanCenterId);
            console.log(`🗑️ [WWebJSProvider] Cleared remote session in MongoDB for: ${cleanCenterId}`);
          } catch (delErr) {
            throw new ProviderError(
              `Failed to clear previous saved session during new pairing: ${delErr.message}`,
              500
            );
          }
        }

        try {
          const localRemoteDir = path.join(__dirname, '..', '.wwebjs_auth', `RemoteAuth-${cleanCenterId}`);
          if (fs.existsSync(localRemoteDir)) {
            fs.rmSync(localRemoteDir, { recursive: true, force: true });
          }
        } catch {}
      }

      const newSession = await this.spawnClient(cleanCenterId);

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

  async sendMessage({ centerId, phone, message }) {
    if (!phone || !message) {
      throw new ValidationError("Both 'phone' and 'message' are required.");
    }

    let targetCenterId = centerId ? String(centerId).trim().toLowerCase() : null;
    if (!targetCenterId && this.sessions.size === 1) {
      targetCenterId = Array.from(this.sessions.keys())[0];
    }

    if (!targetCenterId) {
      throw new ValidationError('centerId is required in request body to route message to correct WhatsApp session.');
    }

    const session = this.sessions.get(targetCenterId);
    if (!session || !session.isReady || !session.client) {
      throw new ServiceUnavailableError(
        `WhatsApp Client for center '${targetCenterId}' is not ready. Please scan the QR code in Settings.`
      );
    }

    const formattedPhone = formatWhatsAppId(phone);
    if (!formattedPhone) {
      throw new ValidationError('Invalid phone number format.');
    }

    try {
      const isRegistered = await session.client.isRegisteredUser(formattedPhone);
      if (!isRegistered) {
        throw new NotRegisteredError();
      }
    } catch (regErr) {
      if (regErr instanceof NotRegisteredError) throw regErr;
      console.warn(`[WWebJSProvider] Registration check warning for ${formattedPhone}:`, regErr.message);
    }

    let response;
    try {
      response = await session.client.sendMessage(formattedPhone, message);
    } catch (sendErr) {
      throw new ProviderError(sendErr instanceof Error ? sendErr.message : 'Failed to send WhatsApp message.', 500);
    }

    return {
      success: true,
      centerId: targetCenterId,
      messageId: response?.id?._serialized || response?.id || 'sent',
      recipient: formattedPhone,
      timestamp: new Date().toISOString(),
    };
  }

  async logoutSession(centerId) {
    const cleanCenterId = String(centerId || '').trim().toLowerCase();
    if (!cleanCenterId) {
      throw new ValidationError('centerId is required');
    }

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

      if (session.client) {
        try {
          await session.client.logout().catch(() => {});
        } catch {}
        await this.destroyClientSafely(session.client, cleanCenterId);
        session.client = null;
      }

      this.sessions.delete(cleanCenterId);
      this.savedSessionCenters.delete(cleanCenterId);

      if (this.mongoStore && this.isMongoConnected) {
        try {
          await this.mongoStore.delete({ session: `RemoteAuth-${cleanCenterId}` });
        } catch (dbErr) {
          console.warn(`[WWebJSProvider] Warning deleting remote session for ${cleanCenterId}:`, dbErr.message);
        }
      }

      try {
        const dirsToClean = [
          path.join(__dirname, '..', '.wwebjs_auth', `RemoteAuth-${cleanCenterId}`),
          path.join(__dirname, '..', '.wwebjs_auth', `session-${cleanCenterId}`),
        ];
        for (const d of dirsToClean) {
          if (fs.existsSync(d)) {
            fs.rmSync(d, { recursive: true, force: true });
          }
        }
      } catch {}

      return {
        success: true,
        message: `WhatsApp session disconnected for center: ${cleanCenterId}. Ready for fresh pairing.`,
      };
    } finally {
      this.activeLocks.delete(cleanCenterId);
    }
  }

  async shutdown() {
    const destroyPromises = [];
    for (const [id, s] of this.sessions.entries()) {
      if (s.client) {
        destroyPromises.push(this.destroyClientSafely(s.client, id));
      }
    }
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      destroyPromises.push(mongoose.connection.close().catch(() => {}));
    }
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([Promise.allSettled(destroyPromises), timeoutPromise]);
  }
}

module.exports = WWebJSProvider;
module.exports.formatWhatsAppId = formatWhatsAppId;
