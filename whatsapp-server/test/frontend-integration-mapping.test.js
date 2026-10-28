'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Replicates the exact frontend status resolution function from src/app/settings/page.tsx
 * to verify contract mapping between microservice/backend and frontend UI states.
 */
function resolveFrontendStatus(data, lastQrTimestampRef = { current: 0 }) {
  let resolvedStatus = 'disconnected';

  if (data?.status === 'connected' || data?.ready === true) {
    resolvedStatus = 'connected';
  } else if (data?.status === 'authenticated') {
    resolvedStatus = 'authenticated';
  } else if (data?.status === 'qr_ready' && data?.qr) {
    if (
      data.qrGeneratedAt &&
      lastQrTimestampRef.current &&
      data.qrGeneratedAt < lastQrTimestampRef.current
    ) {
      return null; // Stale QR rejected
    }
    if (data.qrGeneratedAt) {
      lastQrTimestampRef.current = data.qrGeneratedAt;
    }
    resolvedStatus = 'qr_ready';
  } else if (data?.status === 'initializing') {
    resolvedStatus = 'initializing';
  } else if (data?.status) {
    resolvedStatus = data.status;
  }

  return {
    status: resolvedStatus,
    hasSavedSession: Boolean(data?.hasSavedSession),
    qr: resolvedStatus === 'qr_ready' ? (data?.qr || null) : null,
    qrGeneratedAt: resolvedStatus === 'qr_ready' ? (data?.qrGeneratedAt || null) : null,
    ready: Boolean(data?.ready || resolvedStatus === 'connected'),
    service: data?.service,
    timestamp: data?.timestamp,
    error: data?.error || undefined,
    engine: data?.engine,
    persistence: data?.persistence,
  };
}

