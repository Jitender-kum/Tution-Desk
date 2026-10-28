'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

// Set dummy internal secret for test environment before loading modules
process.env.WHATSAPP_INTERNAL_SECRET = 'test_internal_secret_for_contract_suite_12345';

const { formatWhatsAppId } = require('../providers/WWebJSProvider');
const app = require('../index');

describe('TuitionDesk WhatsApp HTTP API Contract & Phone Normalization Suite', () => {
  let server;
  let baseUrl;
  const validSecret = 'test_internal_secret_for_contract_suite_12345';

  before(async () => {
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
  });

  // 1. Phone number normalization unit tests
  describe('Phone Number Normalization (formatWhatsAppId)', () => {
    it('1.1 Normalizes standard 10-digit Indian phone number', () => {
      assert.strictEqual(formatWhatsAppId('9876543210'), '919876543210@c.us');
    });

    it('1.2 Normalizes 12-digit number already prefixed with 91', () => {
      assert.strictEqual(formatWhatsAppId('919876543210'), '919876543210@c.us');
    });

    it('1.3 Normalizes 11-digit number with leading trunk zero', () => {
      assert.strictEqual(formatWhatsAppId('09876543210'), '919876543210@c.us');
    });

    it('1.4 Strips formatting: spaces, dashes, parentheses, plus signs', () => {
      assert.strictEqual(formatWhatsAppId('+91 (98765) 43-210'), '919876543210@c.us');
    });

    it('1.5 Returns null for empty or invalid inputs', () => {
      assert.strictEqual(formatWhatsAppId(''), null);
      assert.strictEqual(formatWhatsAppId(null), null);
      assert.strictEqual(formatWhatsAppId(undefined), null);
    });
  });

  // 2. Public health check endpoint contract
  describe('GET /health (Public Orchestrator Endpoint)', () => {
    it('2.1 Responds with 200 OK without requiring x-internal-secret header', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.service, 'tuitiondesk-whatsapp');
      assert.ok(['ok', 'degraded'].includes(data.status));
      assert.ok(data.persistence, 'persistence metadata must be present');
      assert.ok(['mongodb_remote', 'ephemeral_local'].includes(data.persistence.mode));
      assert.strictEqual(typeof data.persistence.durable, 'boolean');

      // Verify memory diagnostics are present
      assert.ok(data.memory, 'memory metrics must be present');
      assert.strictEqual(typeof data.memory.rssMb, 'number');
      assert.strictEqual(typeof data.memory.heapUsedMb, 'number');
      assert.strictEqual(typeof data.memory.heapTotalMb, 'number');
      assert.strictEqual(typeof data.uptimeSeconds, 'number');
      assert.strictEqual(typeof data.timestamp, 'string');
    });
  });

  // 3. Authentication middleware contract
  describe('Authentication Middleware (x-internal-secret)', () => {
    it('3.1 Rejects request with 401 when x-internal-secret is missing', async () => {
      const res = await fetch(`${baseUrl}/status`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /Missing internal service secret/);
    });

    it('3.2 Rejects request with 401 when x-internal-secret is invalid', async () => {
      const res = await fetch(`${baseUrl}/status`, {
        headers: {
          'x-internal-secret': 'wrong_invalid_secret_value',
        },
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /Invalid internal service secret/);
    });

    it('3.3 Accepts request and returns 200 when x-internal-secret is valid', async () => {
      const res = await fetch(`${baseUrl}/status`, {
        headers: {
          'x-internal-secret': validSecret,
        },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.service, 'WhatsApp Multi-Tenant Automation Microservice');
      assert.ok(data.counts, 'runtime counts must be present');
      assert.ok(Array.isArray(data.sessions), 'sessions array must be present');
    });
  });

  // 4. Center status endpoint contract
  describe('GET /status/:centerId', () => {
    it('4.1 Returns 200 with disconnected schema for uninitialized center', async () => {
      const res = await fetch(`${baseUrl}/status/contract-test-center`, {
        headers: {
          'x-internal-secret': validSecret,
        },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.centerId, 'contract-test-center');
      assert.strictEqual(data.status, 'disconnected');
      assert.strictEqual(typeof data.hasSavedSession, 'boolean');
      assert.strictEqual(data.ready, false);
      assert.strictEqual(data.qr, null);
      assert.strictEqual(data.qrGeneratedAt, null);
      assert.strictEqual(data.service, 'WhatsApp Multi-Tenant Automation Microservice');
      assert.strictEqual(typeof data.timestamp, 'string');
    });
  });

  // 5. Send message validation contract
  describe('POST /send-message (Validation & Routing)', () => {
    it('5.1 Rejects with 400 Bad Request when phone is missing', async () => {
      const res = await fetch(`${baseUrl}/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': validSecret,
        },
        body: JSON.stringify({
          centerId: 'center-val',
          message: 'Hello World',
        }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /Both 'phone' and 'message' are required/);
    });

    it('5.2 Rejects with 400 Bad Request when message is missing', async () => {
      const res = await fetch(`${baseUrl}/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': validSecret,
        },
        body: JSON.stringify({
          centerId: 'center-val',
          phone: '9876543210',
        }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /Both 'phone' and 'message' are required/);
    });

    it('5.3 Returns 503 Service Unavailable when WhatsApp client is not connected', async () => {
      const res = await fetch(`${baseUrl}/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': validSecret,
        },
        body: JSON.stringify({
          centerId: 'unconnected-center',
          phone: '9876543210',
          message: 'Test message',
        }),
      });
      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /is not ready/);
      assert.strictEqual(data.centerId, 'unconnected-center');
      assert.strictEqual(data.status, 'disconnected');
    });
  });

  // 6. Reconnect protection contract
  describe('POST /reconnect/:centerId (Connected Protection Contract)', () => {
    it('6.1 Reconnect refuses operation with 400 when session is active and connected', async () => {
      // Mock an existing connected session in provider memory
      const provider = app.provider;
      provider.sessions.set('connected-center-test', {
        centerId: 'connected-center-test',
        status: 'connected',
        isReady: true,
        client: { destroy: async () => {} },
      });

      const res = await fetch(`${baseUrl}/reconnect/connected-center-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': validSecret,
        },
        body: JSON.stringify({ action: 'new_pairing' }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /Cannot regenerate QR code for an active connected session/);

      // Clean up mock
      provider.sessions.delete('connected-center-test');
    });
  });

  // 7. Explicit logout contract
  describe('POST /logout/:centerId (Logout Contract)', () => {
    it('7.1 Responds with 200 OK when center session is logged out', async () => {
      const res = await fetch(`${baseUrl}/logout/contract-logout-center`, {
        method: 'POST',
        headers: {
          'x-internal-secret': validSecret,
        },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.centerId, 'contract-logout-center');
      assert.ok(data.message);
    });
  });
});
