const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const BaileysProvider = require('../providers/BaileysProvider');
const WWebJSProvider = require('../providers/WWebJSProvider');
const { createProvider } = require('../index');
const {
  ValidationError,
  ServiceUnavailableError,
} = require('../providers/ProviderErrors');

describe('TuitionDesk WhatsApp — Repair Batch 1 Regression Suite', () => {
  // Helper to create mock Baileys socket factory
  function createMockSocketFactory(onCreated) {
    return (options) => {
      const ev = new EventEmitter();
      const mockSock = {
        ev,
        ws: new EventEmitter(),
        end: () => {
          mockSock.closed = true;
        },
        closed: false,
        sendMessage: async (jid, content) => {
          return { key: { id: `BAILEYS_TEST_${Date.now()}`, remoteJid: jid } };
        },
      };
      if (onCreated) onCreated(mockSock);
      return mockSock;
    };
  }

  function createTestProvider(options = {}) {
    return new BaileysProvider({
      initWatchdogTimeoutMs: 200,
      mongooseInstance: { connection: { readyState: 0 } },
      ...options,
    });
  }

  /* ======================================================================
   * Fix 1: Engine Selection
   * ====================================================================== */
  describe('Fix 1: Engine Selection Defaults & Configuration', () => {
    it('1.1 Defaults strictly to BaileysProvider when WHATSAPP_ENGINE is unset or empty', () => {
      const orig = process.env.WHATSAPP_ENGINE;
      delete process.env.WHATSAPP_ENGINE;
      try {
        const providerUndef = createProvider(undefined);
        assert.ok(providerUndef instanceof BaileysProvider);
        assert.strictEqual(providerUndef.name, 'baileys_native');

        const providerEmpty = createProvider('');
        assert.ok(providerEmpty instanceof BaileysProvider);
        assert.strictEqual(providerEmpty.name, 'baileys_native');
      } finally {
        if (orig !== undefined) process.env.WHATSAPP_ENGINE = orig;
      }
    });

    it('1.2 Instantiates WWebJSProvider when WHATSAPP_ENGINE=wwebjs', () => {
      const provider = createProvider('wwebjs');
      assert.ok(provider instanceof WWebJSProvider);
      assert.strictEqual(provider.name, 'wwebjs_remoteauth');
    });

    it('1.3 Instantiates BaileysProvider when WHATSAPP_ENGINE=baileys', () => {
      const provider = createProvider('baileys');
      assert.ok(provider instanceof BaileysProvider);
      assert.strictEqual(provider.name, 'baileys_native');
    });
  });

  /* ======================================================================
   * Fix 2: Strict centerId Selection & Tenant Isolation
   * ====================================================================== */
  describe('Fix 2: Strict centerId Routing & Tenant Isolation', () => {
    it('2.1 Rejects with ValidationError when centerId is missing even with exactly 1 active session', async () => {
      let createdSocket = null;
      const makeSocketFn = createMockSocketFactory((sock) => {
        createdSocket = sock;
      });

      const provider = createTestProvider({ makeSocketFn });

      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: true }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      // Initialize exactly 1 active session
      await provider.initializeSession('center-sole');
      createdSocket.ev.emit('connection.update', { connection: 'open' });
      assert.strictEqual(provider.sessions.size, 1);

      // Attempt send with missing centerId
      await assert.rejects(
        async () => {
          await provider.sendMessage({
            phone: '9876543210',
            message: 'Strict centerId required',
          });
        },
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.message, /centerId is required/i);
          return true;
        }
      );

      // Attempt send with empty / whitespace centerId
      await assert.rejects(
        async () => {
          await provider.sendMessage({
            centerId: '   ',
            phone: '9876543210',
            message: 'Whitespace centerId',
          });
        },
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.message, /centerId is required/i);
          return true;
        }
      );

      await provider.shutdown();
    });

    it('2.2 Rejects with ServiceUnavailableError when centerId is unknown and has no saved session', async () => {
      const provider = createTestProvider({
        makeSocketFn: createMockSocketFactory(),
      });

      await assert.rejects(
        async () => {
          await provider.sendMessage({
            centerId: 'center-unknown',
            phone: '9876543210',
            message: 'Hello',
          });
        },
        (err) => {
          assert.ok(err instanceof ServiceUnavailableError);
          assert.match(err.message, /not ready/i);
          return true;
        }
      );

      await provider.shutdown();
    });

    it('2.3 Strictly routes outbound message to matching center socket and preserves multi-tenant isolation', async () => {
      const messagesCenterA = [];
      const messagesCenterB = [];

      const provider = createTestProvider({
        makeSocketFn: () => {
          const ev = new EventEmitter();
          const mockSock = {
            ev,
            ws: new EventEmitter(),
            end: () => {},
          };
          return mockSock;
        },
      });

      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: true }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      // Spawn session A
      await provider.initializeSession('center-aaa');
      const sessionA = provider.sessions.get('center-aaa');
      sessionA.sock.sendMessage = async (jid, content) => {
        messagesCenterA.push({ jid, content });
        return { key: { id: 'MSG_A', remoteJid: jid } };
      };
      sessionA.sock.ev.emit('connection.update', { connection: 'open' });

      // Spawn session B
      await provider.initializeSession('center-bbb');
      const sessionB = provider.sessions.get('center-bbb');
      sessionB.sock.sendMessage = async (jid, content) => {
        messagesCenterB.push({ jid, content });
        return { key: { id: 'MSG_B', remoteJid: jid } };
      };
      sessionB.sock.ev.emit('connection.update', { connection: 'open' });

      // Dispatch to Center A only
      const resA = await provider.sendMessage({
        centerId: 'center-aaa',
        phone: '9876543210',
        message: 'Message for Center A',
      });

      assert.strictEqual(resA.success, true);
      assert.strictEqual(messagesCenterA.length, 1);
      assert.strictEqual(messagesCenterB.length, 0);

      await provider.shutdown();
    });
  });

  /* ======================================================================
   * Fix 3: Startup Session Restoration & Lifecycle Guards
   * ====================================================================== */
  describe('Fix 3: Startup Session Restoration & Lifecycle Guards', () => {
    it('3.1 Discovers and restores registered sessions on startup without duplicate reconnect storms', async () => {
      const restoredCenters = [];
      const makeSocketFn = createMockSocketFactory((sock) => {});

      const provider = createTestProvider({
        makeSocketFn,
        mongooseInstance: {
          connection: { readyState: 1, db: {} },
        },
      });

      provider.authStore.listSavedSessions = async () => ['center-saved-1', 'center-saved-2'];
      provider.authStore.listRegisteredSessions = async () => ['center-saved-1', 'center-saved-2'];
      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: true }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      // Override initializeSession to track startup calls
      const origInitSession = provider.initializeSession.bind(provider);
      provider.initializeSession = async (cId) => {
        restoredCenters.push(cId);
        return origInitSession(cId);
      };

      // Temporarily enable auto-reconnect on boot
      const origBoot = process.env.AUTO_RECONNECT_ON_BOOT;
      const origEnv = process.env.NODE_ENV;
      process.env.AUTO_RECONNECT_ON_BOOT = 'true';
      process.env.NODE_ENV = 'development';

      try {
        await provider.init();
        // Allow staggered timers (0ms and 500ms) to execute fully
        await new Promise((resolve) => setTimeout(resolve, 1100));

        assert.strictEqual(provider.savedSessionCenters.has('center-saved-1'), true);
        assert.strictEqual(provider.savedSessionCenters.has('center-saved-2'), true);
        assert.strictEqual(restoredCenters.includes('center-saved-1'), true);
        assert.strictEqual(restoredCenters.includes('center-saved-2'), true);

        // Repeated init() call should NOT duplicate restoration
        const callCountBefore = restoredCenters.length;
        await provider.init();
        await new Promise((resolve) => setTimeout(resolve, 600));
        assert.strictEqual(restoredCenters.length, callCountBefore);
      } finally {
        if (origBoot !== undefined) process.env.AUTO_RECONNECT_ON_BOOT = origBoot;
        else delete process.env.AUTO_RECONNECT_ON_BOOT;
        process.env.NODE_ENV = origEnv;
        await provider.shutdown();
      }
    });
  });

  /* ======================================================================
   * Fix 4: Cold Session Timeout
   * ====================================================================== */
  describe('Fix 4: Cold Session Timeout & Readiness Configuration', () => {
    it('4.1 Honors configurable coldSessionTimeoutMs and throws descriptive ServiceUnavailableError on timeout', async () => {
      const provider = createTestProvider({
        makeSocketFn: createMockSocketFactory(),
        coldSessionTimeoutMs: 100, // fast timeout for test
        initWatchdogTimeoutMs: 2000,
      });

      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: true }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      try {
        await provider.initializeSession('center-slow');
        // Do not emit connection: open, leaves session in initializing state

        const startTime = Date.now();
        await assert.rejects(
          async () => {
            await provider.sendMessage({
              centerId: 'center-slow',
              phone: '9876543210',
              message: 'Hello slow',
            });
          },
          (err) => {
            assert.ok(err instanceof ServiceUnavailableError);
            assert.match(err.message, /not ready \(connection in progress\)/i);
            return true;
          }
        );
        const elapsed = Date.now() - startTime;
        assert.ok(elapsed >= 90, `Elapsed ${elapsed}ms should be >= 90ms`);
      } finally {
        await provider.shutdown();
      }
    });

    it('4.2 Successfully delivers message when session becomes ready during cold wait interval', async () => {
      let createdSock = null;
      const makeSocketFn = createMockSocketFactory((sock) => {
        createdSock = sock;
      });

      const provider = createTestProvider({
        makeSocketFn,
        coldSessionTimeoutMs: 1000,
      });

      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: true }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      await provider.initializeSession('center-delayed');

      // Schedule session to become ready after 150ms
      setTimeout(() => {
        createdSock.ev.emit('connection.update', { connection: 'open' });
      }, 150);

      const result = await provider.sendMessage({
        centerId: 'center-delayed',
        phone: '9876543210',
        message: 'Message delivered after handshake wait',
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.accepted, true);

      await provider.shutdown();
    });
  });

  /* ======================================================================
   * Fix 6: QR Expiration Lifecycle (No Reconnect Storm)
   * ====================================================================== */
  describe('Fix 6: QR Expiration Lifecycle (No Reconnect Storm)', () => {
    it('6.1 Cleans up cleanly to disconnected on 408 QR timeout and does not auto-reconnect', async () => {
      let createdSock = null;
      const makeSocketFn = createMockSocketFactory((sock) => {
        createdSock = sock;
      });

      const provider = createTestProvider({
        makeSocketFn,
        maxReconnectAttempts: 5,
      });

      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: false }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      await provider.initializeSession('center-qr-expire');
      createdSock.ev.emit('connection.update', { qr: 'expiring-qr' });

      let status = await provider.getStatus('center-qr-expire');
      assert.strictEqual(status.status, 'qr_ready');
      assert.strictEqual(status.qr, 'expiring-qr');

      // Simulate 408 timeout on unscanned QR
      createdSock.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 408 } } },
      });

      status = await provider.getStatus('center-qr-expire');
      assert.strictEqual(status.status, 'disconnected');
      assert.strictEqual(status.ready, false);
      assert.strictEqual(status.qr, null);
      assert.match(status.error, /QR code expired without being scanned/i);

      const sessionObj = provider.sessions.get('center-qr-expire');
      assert.strictEqual(sessionObj.reconnectAttempts, 0);
      assert.strictEqual(sessionObj.reconnectTimer, null);

      await provider.shutdown();
    });
  });

  /* ======================================================================
   * Fix 7: Boot Mongo Initialization & Lazy ensureMongoConnected
   * ====================================================================== */
  describe('Fix 7: Boot Mongo Initialization & Lazy Connection Guard', () => {
    it('7.1 ensureMongoConnected lazily triggers init() and awaits mongoInitPromise', async () => {
      let connectCalled = false;
      const mockMongoose = {
        connection: { readyState: 0 },
        connect: async () => {
          connectCalled = true;
          mockMongoose.connection.readyState = 1;
          mockMongoose.connection.db = {};
        },
      };

      const provider = new BaileysProvider({
        mongodbUri: 'mongodb://mock-cluster/tuitiondesk_test',
        mongooseInstance: mockMongoose,
      });

      assert.strictEqual(connectCalled, false);
      assert.strictEqual(provider.isMongoConnected, false);

      await provider.ensureMongoConnected();

      assert.strictEqual(connectCalled, true);
      assert.strictEqual(provider.isMongoConnected, true);

      await provider.shutdown();
    });

    it('7.2 getStatus awaits ensureMongoConnected when called on cold provider', async () => {
      let connectCalled = false;
      const mockMongoose = {
        connection: { readyState: 0 },
        connect: async () => {
          connectCalled = true;
          mockMongoose.connection.readyState = 1;
          mockMongoose.connection.db = {
            collection: () => ({
              distinct: async () => [],
              findOne: async () => null,
            }),
          };
        },
      };

      const provider = new BaileysProvider({
        mongodbUri: 'mongodb://mock-cluster/tuitiondesk_test',
        mongooseInstance: mockMongoose,
      });

      const status = await provider.getStatus('center-cold-check');
      assert.strictEqual(connectCalled, true);
      assert.strictEqual(status.status, 'disconnected');
      assert.strictEqual(status.hasSavedSession, false);

      await provider.shutdown();
    });
  });
});
