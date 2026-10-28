'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

// Ensure test secret is set
process.env.WHATSAPP_INTERNAL_SECRET = 'test_internal_secret_for_engine_selection_999';

const { createProvider, createApp } = require('../index');
const WWebJSProvider = require('../providers/WWebJSProvider');
const BaileysProvider = require('../providers/BaileysProvider');

/**
 * Creates in-memory mock MongoDB matching BaileysStore expectations.
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

    async distinct(field) {
      const set = new Set();
      for (const doc of documents.values()) {
        if (doc[field] !== undefined) {
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

function createMockBaileysSocket() {
  const listeners = new Map();
  let isEnded = false;

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
  };

  return {
    ev,
    get isEnded() {
      return isEnded;
    },
    sendMessage: async (jid, content) => {
      if (isEnded) throw new Error('Socket closed');
      return { key: { id: `baileys-msg-${Date.now()}` }, message: content };
    },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    logout: async () => {},
    end: () => {
      isEnded = true;
    },
  };
}

describe('Engine Selection & Guarded Integration Test Suite (Phase 3C)', () => {
  /* ------------------------------------------------------------------
   * Group 1: Engine Selection & Validation [Mocked]
   * ------------------------------------------------------------------ */
  describe('1. Engine Selection & Validation [Mocked]', () => {
    it('1.1 Defaults strictly to WWebJSProvider when WHATSAPP_ENGINE is unset or empty', () => {
      const providerDefault = createProvider(undefined);
      assert.ok(providerDefault instanceof WWebJSProvider);
      assert.strictEqual(providerDefault.name, 'wwebjs_remoteauth');

      const providerEmpty = createProvider('');
      assert.ok(providerEmpty instanceof WWebJSProvider);
      assert.strictEqual(providerEmpty.name, 'wwebjs_remoteauth');
    });

    it('1.2 Instantiates WWebJSProvider when WHATSAPP_ENGINE=wwebjs', () => {
      const provider = createProvider('wwebjs');
      assert.ok(provider instanceof WWebJSProvider);
      assert.strictEqual(provider.name, 'wwebjs_remoteauth');
    });

    it('1.3 Instantiates BaileysProvider only when WHATSAPP_ENGINE=baileys is explicitly configured', () => {
      const provider = createProvider('baileys');
      assert.ok(provider instanceof BaileysProvider);
      assert.strictEqual(provider.name, 'baileys_native');
    });

    it('1.4 Handles case-insensitivity and leading/trailing whitespace safely', () => {
      const provider = createProvider('  BAILEYS  ');
      assert.ok(provider instanceof BaileysProvider);
      assert.strictEqual(provider.name, 'baileys_native');

      const providerWweb = createProvider('  WWebJS  ');
      assert.ok(providerWweb instanceof WWebJSProvider);
      assert.strictEqual(providerWweb.name, 'wwebjs_remoteauth');
    });

    it('1.5 Fails closed and rejects unsupported engines with descriptive error', () => {
      assert.throws(
        () => createProvider('invalid_engine'),
        /Unsupported WHATSAPP_ENGINE 'invalid_engine'\. Supported engines are 'wwebjs' and 'baileys'\./
      );

      assert.throws(
        () => createProvider('puppeteer'),
        /Unsupported WHATSAPP_ENGINE 'puppeteer'/
      );

      assert.throws(
        () => createProvider('twilio'),
        /Unsupported WHATSAPP_ENGINE 'twilio'/
      );
    });

    it('1.6 Instantiates exactly one provider per process and prevents dual-engine execution', () => {
      const provider = createProvider('baileys');
      assert.strictEqual(provider.name, 'baileys_native');
      // Verify no secondary engine is instantiated
      assert.strictEqual(typeof provider.destroyClientSafely, 'undefined', 'BaileysProvider must not contain Chromium methods');
    });
  });

  /* ------------------------------------------------------------------
   * Group 2: Route Parity & API Contract with BaileysProvider [Mocked]
   * ------------------------------------------------------------------ */
  describe('2. Route Parity & API Contract with BaileysProvider [Mocked]', () => {
    let server;
    let baseUrl;
    let mockEnv;
    let createdSockets;
    let baileysProvider;
    const internalSecret = 'test_internal_secret_for_engine_selection_999';

    before(async () => {
      mockEnv = createMockMongoDb();
      createdSockets = [];
      const makeSocketFn = () => {
        const sock = createMockBaileysSocket();
        createdSockets.push(sock);
        return sock;
      };

      baileysProvider = new BaileysProvider({
        mongodbUri: 'mongodb://localhost:27017/tuitiondesk_test',
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      const app = createApp(baileysProvider);

      await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const address = server.address();
          baseUrl = `http://127.0.0.1:${address.port}`;
          resolve();
        });
      });
    });

    after(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      if (baileysProvider) {
        await baileysProvider.shutdown();
      }
    });

    it('2.1 GET /health accurately reports Baileys native persistence without exposing credentials', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.service, 'tuitiondesk-whatsapp');
      assert.strictEqual(data.persistence.mode, 'mongodb_native');
      assert.strictEqual(data.persistence.status, 'connected');
      assert.strictEqual(data.persistence.durable, true);
      assert.strictEqual(typeof data.persistence.mongoUri, 'undefined', 'Database URI must not be exposed');
    });

    it('2.2 Rejects requests with 401 when x-internal-secret is missing or invalid', async () => {
      // Missing header
      const resMissing = await fetch(`${baseUrl}/status/center-auth-test`);
      assert.strictEqual(resMissing.status, 401);

      // Invalid header
      const resInvalid = await fetch(`${baseUrl}/status/center-auth-test`, {
        headers: { 'x-internal-secret': 'wrong_secret_value' },
      });
      assert.strictEqual(resInvalid.status, 401);
    });

    it('2.3 GET /status/:centerId returns standard schema matching consumer expectations', async () => {
      const res = await fetch(`${baseUrl}/status/center-parity`, {
        headers: { 'x-internal-secret': internalSecret },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.centerId, 'center-parity');
      assert.strictEqual(data.status, 'disconnected');
      assert.strictEqual(data.ready, false);
      assert.strictEqual(data.qr, null);
      assert.strictEqual(data.hasSavedSession, false);
      assert.strictEqual(data.service, 'WhatsApp Multi-Tenant Automation Microservice');
    });

    it('2.4 POST /init/:centerId idempotently returns QR and status', async () => {
      const res = await fetch(`${baseUrl}/init/center-parity`, {
        method: 'POST',
        headers: { 'x-internal-secret': internalSecret },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.centerId, 'center-parity');
      assert.strictEqual(data.status, 'initializing');
      assert.strictEqual(data.ready, false);
    });

    it('2.5 POST /send-message enforces validation and service availability error codes', async () => {
      // 400 Bad Request on missing fields
      const resMissing = await fetch(`${baseUrl}/send-message`, {
        method: 'POST',
        headers: {
          'x-internal-secret': internalSecret,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ centerId: 'center-parity' }),
      });
      assert.strictEqual(resMissing.status, 400);

      // 503 Service Unavailable when client is not ready
      const resNotReady = await fetch(`${baseUrl}/send-message`, {
        method: 'POST',
        headers: {
          'x-internal-secret': internalSecret,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          centerId: 'center-parity',
          phone: '9876543210',
          message: 'Hello test',
        }),
      });
      assert.strictEqual(resNotReady.status, 503);
    });

    it('2.6 POST /logout/:centerId clears session and returns 200 OK', async () => {
      const res = await fetch(`${baseUrl}/logout/center-parity`, {
        method: 'POST',
        headers: { 'x-internal-secret': internalSecret },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.centerId, 'center-parity');
    });
  });

  /* ------------------------------------------------------------------
   * Group 3: Graceful Shutdown Verification [Mocked]
   * ------------------------------------------------------------------ */
  describe('3. Graceful Shutdown Verification [Mocked]', () => {
    it('3.1 Provider shutdown cleanly destroys all active sockets across centers', async () => {
      const mockEnv = createMockMongoDb();
      const createdSockets = [];
      const makeSocketFn = () => {
        const sock = createMockBaileysSocket();
        createdSockets.push(sock);
        return sock;
      };

      const provider = new BaileysProvider({
        mongooseInstance: mockEnv.mockMongoose,
        makeSocketFn,
      });

      await provider.initializeSession('center-shut-a');
      await provider.initializeSession('center-shut-b');

      assert.strictEqual(createdSockets.length, 2);
      const [sockA, sockB] = createdSockets;

      await provider.shutdown();

      assert.strictEqual(sockA.isEnded, true, 'Socket A must be closed');
      assert.strictEqual(sockB.isEnded, true, 'Socket B must be closed');
      assert.strictEqual(provider.sessions.size, 0, 'Sessions map must be cleared');
    });
  });
});
