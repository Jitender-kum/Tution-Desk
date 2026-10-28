'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const BaileysProvider = require('../providers/BaileysProvider');
const {
  ValidationError,
  NotRegisteredError,
  ServiceUnavailableError,
  ProviderError,
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

    async distinct(field, query) {
      const set = new Set();
      for (const doc of documents.values()) {
        let match = true;
        if (query) {
          for (const [k, v] of Object.entries(query)) {
            if (doc[k] !== v) {
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
    connect: async () => mockMongoose.connection,
    disconnect: async () => {},
  };

  return { mockMongoose, collection, documents };
}

describe('Baileys Outbound Dispatch & Success Semantics Suite', () => {
  let mockEnv;
  let sentMessages = [];
  let onWhatsAppResult = [{ jid: '919876543210@s.whatsapp.net', exists: true }];
  let shouldFailSend = false;
  let activeSocket = null;

  beforeEach(() => {
    mockEnv = createMockMongoDb();
    sentMessages = [];
    onWhatsAppResult = [{ jid: '919876543210@s.whatsapp.net', exists: true }];
    shouldFailSend = false;
    activeSocket = null;
  });

  function createTestProvider(options = {}) {
    return new BaileysProvider({
      mongodbUri: 'mongodb://localhost:27017/test_db',
      mongooseInstance: mockEnv.mockMongoose,
      makeSocketFn: () => {
        const listeners = new Map();
        const sock = {
          ev: {
            on(evt, handler) {
              if (!listeners.has(evt)) listeners.set(evt, []);
              listeners.get(evt).push(handler);
            },
            removeAllListeners() {
              listeners.clear();
            },
            emit(evt, payload) {
              const arr = listeners.get(evt) || [];
              for (const fn of arr) fn(payload);
            },
          },
          end() {},
          ws: { close() {} },
          async onWhatsApp(jid) {
            return onWhatsAppResult;
          },
          async sendMessage(jid, content) {
            if (shouldFailSend) {
              throw new Error('Signal cipher handshake failed');
            }
            const msgId = `BAILEYS_${Date.now()}`;
            sentMessages.push({ jid, content, msgId });
            return { key: { id: msgId, remoteJid: jid }, status: 1 };
          },
        };
        activeSocket = sock;
        return sock;
      },
      ...options,
    });
  }

  it('1. Successfully dispatches message to Baileys socket and returns accepted: true, delivered: false', async () => {
    const provider = createTestProvider();
    await provider.init();
    await provider.initializeSession('center-alpha');

    // Simulate connection open
    const session = provider.sessions.get('center-alpha');
    session.sock.ev.emit('connection.update', { connection: 'open' });
    assert.strictEqual(session.isReady, true);

    const result = await provider.sendMessage({
      centerId: 'center-alpha',
      phone: '9876543210',
      message: 'Hello Student! Your admission is confirmed.',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.delivered, false);
    assert.strictEqual(result.status, 'accepted');
    assert.strictEqual(result.centerId, 'center-alpha');
    assert.strictEqual(result.recipient, '919876543210@s.whatsapp.net');
    assert.match(result.messageId, /^BAILEYS_/);
    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].content.text, 'Hello Student! Your admission is confirmed.');

    await provider.shutdown();
  });

  it('2. Throws ServiceUnavailableError and never reports false success when client is not ready', async () => {
    const provider = createTestProvider();
    await provider.init();
    await provider.initializeSession('center-unready');

    // Do NOT emit connection open; socket is not ready
    await assert.rejects(
      async () => {
        await provider.sendMessage({
          centerId: 'center-unready',
          phone: '9876543210',
          message: 'Ping',
        });
      },
      (err) => {
        assert(err instanceof ServiceUnavailableError);
        assert.strictEqual(err.statusCode, 503);
        assert.match(err.message, /not ready/i);
        return true;
      }
    );

    assert.strictEqual(sentMessages.length, 0);
    await provider.shutdown();
  });

  it('3. Propagates provider send errors cleanly without masking as success', async () => {
    const provider = createTestProvider();
    await provider.init();
    await provider.initializeSession('center-error');

    const session = provider.sessions.get('center-error');
    session.sock.ev.emit('connection.update', { connection: 'open' });

    shouldFailSend = true;

    await assert.rejects(
      async () => {
        await provider.sendMessage({
          centerId: 'center-error',
          phone: '9876543210',
          message: 'Ping that fails',
        });
      },
      (err) => {
        assert(err instanceof ProviderError);
        assert.strictEqual(err.statusCode, 500);
        assert.match(err.message, /Signal cipher handshake failed/);
        return true;
      }
    );

    await provider.shutdown();
  });

  it('4. Rejects unformatted or invalid phone numbers with ValidationError', async () => {
    const provider = createTestProvider();
    await provider.init();
    await provider.initializeSession('center-valid');

    const session = provider.sessions.get('center-valid');
    session.sock.ev.emit('connection.update', { connection: 'open' });

    await assert.rejects(
      async () => {
        await provider.sendMessage({
          centerId: 'center-valid',
          phone: '123', // Invalid
          message: 'Test',
        });
      },
      (err) => {
        assert(err instanceof ValidationError);
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );

    await provider.shutdown();
  });

  it('5. Rejects unregistered WhatsApp phone numbers with NotRegisteredError', async () => {
    const provider = createTestProvider();
    await provider.init();
    await provider.initializeSession('center-unreg');

    const session = provider.sessions.get('center-unreg');
    session.sock.ev.emit('connection.update', { connection: 'open' });

    onWhatsAppResult = [{ jid: '919876543210@s.whatsapp.net', exists: false }];

    await assert.rejects(
      async () => {
        await provider.sendMessage({
          centerId: 'center-unreg',
          phone: '9876543210',
          message: 'Test',
        });
      },
      (err) => {
        assert(err instanceof NotRegisteredError);
        assert.strictEqual(err.statusCode, 404);
        return true;
      }
    );

    await provider.shutdown();
  });

  it('6. Auto-rehydrates saved MongoDB session when socket is not in memory', async () => {
    const provider = createTestProvider();
    await provider.init();

    // Seed mockDb with an existing session for 'center-rehydrate'
    provider.savedSessionCenters.add('center-rehydrate');

    await mockEnv.collection.updateOne(
      { centerId: 'center-rehydrate', key: 'creds' },
      { $set: { centerId: 'center-rehydrate', key: 'creds', value: { me: { id: 'test' } } } },
      { upsert: true }
    );

    // Initial state: sessions map does NOT have center-rehydrate
    assert.strictEqual(provider.sessions.has('center-rehydrate'), false);

    // Override initializeSession to emit connection open immediately
    const origInit = provider.initializeSession.bind(provider);
    provider.initializeSession = async (centerId) => {
      const res = await origInit(centerId);
      const s = provider.sessions.get(centerId);
      if (s) {
        s.sock.ev.emit('connection.update', { connection: 'open' });
      }
      return res;
    };

    const result = await provider.sendMessage({
      centerId: 'center-rehydrate',
      phone: '9876543210',
      message: 'Rehydration auto-dispatch test',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(sentMessages.length, 1);

    await provider.shutdown();
  });
});