describe('Frontend WhatsApp Integration & Status Mapping Test Suite', () => {
  it('1. Connected session maps to ready: true, status: connected, and removes QR', () => {
    const microservicePayload = {
      success: true,
      centerId: 'center-staging-001',
      status: 'connected',
      hasSavedSession: true,
      qr: null,
      qrGeneratedAt: null,
      ready: true,
      hasClientProcess: true,
      engine: 'baileys_native',
      persistence: 'mongodb_native',
      service: 'WhatsApp Multi-Tenant Automation Microservice',
    };

    const frontendState = resolveFrontendStatus(microservicePayload);
    assert.strictEqual(frontendState.status, 'connected');
    assert.strictEqual(frontendState.ready, true);
    assert.strictEqual(frontendState.qr, null, 'QR must be null in connected state');
    assert.strictEqual(frontendState.hasSavedSession, true);
    assert.strictEqual(frontendState.engine, 'baileys_native');
  });

  it('2. QR Ready session maps to status: qr_ready, ready: false, and preserves QR payload', () => {
    const qrTimestamp = Date.now();
    const microservicePayload = {
      success: true,
      centerId: 'center-staging-001',
      status: 'qr_ready',
      hasSavedSession: false,
      qr: '2@AbCdEf123456,noiseKeyPublic,identityKeyPublic,advSecret',
      qrGeneratedAt: qrTimestamp,
      ready: false,
      hasClientProcess: true,
      engine: 'baileys_native',
      persistence: 'mongodb_native',
    };

    const frontendState = resolveFrontendStatus(microservicePayload);
    assert.strictEqual(frontendState.status, 'qr_ready');
    assert.strictEqual(frontendState.ready, false);
    assert.strictEqual(frontendState.qr, '2@AbCdEf123456,noiseKeyPublic,identityKeyPublic,advSecret');
    assert.strictEqual(frontendState.qrGeneratedAt, qrTimestamp);
  });

  it('3. Stale in-flight polling response with older qrGeneratedAt is rejected and cannot overwrite newer QR', () => {
    const timestampRef = { current: 1730000050000 };
    const stalePayload = {
      status: 'qr_ready',
      qr: 'stale_older_qr_payload',
      qrGeneratedAt: 1730000020000, // Older than current
    };

    const result = resolveFrontendStatus(stalePayload, timestampRef);
    assert.strictEqual(result, null, 'Stale QR must return null to prevent overwriting active QR in UI');
  });

  it('4. Initializing session maps to status: initializing with ready: false and qr: null', () => {
    const microservicePayload = {
      success: true,
      centerId: 'center-staging-001',
      status: 'initializing',
      ready: false,
      qr: null,
      hasClientProcess: true,
    };

    const frontendState = resolveFrontendStatus(microservicePayload);
    assert.strictEqual(frontendState.status, 'initializing');
    assert.strictEqual(frontendState.ready, false);
    assert.strictEqual(frontendState.qr, null);
  });

  it('5. Disconnected session with saved session shows hasSavedSession: true and allows reconnect', () => {
    const microservicePayload = {
      success: true,
      centerId: 'center-staging-001',
      status: 'disconnected',
      hasSavedSession: true,
      ready: false,
      qr: null,
      error: 'WhatsApp session logged out from device',
    };

    const frontendState = resolveFrontendStatus(microservicePayload);
    assert.strictEqual(frontendState.status, 'disconnected');
    assert.strictEqual(frontendState.ready, false);
    assert.strictEqual(frontendState.hasSavedSession, true);
    assert.strictEqual(frontendState.error, 'WhatsApp session logged out from device');
  });

  it('6. Payload security: internal secret is never exposed in client payload', () => {
    const microservicePayload = {
      success: true,
      centerId: 'center-staging-001',
      status: 'connected',
      ready: true,
      qr: null,
      engine: 'baileys_native',
      persistence: 'mongodb_native',
    };

    const frontendState = resolveFrontendStatus(microservicePayload);
    assert.strictEqual('x-internal-secret' in frontendState, false);
    assert.strictEqual('secret' in frontendState, false);
    assert.strictEqual(JSON.stringify(frontendState).includes('secret'), false);
  });

  /**
   * Replicates isLiveDispatchEnabled from src/lib/whatsappService.ts
   */
  function isLiveDispatchEnabled(env) {
    const mode = env.WHATSAPP_MODE?.trim().toLowerCase();
    const liveOptIn = env.ENABLE_LIVE_WHATSAPP?.trim().toLowerCase();
    return mode === 'live' && liveOptIn === 'true';
  }

  it('7. Simulation guard strictly requires BOTH WHATSAPP_MODE=live AND ENABLE_LIVE_WHATSAPP=true', () => {
    // Both missing
    assert.strictEqual(isLiveDispatchEnabled({}), false);
    // NODE_ENV=production alone is NOT sufficient
    assert.strictEqual(isLiveDispatchEnabled({ NODE_ENV: 'production' }), false);
    // Only WHATSAPP_MODE=live
    assert.strictEqual(isLiveDispatchEnabled({ WHATSAPP_MODE: 'live' }), false);
    // Only ENABLE_LIVE_WHATSAPP=true
    assert.strictEqual(isLiveDispatchEnabled({ ENABLE_LIVE_WHATSAPP: 'true' }), false);
    // WHATSAPP_MODE=live but ENABLE_LIVE_WHATSAPP=false
    assert.strictEqual(isLiveDispatchEnabled({ WHATSAPP_MODE: 'live', ENABLE_LIVE_WHATSAPP: 'false' }), false);
    // Both present with matching values
    assert.strictEqual(isLiveDispatchEnabled({ WHATSAPP_MODE: 'live', ENABLE_LIVE_WHATSAPP: 'true' }), true);
    // Handles whitespace and casing safely
    assert.strictEqual(isLiveDispatchEnabled({ WHATSAPP_MODE: ' LIVE ', ENABLE_LIVE_WHATSAPP: ' True ' }), true);
  });

  /**
   * Replicates handleSendTestMessage UI result mapping from src/app/settings/page.tsx
   */
  function mapTestMessageResult(resOk, data, phone) {
    if (data?.simulated) {
      return {
        type: 'warning',
        message: '⚠️ Simulation Mode: Message was simulated (not sent to WhatsApp). Set WHATSAPP_MODE=live and ENABLE_LIVE_WHATSAPP=true in production environment variables to enable live delivery.',
      };
    } else if (resOk && data?.success) {
      return {
        type: 'success',
        message: `✅ Message accepted by WhatsApp network! Message ID: ${data.messageId || 'accepted'}.`,
      };
    } else {
      return {
        type: 'error',
        message: data?.error || 'Failed to send test message. Check if WhatsApp is linked and ready.',
      };
    }
  }

  it('8. UI test-message handler maps simulated response to warning, never false success', () => {
    const simulatedResponse = {
      success: true,
      simulated: true,
      message: '[SIMULATION] Test message recorded',
      accepted: false,
      delivered: false,
    };

    const uiResult = mapTestMessageResult(true, simulatedResponse, '9876543210');
    assert.strictEqual(uiResult.type, 'warning');
    assert.match(uiResult.message, /Simulation Mode/);
    assert.doesNotMatch(uiResult.message, /✅/);
  });

  it('9. UI test-message handler maps real provider send to success with accepted semantics', () => {
    const liveResponse = {
      success: true,
      simulated: false,
      accepted: true,
      delivered: false,
      messageId: 'BAILEYS_12345',
    };

    const uiResult = mapTestMessageResult(true, liveResponse, '9876543210');
    assert.strictEqual(uiResult.type, 'success');
    assert.match(uiResult.message, /accepted by WhatsApp network/);
    assert.match(uiResult.message, /BAILEYS_12345/);
  });

  it('10. UI test-message handler maps microservice failure to error with actionable message', () => {
    const failureResponse = {
      success: false,
      error: "WhatsApp Client for center 'center-test' is not ready. Please scan the QR code in Settings.",
    };

    const uiResult = mapTestMessageResult(false, failureResponse, '9876543210');
    assert.strictEqual(uiResult.type, 'error');
    assert.match(uiResult.message, /not ready/);
  });
});
