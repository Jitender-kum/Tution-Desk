const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const BaileysProvider = require('../providers/BaileysProvider');

describe('TuitionDesk WhatsApp Session Recovery & Watchdog Regression Suite', () => {
  // Helper to create mock socket factory
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
      };
      if (onCreated) onCreated(mockSock);
      return mockSock;
    };
  }

  it('1. Recovers from stalled initialization handshake via watchdog timeout', async () => {
    let createdSocket = null;
    const makeSocketFn = createMockSocketFactory((sock) => {
      createdSocket = sock;
    });

    const provider = new BaileysProvider({
      makeSocketFn,
      initWatchdogTimeoutMs: 60, // 60ms fast watchdog for test
      mongooseInstance: { connection: { readyState: 0 } },
    });

    // Mock useAuthState to resolve immediately with in-memory creds
    provider.authStore.useAuthState = async () => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {},
      clearAuth: async () => {},
    });

    const session = await provider.initializeSession('center-9-stall');
    assert.strictEqual(session.status, 'initializing');
    assert.strictEqual(session.ready, false);
    assert.ok(createdSocket, 'Socket should have been created');
    assert.strictEqual(createdSocket.closed, false);

    // Wait for the watchdog to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify state transitioned to disconnected and socket was cleanly destroyed
    const status = await provider.getStatus('center-9-stall');
    assert.strictEqual(status.status, 'disconnected');
    assert.strictEqual(status.ready, false);
    assert.strictEqual(status.hasClientProcess, false);
    assert.ok(status.error && status.error.includes('handshake timed out'));
    assert.strictEqual(createdSocket.closed, true, 'Stalled socket must be closed by watchdog');

    await provider.shutdown();
  });

  it('2. Prevents duplicate socket creation during active initialization', async () => {
    let socketCount = 0;
    const makeSocketFn = createMockSocketFactory(() => {
      socketCount++;
    });

    const provider = new BaileysProvider({
      makeSocketFn,
      initWatchdogTimeoutMs: 5000,
      mongooseInstance: { connection: { readyState: 0 } },
    });

    provider.authStore.useAuthState = async () => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {},
      clearAuth: async () => {},
    });

    const session1 = await provider.initializeSession('center-9-dup');
    assert.strictEqual(session1.status, 'initializing');
    assert.strictEqual(socketCount, 1);

    // Calling initializeSession again should reuse existing without spawning second socket
    const session2 = await provider.initializeSession('center-9-dup');
    assert.strictEqual(session2.status, 'initializing');
    assert.strictEqual(socketCount, 1, 'Must NOT spawn duplicate socket');

    await provider.shutdown();
  });

  it('3. Cancels watchdog cleanly when connection opens or QR arrives', async () => {
    let mockSock = null;
    const makeSocketFn = createMockSocketFactory((sock) => {
      mockSock = sock;
    });

    const provider = new BaileysProvider({
      makeSocketFn,
      initWatchdogTimeoutMs: 60,
      mongooseInstance: { connection: { readyState: 0 } },
    });

    provider.authStore.useAuthState = async () => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {},
      clearAuth: async () => {},
    });

    await provider.initializeSession('center-9-success');
    assert.ok(mockSock);

    // Simulate WhatsApp emitting connection open
    mockSock.ev.emit('connection.update', { connection: 'open' });

    // Wait past the watchdog duration
    await new Promise((resolve) => setTimeout(resolve, 90));

    // Session must remain connected, watchdog was cancelled
    const status = await provider.getStatus('center-9-success');
    assert.strictEqual(status.status, 'connected');
    assert.strictEqual(status.ready, true);
    assert.strictEqual(mockSock.closed, false);

    await provider.shutdown();
  });

  it('4. Reconnect overrides stalled session older than 10s but prevents rapid duplicate clicks', async () => {
    let socketCount = 0;
    const makeSocketFn = createMockSocketFactory(() => {
      socketCount++;
    });

    const provider = new BaileysProvider({
      makeSocketFn,
      initWatchdogTimeoutMs: 30000,
      mongooseInstance: { connection: { readyState: 0 } },
    });

    provider.authStore.useAuthState = async () => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {},
      clearAuth: async () => {},
    });

    await provider.initializeSession('center-9-reconnect');
    assert.strictEqual(socketCount, 1);

    // Rapid duplicate reconnect within <10s throws 409
    await assert.rejects(
      async () => {
        await provider.reconnectSession('center-9-reconnect');
      },
      (err) => err.statusCode === 409
    );

    // Simulate session having stalled 15 seconds ago
    const existing = provider.sessions.get('center-9-reconnect');
    existing.updatedAt = new Date(Date.now() - 15000).toISOString();

    // Now reconnect should succeed, destroying stalled socket and recreating
    const newSession = await provider.reconnectSession('center-9-reconnect');
    assert.strictEqual(newSession.status, 'initializing');
    assert.strictEqual(socketCount, 2, 'Should create replacement socket for stalled session');

    await provider.shutdown();
  });

  it('5. Maintains tenant isolation: stalling one center does not affect another', async () => {
    const sockets = {};
    const makeSocketFn = (options) => {
      const ev = new EventEmitter();
      const s = {
        ev,
        ws: new EventEmitter(),
        end: () => { s.closed = true; },
        closed: false,
      };
      return s;
    };

    const provider = new BaileysProvider({
      makeSocketFn,
      initWatchdogTimeoutMs: 60,
      mongooseInstance: { connection: { readyState: 0 } },
    });

    provider.authStore.useAuthState = async (centerId) => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {},
      clearAuth: async () => {},
    });

    await provider.initializeSession('center-stall-a');
    await provider.initializeSession('center-healthy-b');

    // Make center B healthy immediately
    const bSession = provider.sessions.get('center-healthy-b');
    bSession.sock.ev.emit('connection.update', { connection: 'open' });

    // Wait for center A's watchdog to timeout
    await new Promise((resolve) => setTimeout(resolve, 90));

    const statusA = await provider.getStatus('center-stall-a');
    const statusB = await provider.getStatus('center-healthy-b');

    assert.strictEqual(statusA.status, 'disconnected', 'Center A must be timed out and disconnected');
    assert.strictEqual(statusB.status, 'connected', 'Center B must remain connected and isolated');
    assert.strictEqual(statusB.ready, true);

    await provider.shutdown();
  });

  it('6. Safely catches and handles Baileys CB:success async rejection (e.g. Boom 408 Timed Out)', async () => {
    let mockSock = null;
    let endError = null;

    const makeSocketFn = (options) => {
      const ev = new EventEmitter();
      const ws = new EventEmitter();

      // Simulate Baileys internal async CB:success listener that throws Boom 408
      ws.on('CB:success', async (node) => {
        const boomErr = new Error('Timed Out');
        boomErr.output = { statusCode: 408 };
        throw boomErr;
      });

      const s = {
        ev,
        ws,
        end: (err) => {
          s.closed = true;
          endError = err;
          // In Baileys, end() emits connection.update close with the error
          ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: err },
          });
        },
        closed: false,
      };
      mockSock = s;
      return s;
    };

    let unhandledRejectionFired = false;
    const tempListener = (reason) => {
      unhandledRejectionFired = true;
    };
    process.on('unhandledRejection', tempListener);

    try {
      const provider = new BaileysProvider({
        makeSocketFn,
        initWatchdogTimeoutMs: 10000,
        mongooseInstance: { connection: { readyState: 0 } },
      });

      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: false }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      await provider.initializeSession('center-9-cbsuccess-err');
      assert.ok(mockSock);

      // Trigger the CB:success stanza received from WhatsApp
      mockSock.ws.emit('CB:success', { tag: 'success' });

      // Allow async tick for rejection and wrapper to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assertions
      assert.strictEqual(unhandledRejectionFired, false, 'Rejection MUST be caught cleanly and NOT hit unhandledRejection');
      assert.strictEqual(mockSock.closed, true, 'Socket MUST be ended on CB:success rejection');
      assert.ok(endError && endError.message.includes('Timed Out'), 'end() must receive the timeout error');

      const status = await provider.getStatus('center-9-cbsuccess-err');
      assert.strictEqual(status.status, 'disconnected', 'Session MUST transition to disconnected');
      assert.strictEqual(status.ready, false);
      assert.ok(status.error && status.error.includes('Timed Out'));

      await provider.shutdown();
    } finally {
      process.removeListener('unhandledRejection', tempListener);
    }
  });

  it('7. Preserves original EventEmitter this context (this === sock.ws) and normal connection succeeds', async () => {
    let mockSock = null;
    let capturedThis = null;

    const makeSocketFn = (options) => {
      const ev = new EventEmitter();
      const ws = new EventEmitter();

      // Register standard function to check `this` binding
      ws.on('CB:success', async function (node) {
        capturedThis = this;
        ev.emit('connection.update', { connection: 'open' });
      });

      const s = {
        ev,
        ws,
        end: () => { s.closed = true; },
        closed: false,
      };
      mockSock = s;
      return s;
    };

    const provider = new BaileysProvider({
      makeSocketFn,
      initWatchdogTimeoutMs: 10000,
      mongooseInstance: { connection: { readyState: 0 } },
    });

    provider.authStore.useAuthState = async () => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {},
      clearAuth: async () => {},
    });

    await provider.initializeSession('center-9-cbsuccess-this');
    assert.ok(mockSock);

    // Trigger normal CB:success
    mockSock.ws.emit('CB:success', { tag: 'success' });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert that `this` inside the original listener was strictly sock.ws
    assert.strictEqual(
      capturedThis,
      mockSock.ws,
      'Original listener MUST receive `this === sock.ws` preserved via listener.apply(sock.ws, args)'
    );

    const status = await provider.getStatus('center-9-cbsuccess-this');
    assert.strictEqual(status.status, 'connected');
    assert.strictEqual(status.ready, true);
    assert.strictEqual(mockSock.closed, false);

    await provider.shutdown();
  });

  it('8. Cleanup error resilience: sock.end() and sock.ws.close() throwing does not escape or trigger unhandled rejection', async () => {
    let mockSock = null;
    let endCalled = false;
    let closeCalled = false;

    const makeSocketFn = (options) => {
      const ev = new EventEmitter();
      const ws = new EventEmitter();
      ws.close = () => {
        closeCalled = true;
        throw new Error('Fatal socket close error');
      };

      // Listener that fails with handshake timeout
      ws.on('CB:success', async () => {
        const boomErr = new Error('Timed Out');
        boomErr.output = { statusCode: 408 };
        throw boomErr;
      });

      const s = {
        ev,
        ws,
        end: () => {
          endCalled = true;
          throw new Error('Fatal socket end error');
        },
        closed: false,
      };
      mockSock = s;
      return s;
    };

    let unhandledRejectionFired = false;
    let caughtUnhandledError = null;
    const tempListener = (reason) => {
      unhandledRejectionFired = true;
      caughtUnhandledError = reason;
    };
    process.on('unhandledRejection', tempListener);

    try {
      const provider = new BaileysProvider({
        makeSocketFn,
        initWatchdogTimeoutMs: 10000,
        mongooseInstance: { connection: { readyState: 0 } },
      });

      provider.authStore.useAuthState = async () => ({
        state: { creds: { registered: false }, keys: {} },
        saveCreds: async () => {},
        clearAuth: async () => {},
      });

      await provider.initializeSession('center-9-cleanup-throw');
      assert.ok(mockSock);

      // Trigger CB:success which rejects, then cleanup throws
      mockSock.ws.emit('CB:success', { tag: 'success' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(endCalled, true, 'sock.end() must have been attempted');
      assert.strictEqual(closeCalled, true, 'sock.ws.close() fallback must have been attempted when sock.end threw');
      assert.strictEqual(
        unhandledRejectionFired,
        false,
        `No unhandled rejection must escape when cleanup throws: ${caughtUnhandledError?.message}`
      );

      await provider.shutdown();
    } finally {
      process.removeListener('unhandledRejection', tempListener);
    }
  });

  it('9. Tenant isolation: CB:success rejection on Center A does not affect Center B (native initialization)', async () => {
    let socketMap = {};

    const makeSocketFn = (options) => {
      const ev = new EventEmitter();
      const ws = new EventEmitter();
      const s = {
        ev,
        ws,
        end: (err) => {
          s.closed = true;
          ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: err },
          });
        },
        closed: false,
      };

      // Center A gets a failing CB:success registered in makeSocket
      // Center B gets a normal CB:success registered in makeSocket
      if (!socketMap['center-isolate-a']) {
        socketMap['center-isolate-a'] = s;
        ws.on('CB:success', async () => {
          const err = new Error('Timed Out');
          err.output = { statusCode: 408 };
          throw err;
        });
      } else {
        socketMap['center-isolate-b'] = s;
        ws.on('CB:success', async () => {
          ev.emit('connection.update', { connection: 'open' });
        });
      }

      return s;
    };

    const provider = new BaileysProvider({
      makeSocketFn,
      initWatchdogTimeoutMs: 10000,
      mongooseInstance: { connection: { readyState: 0 } },
    });

    provider.authStore.useAuthState = async (centerId) => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {},
      clearAuth: async () => {},
    });

    // Initialize both sessions natively — BaileysProvider wraps each socket individually
    await provider.initializeSession('center-isolate-a');
    await provider.initializeSession('center-isolate-b');

    const sessionA = provider.sessions.get('center-isolate-a');
    const sessionB = provider.sessions.get('center-isolate-b');

    // Trigger both native sockets
    sessionA.sock.ws.emit('CB:success', {});
    sessionB.sock.ws.emit('CB:success', {});

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusA = await provider.getStatus('center-isolate-a');
    const statusB = await provider.getStatus('center-isolate-b');

    assert.strictEqual(statusA.status, 'disconnected', 'Center A must be disconnected due to timeout');
    assert.strictEqual(statusB.status, 'connected', 'Center B must be connected and ready');
    assert.strictEqual(statusB.ready, true);

    await provider.shutdown();
  });
});
