'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const BaileysProvider = require('../providers/BaileysProvider');
const { formatBaileysJid } = require('../providers/BaileysProvider');
const {
  ValidationError,
  NotRegisteredError,
  ConflictError,
  ConnectedRefusalError,
  ServiceUnavailableError,
} = require('../providers/ProviderErrors');

/**
 * Creates an in-memory MongoDB mock matching baileysStore expectations.
 */
function createMockMongoDb() {
  const documents = new Map();

  const collection = {
    async createIndex() {
      return 'index_created';
    },

    async findOne(query) {
      for (const doc of documents.values()) {
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (doc[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) return { ...doc };
      }
      return null;
    },

    find(query) {
      const results = [];
      for (const doc of documents.values()) {
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (k === 'key' && v && typeof v === 'object' && Array.isArray(v.$in)) {
            if (!v.$in.includes(doc.key)) {
              match = false;
              break;
            }
          } else if (doc[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) results.push({ ...doc });
      }
      return {
        toArray: async () => [...results],
      };
    },

    async updateOne(filter, update, options) {
      const docKey = `${filter.centerId}:${filter.key}`;
      const existing = documents.get(docKey);

      if (existing) {
        if (update.$set) Object.assign(existing, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      } else if (options && options.upsert) {
        const newDoc = { ...filter, ...(update.$set || {}) };
        documents.set(docKey, newDoc);
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },

    async deleteOne(filter) {
      const docKey = `${filter.centerId}:${filter.key}`;
      if (documents.has(docKey)) {
        documents.delete(docKey);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },

    async deleteMany(filter) {
      let count = 0;
      for (const [k, doc] of Array.from(documents.entries())) {
        let match = true;
        for (const [prop, val] of Object.entries(filter)) {
          if (doc[prop] !== val) {
            match = false;
            break;
          }
        }
        if (match) {
          documents.delete(k);
          count++;
        }
      }
      return { deletedCount: count };
    },

    async distinct(field, filter) {
      const set = new Set();
      for (const doc of documents.values()) {
        let match = true;
        if (filter) {
          for (const [prop, val] of Object.entries(filter)) {
            if (doc[prop] !== val) {
              match = false;
              break;
            }
          }
        }
        if (match && doc[field] !== undefined) {
          set.add(doc[field]);
        }
      }
      return Array.from(set);
    },

    async bulkWrite(operations) {
      for (const op of operations) {
        if (op.updateOne) {
          await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert });
        } else if (op.deleteOne) {
          await this.deleteOne(op.deleteOne.filter);
        }
      }
      return { ok: 1 };
    },
  };

  const mockMongoose = {
    connection: {
      readyState: 1,
      db: {
        collection: () => collection,
      },
    },
  };

  return { mockMongoose, collection, documents };
}

/**
 * Creates an event-driven Mock Baileys Socket.
 */
function createMockBaileysSocket() {
  const listeners = new Map();
  let isEnded = false;
  let isLoggedOut = false;

  const ev = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    off(event, handler) {
      if (!listeners.has(event)) return;
      listeners.set(event, listeners.get(event).filter((h) => h !== handler));
    },
    emit(event, data) {
      const handlers = listeners.get(event) || [];
      for (const h of handlers) h(data);
    },
    removeAllListeners() {
      listeners.clear();
    },
    listenerCount(event) {
      return (listeners.get(event) || []).length;
    },
  };

  return {
    ev,
    get isEnded() {
      return isEnded;
    },
    get isLoggedOut() {
      return isLoggedOut;
    },
    sendMessage: async (jid, content) => {
      if (isEnded) throw new Error('Socket is closed');
      return {
        key: { id: `mock-msg-${Date.now()}` },
        message: content,
      };
    },
    onWhatsApp: async (jid) => {
      if (jid.includes('unregistered') || jid.includes('9999900001')) {
        return [{ jid, exists: false }];
      }
      return [{ jid, exists: true }];
    },
    logout: async () => {
      isLoggedOut = true;
    },
    end: () => {
      isEnded = true;
    },
  };
}

describe('BaileysProvider Test Suite (Phase 2C - Mocked)', () => {
  let mockEnv;
  let createdSockets;
  let makeSocketFn;

  beforeEach(() => {
    mockEnv = createMockMongoDb();
    createdSockets = [];
    makeSocketFn = () => {
      const sock = createMockBaileysSocket();
      createdSockets.push(sock);
      return sock;
    };
  });

  /* ------------------------------------------------------------------
   * Test 1: Provider Construction & Health-Check Compatibility [Mocked]
   * ------------------------------------------------------------------ */
  it('1.1 Provider construction and dependency injection [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      collectionName: 'test_baileys_auth',
      makeSocketFn,
    });

    assert.strictEqual(provider.name, 'baileys_native');
    assert.strictEqual(provider.isMongoConnected, true);
    assert.strictEqual(provider.isDurable, true);
    assert.strictEqual(provider.persistenceMode, 'mongodb_native');
  });

  it('1.2 Health-check getters report mongoUri and persistenceStatus accurately across states [Mocked]', async () => {
    // State A: Configured and Connected
    const providerConnected = new BaileysProvider({
      mongodbUri: 'mongodb://localhost:27017/test_db',
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });
    assert.strictEqual(providerConnected.mongoUri, 'mongodb://localhost:27017/test_db');
    assert.strictEqual(providerConnected.isMongoConnected, true);
    assert.strictEqual(providerConnected.isDurable, true);
    assert.strictEqual(providerConnected.persistenceStatus, 'connected');

    // State B: Configured but Disconnected / Degraded
    const mockMongooseDisconnected = {
      connection: {
        readyState: 0,
        db: null,
      },
    };
    const providerDisconnected = new BaileysProvider({
      mongodbUri: 'mongodb://localhost:27017/test_db',
      mongooseInstance: mockMongooseDisconnected,
      makeSocketFn,
    });
    assert.strictEqual(providerDisconnected.mongoUri, 'mongodb://localhost:27017/test_db');
    assert.strictEqual(providerDisconnected.isMongoConnected, false);
    assert.strictEqual(providerDisconnected.isDurable, false);
    assert.strictEqual(providerDisconnected.persistenceStatus, 'connecting_or_disconnected');

    // State C: Unconfigured Ephemeral
    const providerUnconfigured = new BaileysProvider({
      mongodbUri: '',
      mongooseInstance: mockMongooseDisconnected,
      makeSocketFn,
    });
    assert.strictEqual(providerUnconfigured.isMongoConnected, false);
    assert.strictEqual(providerUnconfigured.persistenceStatus, 'unconfigured_ephemeral');
  });

  /* ------------------------------------------------------------------
   * Test 2: QR Event Handling and QR Clearing [Mocked]
   * ------------------------------------------------------------------ */
  it('2. QR event handling and QR clearing on successful connection [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    await provider.initializeSession('center-qr');
    const mockSocket = createdSockets[0];

    // Emit QR code event
    mockSocket.ev.emit('connection.update', { qr: 'mock-qr-raw-payload' });

    let status = await provider.getStatus('center-qr');
    assert.strictEqual(status.status, 'qr_ready');
    assert.strictEqual(status.qr, 'mock-qr-raw-payload');
    assert.ok(status.qrGeneratedAt > 0);
    assert.strictEqual(status.ready, false);

    // Emit successful open event
    mockSocket.ev.emit('connection.update', { connection: 'open' });

    status = await provider.getStatus('center-qr');
    assert.strictEqual(status.status, 'connected');
    assert.strictEqual(status.qr, null, 'QR must be cleared after connection is opened');
    assert.strictEqual(status.ready, true);
  });

  /* ------------------------------------------------------------------
   * Test 3: Successful Connection and Status Updates [Mocked]
   * ------------------------------------------------------------------ */
  it('3. Successful connection and normalized status updates [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    const initResult = await provider.initializeSession('center-status');
    assert.strictEqual(initResult.status, 'initializing');
    assert.strictEqual(initResult.ready, false);

    const mockSocket = createdSockets[0];
    mockSocket.ev.emit('connection.update', { connection: 'open' });

    const status = await provider.getStatus('center-status');
    assert.strictEqual(status.centerId, 'center-status');
    assert.strictEqual(status.status, 'connected');
    assert.strictEqual(status.ready, true);
    assert.strictEqual(status.hasClientProcess, true);
    assert.strictEqual(status.hasSavedSession, true);
  });

  /* ------------------------------------------------------------------
   * Test 4: Credentials Update Persistence [Mocked]
   * ------------------------------------------------------------------ */
  it('4. Credentials update triggers persistence into MongoDB auth store [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    await provider.initializeSession('center-creds');
    const mockSocket = createdSockets[0];

    // Socket emits creds.update
    mockSocket.ev.emit('creds.update', {});

    // Allow async persistence
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify document was written into MongoDB mock
    assert.strictEqual(mockEnv.documents.has('center-creds:creds'), true);
    const credsDoc = mockEnv.documents.get('center-creds:creds');
    assert.strictEqual(credsDoc.centerId, 'center-creds');
    assert.strictEqual(credsDoc.key, 'creds');
  });

  /* ------------------------------------------------------------------
   * Test 5: Socket Close & Reconnect Behavior [Mocked]
   * ------------------------------------------------------------------ */
  it('5. Socket close triggers auto-reconnect on transient errors and purges session on logout 401 [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
      maxReconnectAttempts: 2,
    });

    // Subtest A: Transient error triggers auto-reconnect
    await provider.initializeSession('center-reconnect');
    const mockSocket1 = createdSockets[0];

    mockSocket1.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Error('Simulated network drop') },
    });

    let status = await provider.getStatus('center-reconnect');
    assert.strictEqual(status.status, 'disconnected');
    assert.strictEqual(status.ready, false);

    // Subtest B: Explicit 401 (loggedOut) destroys socket and clears auth
    await provider.initializeSession('center-401');
    const mockSocket401 = createdSockets[createdSockets.length - 1];

    mockSocket401.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    const status401 = await provider.getStatus('center-401');
    assert.strictEqual(status401.status, 'disconnected');
    assert.strictEqual(status401.hasClientProcess, false);
    assert.strictEqual(status401.hasSavedSession, false, 'Session must be purged on 401 logged out');
  });

  /* ------------------------------------------------------------------
   * Test 6: Duplicate Initialization & Session-Operation Lock [Mocked]
   * ------------------------------------------------------------------ */
  describe('6. Duplicate Initialization & Session-Operation Lock [Mocked]', () => {
    it('6.1 Concurrent initialization requests are deduplicated and create exactly one socket', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      // Fire 3 simultaneous initializeSession calls for the same center
      const [res1, res2, res3] = await Promise.all([
        provider.initializeSession('center-dedup'),
        provider.initializeSession('center-dedup'),
        provider.initializeSession('center-dedup'),
      ]);

      assert.strictEqual(createdSockets.length, 1, 'Only one Baileys socket must be created');
      assert.strictEqual(res1.centerId, 'center-dedup');
      assert.strictEqual(res2.centerId, 'center-dedup');
      assert.strictEqual(res3.centerId, 'center-dedup');
    });

    it('6.2 initializeSession throws ConflictError when center is locked by an active reconnect operation', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      // Simulate active reconnect lock
      provider.activeLocks.add('center-reconnect-lock');

      await assert.rejects(
        () => provider.initializeSession('center-reconnect-lock'),
        ConflictError
      );

      // Release lock and verify initializeSession succeeds
      provider.activeLocks.delete('center-reconnect-lock');
      const res = await provider.initializeSession('center-reconnect-lock');
      assert.strictEqual(res.centerId, 'center-reconnect-lock');
    });

    it('6.3 initializeSession throws ConflictError when center is locked by an active logout operation', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      // Simulate active logout lock
      provider.activeLocks.add('center-logout-lock');

      await assert.rejects(
        () => provider.initializeSession('center-logout-lock'),
        ConflictError
      );

      // Release lock and verify initializeSession succeeds
      provider.activeLocks.delete('center-logout-lock');
      const res = await provider.initializeSession('center-logout-lock');
      assert.strictEqual(res.centerId, 'center-logout-lock');
    });

    it('6.4 Active locks are released cleanly after operation failures without causing deadlocks', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      // Mock authStore.clearAuth to throw during new_pairing
      provider.authStore.clearAuth = async () => {
        throw new Error('Injected database timeout during clearAuth');
      };

      // reconnect with new_pairing must reject with ProviderError (500)
      await assert.rejects(
        () => provider.reconnectSession('center-lock-fail', { action: 'new_pairing' }),
        /Failed to clear previous saved session/
      );

      // Verify that activeLock was cleaned up in finally block
      assert.strictEqual(
        provider.activeLocks.has('center-lock-fail'),
        false,
        'Lock must be released on failure'
      );

      // Restore functional clearAuth and verify subsequent init proceeds without deadlock
      delete provider.authStore.clearAuth;
      const res = await provider.initializeSession('center-lock-fail');
      assert.strictEqual(res.centerId, 'center-lock-fail');
    });
  });

  /* ------------------------------------------------------------------
   * Test 7: Logout and Center-Specific Cleanup [Mocked]
   * ------------------------------------------------------------------ */
  it('7. Logout ends socket, clears listeners, and deletes only target center credentials [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    await provider.initializeSession('center-logout');
    const mockSocket = createdSockets[0];

    // Emit creds to save session
    mockSocket.ev.emit('creds.update', {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(mockEnv.documents.has('center-logout:creds'), true);

    const logoutResult = await provider.logoutSession('center-logout');
    assert.strictEqual(logoutResult.success, true);
    assert.strictEqual(mockSocket.isEnded, true, 'Socket must be closed on logout');
    assert.strictEqual(mockEnv.documents.has('center-logout:creds'), false, 'Credentials must be deleted on logout');

    const status = await provider.getStatus('center-logout');
    assert.strictEqual(status.status, 'disconnected');
    assert.strictEqual(status.ready, false);
  });

  /* ------------------------------------------------------------------
   * Test 8: Multi-Tenant Isolation Between Two Centers [Mocked]
   * ------------------------------------------------------------------ */
  it('8. Two centers operate completely independently without cross-talk [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    await provider.initializeSession('center-alpha');
    await provider.initializeSession('center-beta');

    assert.strictEqual(createdSockets.length, 2);
    const socketAlpha = createdSockets[0];
    const socketBeta = createdSockets[1];

    // Connect Alpha only
    socketAlpha.ev.emit('connection.update', { connection: 'open' });
    // Set QR on Beta only
    socketBeta.ev.emit('connection.update', { qr: 'beta-qr-code' });

    const statusAlpha = await provider.getStatus('center-alpha');
    const statusBeta = await provider.getStatus('center-beta');

    assert.strictEqual(statusAlpha.status, 'connected');
    assert.strictEqual(statusAlpha.ready, true);
    assert.strictEqual(statusAlpha.qr, null);

    assert.strictEqual(statusBeta.status, 'qr_ready');
    assert.strictEqual(statusBeta.ready, false);
    assert.strictEqual(statusBeta.qr, 'beta-qr-code');

    // Logout Alpha - Beta must remain unaffected
    await provider.logoutSession('center-alpha');
    assert.strictEqual(socketAlpha.isEnded, true);
    assert.strictEqual(socketBeta.isEnded, false, 'Beta socket must remain active');

    const statusBetaAfter = await provider.getStatus('center-beta');
    assert.strictEqual(statusBetaAfter.status, 'qr_ready');
  });

  /* ------------------------------------------------------------------
   * Test 9: Stale Socket Events After Reconnect [Mocked]
   * ------------------------------------------------------------------ */
  it('9. Stale socket events after reconnect are ignored and cannot overwrite newer state [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    await provider.initializeSession('center-stale');
    const staleSocket = createdSockets[0];

    // Emit QR to move from 'initializing' to 'qr_ready'
    staleSocket.ev.emit('connection.update', { qr: 'stale-initial-qr' });

    // Reconnect session creates a new socket (generation 2)
    await provider.reconnectSession('center-stale', { action: 'refresh' });
    const freshSocket = createdSockets[1];

    // Fresh socket connects
    freshSocket.ev.emit('connection.update', { connection: 'open' });
    let status = await provider.getStatus('center-stale');
    assert.strictEqual(status.status, 'connected');

    // Stale socket emits a delayed QR code event
    staleSocket.ev.emit('connection.update', { qr: 'stale-qr-code' });

    // Status MUST still be 'connected', stale event must be ignored!
    status = await provider.getStatus('center-stale');
    assert.strictEqual(status.status, 'connected', 'Stale socket event must NOT overwrite connected status');
    assert.strictEqual(status.qr, null);
  });

  /* ------------------------------------------------------------------
   * Test 10: Message Send Validation and Result Mapping [Mocked]
   * ------------------------------------------------------------------ */
  describe('10. Message Sending Contract [Mocked]', () => {
    it('10.1 Successfully sends message for connected center and returns contract payload', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      await provider.initializeSession('center-send');
      const mockSocket = createdSockets[0];
      mockSocket.ev.emit('connection.update', { connection: 'open' });

      const result = await provider.sendMessage({
        centerId: 'center-send',
        phone: '9876543210',
        message: 'TuitionDesk attendance update',
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.centerId, 'center-send');
      assert.strictEqual(result.recipient, '919876543210@s.whatsapp.net');
      assert.ok(result.messageId.startsWith('mock-msg-'));
      assert.ok(result.timestamp);
    });

    it('10.2 Rejects when phone or message is missing (ValidationError)', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      await assert.rejects(
        () => provider.sendMessage({ centerId: 'c1', phone: '', message: 'hi' }),
        ValidationError
      );
      await assert.rejects(
        () => provider.sendMessage({ centerId: 'c1', phone: '9876543210', message: '' }),
        ValidationError
      );
    });

    it('10.3 Rejects when client is not ready (ServiceUnavailableError)', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      await provider.initializeSession('center-not-ready');

      await assert.rejects(
        () => provider.sendMessage({ centerId: 'center-not-ready', phone: '9876543210', message: 'test' }),
        ServiceUnavailableError
      );
    });

    it('10.4 Rejects when number is not registered on WhatsApp (NotRegisteredError)', async () => {
      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      await provider.initializeSession('center-unreg');
      const mockSocket = createdSockets[0];
      mockSocket.ev.emit('connection.update', { connection: 'open' });

      // In mockSocket, numbers containing '9999900001' return exists: false
      await assert.rejects(
        () => provider.sendMessage({ centerId: 'center-unreg', phone: '9999900001', message: 'test' }),
        NotRegisteredError
      );
    });
  });

  /* ------------------------------------------------------------------
   * Test 11: Listener and Timer Cleanup on Client Destruction [Mocked]
   * ------------------------------------------------------------------ */
  it('11. Cleans up timers and removes all socket listeners on destruction [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    await provider.initializeSession('center-cleanup');
    const mockSocket = createdSockets[0];

    assert.ok(mockSocket.ev.listenerCount('connection.update') > 0);
    assert.ok(mockSocket.ev.listenerCount('creds.update') > 0);

    const sessionObj = provider.sessions.get('center-cleanup');
    await provider.destroySocketSafely(sessionObj);

    assert.strictEqual(sessionObj.sock, null);
    assert.strictEqual(mockSocket.ev.listenerCount('connection.update'), 0, 'Listeners must be cleared');
    assert.strictEqual(mockSocket.isEnded, true, 'Socket end must be called');
  });

  /* ------------------------------------------------------------------
   * Test 12: Provider Shutdown Cleanup [Mocked]
   * ------------------------------------------------------------------ */
  it('12. Provider shutdown terminates all active sockets across all centers [Mocked]', async () => {
    const provider = new BaileysProvider({
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn,
    });

    await provider.initializeSession('center-shut-1');
    await provider.initializeSession('center-shut-2');

    assert.strictEqual(createdSockets.length, 2);
    const [sock1, sock2] = createdSockets;

    await provider.shutdown();

    assert.strictEqual(sock1.isEnded, true);
    assert.strictEqual(sock2.isEnded, true);
    assert.strictEqual(provider.sessions.size, 0);
  });
});
