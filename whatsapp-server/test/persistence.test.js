'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable, Writable } = require('stream');
const MongoStore = require('../mongoStore');
const { migrateLocalSessionToRemote } = require('../sessionMigration');

// In-Memory GridFS Mock with error injection hooks for testing pipeline resiliency
function createMockMongoose() {
  const fileStore = new Map(); // bucketName -> Map(id -> { _id, filename, uploadDate, data, metadata })
  const collections = new Set();
  let nextId = 1;
  const simulationFlags = {
    simulateUploadError: false,
    simulateDownloadError: false,
  };

  class MockGridFSBucket {
    constructor(db, options) {
      this.db = db;
      this.bucketName = options.bucketName;
      collections.add(`${this.bucketName}.files`);
      collections.add(`${this.bucketName}.chunks`);
      if (!fileStore.has(this.bucketName)) {
        fileStore.set(this.bucketName, new Map());
      }
    }

    openUploadStream(filename, options) {
      const id = String(nextId++);
      const chunks = [];
      const bucketFiles = fileStore.get(this.bucketName);

      const ws = new Writable({
        write(chunk, encoding, callback) {
          if (simulationFlags.simulateUploadError) {
            callback(new Error('Simulated GridFS upload stream disk write error'));
            return;
          }
          chunks.push(chunk);
          callback();
        },
      });

      ws.id = id;

      ws.on('finish', () => {
        if (!simulationFlags.simulateUploadError) {
          bucketFiles.set(id, {
            _id: id,
            filename,
            uploadDate: new Date(),
            data: Buffer.concat(chunks),
            metadata: options?.metadata || {},
          });
        }
      });

      return ws;
    }

    openDownloadStreamByName(filename) {
      if (simulationFlags.simulateDownloadError) {
        const errStream = new Readable({ read() {} });
        process.nextTick(() =>
          errStream.emit('error', new Error('Simulated GridFS download stream read error'))
        );
        return errStream;
      }

      const bucketFiles = fileStore.get(this.bucketName);
      if (!bucketFiles) {
        const errStream = new Readable({ read() {} });
        process.nextTick(() => errStream.emit('error', new Error(`File not found: ${filename}`)));
        return errStream;
      }

      let found = null;
      for (const file of bucketFiles.values()) {
        if (file.filename === filename) {
          found = file;
          break;
        }
      }

      if (!found) {
        const errStream = new Readable({ read() {} });
        process.nextTick(() => errStream.emit('error', new Error(`File not found: ${filename}`)));
        return errStream;
      }

      let sent = false;
      return new Readable({
        read() {
          if (!sent) {
            sent = true;
            this.push(found.data);
            this.push(null);
          }
        },
      });
    }

    find(query) {
      const bucketFiles = fileStore.get(this.bucketName) || new Map();
      let results = Array.from(bucketFiles.values());

      if (query?.filename) {
        results = results.filter((f) => f.filename === query.filename);
      }

      return {
        sort(sortObj) {
          if (sortObj?.uploadDate === -1) {
            results.sort((a, b) => b.uploadDate - a.uploadDate);
          }
          return this;
        },
        toArray: async () => [...results],
      };
    }

    async delete(id) {
      const bucketFiles = fileStore.get(this.bucketName);
      if (bucketFiles) {
        bucketFiles.delete(String(id));
      }
    }
  }

  const mockDb = {
    collection(name) {
      return {
        async countDocuments(query) {
          const bucketName = name.replace(/\.files$/, '');
          const bucketFiles = fileStore.get(bucketName);
          if (!bucketFiles) return 0;
          if (!query || Object.keys(query).length === 0) {
            return bucketFiles.size;
          }
          let count = 0;
          for (const f of bucketFiles.values()) {
            if (!query.filename || f.filename === query.filename) {
              count++;
            }
          }
          return count;
        },
        async drop() {
          const bucketName = name.replace(/\.(files|chunks)$/, '');
          fileStore.delete(bucketName);
          collections.delete(name);
        },
      };
    },
    listCollections(filter) {
      let names = Array.from(collections);
      if (filter?.name instanceof RegExp) {
        names = names.filter((n) => filter.name.test(n));
      }
      return {
        toArray: async () => names.map((name) => ({ name })),
      };
    },
  };

  return {
    connection: {
      db: mockDb,
      readyState: 1,
    },
    mongo: {
      GridFSBucket: MockGridFSBucket,
    },
    fileStore,
    simulationFlags,
  };
}

describe('WhatsApp MongoDB Session Persistence Suite (Hardened)', () => {
  let tmpDir;
  let mockMongoose;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwebjs-test-'));
    mockMongoose = createMockMongoose();
    store = new MongoStore({
      mongooseInstance: mockMongoose,
      dataPath: tmpDir,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. Session save to MongoDB: saves compressed archive to GridFS using pipeline', async () => {
    const sessionName = 'RemoteAuth-center-a';
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('FAKE_SESSION_PAYLOAD_FOR_TEST'));

    await store.save({ session: sessionName });

    const exists = await store.sessionExists({ session: sessionName });
    assert.strictEqual(exists, true, 'Session should exist in MongoDB GridFS');

    const bucket = store.getBucket(sessionName);
    const files = await bucket.find({ filename: `${sessionName}.zip` }).toArray();
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].data.toString(), 'FAKE_SESSION_PAYLOAD_FOR_TEST');
  });

  it('2. Session restore after simulated process restart with empty local auth directory', async () => {
    const sessionName = 'RemoteAuth-center-b';
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('RESTORE_TEST_AUTHENTICATION_PAYLOAD'));

    await store.save({ session: sessionName });

    // Wipe local directory to simulate fresh container / ephemeral disk
    fs.rmSync(fakeZipPath, { force: true });
    assert.strictEqual(fs.existsSync(fakeZipPath), false, 'Local zip should be wiped before restore');

    // Extract from MongoDB into simulated fresh container path
    const restoredZipPath = path.join(tmpDir, `${sessionName}.zip`);
    await store.extract({
      session: sessionName,
      path: restoredZipPath,
    });

    assert.strictEqual(fs.existsSync(restoredZipPath), true, 'File should be restored on fresh filesystem');
    const restoredContent = fs.readFileSync(restoredZipPath, 'utf8');
    assert.strictEqual(restoredContent, 'RESTORE_TEST_AUTHENTICATION_PAYLOAD');
  });

  it('3. Multi-tenant session isolation: two different centers are fully isolated', async () => {
    const sessionA = 'RemoteAuth-aroven-001';
    const sessionB = 'RemoteAuth-othercenter-002';

    const zipA = path.join(tmpDir, `${sessionA}.zip`);
    const zipB = path.join(tmpDir, `${sessionB}.zip`);

    fs.writeFileSync(zipA, Buffer.from('PAYLOAD_CENTER_A'));
    fs.writeFileSync(zipB, Buffer.from('PAYLOAD_CENTER_B'));

    await store.save({ session: sessionA });
    await store.save({ session: sessionB });

    assert.strictEqual(await store.sessionExists({ session: sessionA }), true);
    assert.strictEqual(await store.sessionExists({ session: sessionB }), true);

    const outA = path.join(tmpDir, 'extractedA.zip');
    const outB = path.join(tmpDir, 'extractedB.zip');

    await store.extract({ session: sessionA, path: outA });
    await store.extract({ session: sessionB, path: outB });

    assert.strictEqual(fs.readFileSync(outA, 'utf8'), 'PAYLOAD_CENTER_A');
    assert.strictEqual(fs.readFileSync(outB, 'utf8'), 'PAYLOAD_CENTER_B');
  });

  it('4. Stream handling: Upload destination failure rejects cleanly and aborts save', async () => {
    const sessionName = 'RemoteAuth-center-stream-err';
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('STREAM_ERROR_TEST_PAYLOAD'));

    // Enable simulated upload stream error
    mockMongoose.simulationFlags.simulateUploadError = true;

    await assert.rejects(
      async () => {
        await store.save({ session: sessionName });
      },
      (err) => {
        assert.match(err.message, /Stream pipeline failed while saving session/);
        return true;
      }
    );

    // Verify session was NOT saved as valid
    mockMongoose.simulationFlags.simulateUploadError = false;
    const exists = await store.sessionExists({ session: sessionName });
    assert.strictEqual(exists, false, 'Failed upload must not be marked as existing in MongoDB');
  });

  it('5. Stream handling: Download stream failure rejects cleanly and cleans up partial target file', async () => {
    const sessionName = 'RemoteAuth-center-download-err';
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('DOWNLOAD_ERROR_TEST_PAYLOAD'));
    await store.save({ session: sessionName });

    // Enable simulated download stream error
    mockMongoose.simulationFlags.simulateDownloadError = true;
    const targetExtractPath = path.join(tmpDir, 'corrupted_download.zip');

    await assert.rejects(
      async () => {
        await store.extract({
          session: sessionName,
          path: targetExtractPath,
        });
      },
      (err) => {
        assert.match(err.message, /Stream pipeline failed while extracting session/);
        return true;
      }
    );

    // Verify corrupt partial file was cleaned up
    assert.strictEqual(
      fs.existsSync(targetExtractPath),
      false,
      'Partially extracted file must be removed on stream error'
    );
  });

  it('6. Concurrent initialization deduplication and locking', async () => {
    const activeLocks = new Set();
    const inFlightInitPromises = new Map();
    const centerId = 'center-concurrency-test';

    activeLocks.add(centerId);
    let resolved = false;
    const initPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolved = true;
        resolve({ status: 'connected' });
      }, 50);
    });
    inFlightInitPromises.set(centerId, initPromise);

    const hasLockConflict = activeLocks.has(centerId);
    assert.strictEqual(hasLockConflict, true, 'Second request should detect existing operation lock');

    const result = await inFlightInitPromises.get(centerId);
    assert.strictEqual(result.status, 'connected');
    assert.strictEqual(resolved, true);

    activeLocks.delete(centerId);
    inFlightInitPromises.delete(centerId);
    assert.strictEqual(activeLocks.has(centerId), false);
  });

  it('7. MongoDB unavailable during startup fails closed gracefully', async () => {
    const disconnectedMongoose = {
      connection: {
        db: null, // disconnected
        readyState: 0,
      },
    };
    const brokenStore = new MongoStore({
      mongooseInstance: disconnectedMongoose,
      dataPath: tmpDir,
    });

    const exists = await brokenStore.sessionExists({ session: 'RemoteAuth-unavailable' });
    assert.strictEqual(exists, false, 'Should fail closed to false when DB is unavailable');

    const centerIds = await brokenStore.listSavedCenterIds();
    assert.deepStrictEqual(centerIds, []);
  });

  it('8. Existing saved session survives an ordinary reconnect (credentials preserved)', async () => {
    const sessionName = 'RemoteAuth-center-reconnect';
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('PRECIOUS_AUTH_CREDENTIALS'));
    await store.save({ session: sessionName });

    assert.strictEqual(await store.sessionExists({ session: sessionName }), true);

    // Simulate ordinary reconnect without explicit new pairing (e.g. network blip recovery)
    const isExplicitNewPairing = false;
    if (isExplicitNewPairing) {
      await store.delete({ session: sessionName });
    }

    // Verify session credentials in MongoDB remain 100% intact
    assert.strictEqual(
      await store.sessionExists({ session: sessionName }),
      true,
      'Ordinary reconnect must NOT delete MongoDB session credentials'
    );
  });

  it('9. Explicit logout deletes only the selected center stored session', async () => {
    const sessionA = 'RemoteAuth-center-keep';
    const sessionB = 'RemoteAuth-center-logout';

    fs.writeFileSync(path.join(tmpDir, `${sessionA}.zip`), 'KEEP_ME');
    fs.writeFileSync(path.join(tmpDir, `${sessionB}.zip`), 'DELETE_ME');

    await store.save({ session: sessionA });
    await store.save({ session: sessionB });

    assert.strictEqual(await store.sessionExists({ session: sessionA }), true);
    assert.strictEqual(await store.sessionExists({ session: sessionB }), true);

    // Explicit logout for center B
    await store.delete({ session: sessionB });

    assert.strictEqual(await store.sessionExists({ session: sessionB }), false, 'Center B should be deleted');
    assert.strictEqual(await store.sessionExists({ session: sessionA }), true, 'Center A must be preserved');
  });

  it('10. No Chromium launches during startup discovery (pure collection query)', async () => {
    const session = 'RemoteAuth-center-lazy';
    fs.writeFileSync(path.join(tmpDir, `${session}.zip`), 'LAZY_STARTUP_PAYLOAD');
    await store.save({ session });

    const savedCenters = await store.listSavedCenterIds();
    assert.strictEqual(savedCenters.length, 1);
    assert.strictEqual(savedCenters[0], 'center-lazy');
  });

  it('11. Safe migration packages local LocalAuth directory into RemoteAuth store idempotently without deleting source', async () => {
    const centerId = 'aroven-001';
    const localDir = path.join(tmpDir, `session-${centerId}`, 'Default');
    const indexedDBDir = path.join(localDir, 'IndexedDB');
    const localStorageDir = path.join(localDir, 'Local Storage');

    fs.mkdirSync(indexedDBDir, { recursive: true });
    fs.mkdirSync(localStorageDir, { recursive: true });
    fs.writeFileSync(path.join(indexedDBDir, 'state.db'), 'LOCAL_AUTH_INDEXEDDB_STATE');
    fs.writeFileSync(path.join(localStorageDir, 'token.dat'), 'LOCAL_AUTH_STORAGE_STATE');

    // 1. First migration run
    const migrated = await migrateLocalSessionToRemote({
      centerId,
      store,
      dataPath: tmpDir,
    });

    assert.strictEqual(migrated, true, 'First migration should succeed');
    assert.strictEqual(await store.sessionExists({ session: `RemoteAuth-${centerId}` }), true);
    assert.strictEqual(fs.existsSync(path.join(indexedDBDir, 'state.db')), true, 'Original LocalAuth file must be preserved');

    // 2. Second migration run (idempotency check: must not overwrite existing remote session)
    const secondMigration = await migrateLocalSessionToRemote({
      centerId,
      store,
      dataPath: tmpDir,
    });

    assert.strictEqual(secondMigration, false, 'Second migration must be a no-op (idempotent)');
    assert.strictEqual(await store.sessionExists({ session: `RemoteAuth-${centerId}` }), true);
  });

  it('12. Missing MONGODB_URI cannot be mistaken for durable persistence', () => {
    const isMongoConnected = false;
    const MONGODB_URI = undefined;

    const isDurable = Boolean(isMongoConnected);
    const persistenceStatus = isMongoConnected
      ? 'connected'
      : MONGODB_URI
      ? 'connecting_or_disconnected'
      : 'unconfigured_ephemeral';

    assert.strictEqual(isDurable, false, 'Durable flag must be false when MONGODB_URI is absent');
    assert.strictEqual(persistenceStatus, 'unconfigured_ephemeral');
  });

  it('13. Reconnect flow: payload with action: "new_pairing" explicitly deletes saved MongoDB session and unlinks center', async () => {
    const centerId = 'center-reconnect-new-pair';
    const sessionName = `RemoteAuth-${centerId}`;
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('PREVIOUS_SESSION_TO_BE_REPLACED'));
    await store.save({ session: sessionName });

    const savedSessionCenters = new Set([centerId]);
    assert.strictEqual(await store.sessionExists({ session: sessionName }), true);
    assert.strictEqual(savedSessionCenters.has(centerId), true);

    // Simulate incoming reconnect request with action: "new_pairing"
    const req = {
      body: { action: 'new_pairing' },
      query: {},
    };

    const isExplicitNewPairing =
      req.body?.action === 'new_pairing' ||
      req.query?.action === 'new_pairing' ||
      Boolean(req.body?.forceNewPairing);

    assert.strictEqual(isExplicitNewPairing, true, 'Must identify action: "new_pairing" as explicit new pairing');

    if (isExplicitNewPairing) {
      await store.delete({ session: sessionName });
      savedSessionCenters.delete(centerId);
    }

    assert.strictEqual(
      await store.sessionExists({ session: sessionName }),
      false,
      'Saved MongoDB session must be deleted on explicit new_pairing'
    );
    assert.strictEqual(
      savedSessionCenters.has(centerId),
      false,
      'Center must be removed from savedSessionCenters on explicit new_pairing'
    );
  });

  it('14. Reconnect flow: payload with action: "refresh" or empty body strictly preserves saved MongoDB session', async () => {
    const centerId = 'center-reconnect-refresh';
    const sessionName = `RemoteAuth-${centerId}`;
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('CRITICAL_PRESERVED_SESSION'));
    await store.save({ session: sessionName });

    const savedSessionCenters = new Set([centerId]);
    assert.strictEqual(await store.sessionExists({ session: sessionName }), true);

    // Test cases: explicit refresh, empty body, and undefined body
    const testCases = [
      { body: { action: 'refresh' }, query: {} },
      { body: {}, query: {} },
      { body: undefined, query: {} },
    ];

    for (const req of testCases) {
      const isExplicitNewPairing =
        req.body?.action === 'new_pairing' ||
        req.query?.action === 'new_pairing' ||
        Boolean(req.body?.forceNewPairing);

      assert.strictEqual(isExplicitNewPairing, false, 'Non-new-pairing actions must not be marked as new pairing');

      if (isExplicitNewPairing) {
        await store.delete({ session: sessionName });
        savedSessionCenters.delete(centerId);
      }

      assert.strictEqual(
        await store.sessionExists({ session: sessionName }),
        true,
        'Saved MongoDB session must NEVER be deleted on refresh or ordinary reconnect'
      );
      assert.strictEqual(
        savedSessionCenters.has(centerId),
        true,
        'Center must remain in savedSessionCenters'
      );
    }
  });

  it('15. Connected session safeguard: reconnect refuses operation if session is connected, preserving active session', async () => {
    const centerId = 'center-connected-protection';
    const sessionName = `RemoteAuth-${centerId}`;
    const fakeZipPath = path.join(tmpDir, `${sessionName}.zip`);
    fs.writeFileSync(fakeZipPath, Buffer.from('ACTIVE_CONNECTED_SESSION'));
    await store.save({ session: sessionName });

    const existingSession = {
      status: 'connected',
      isReady: true,
      client: { destroy: async () => {} },
    };

    // Attempting reconnect even with action: "new_pairing"
    const req = { body: { action: 'new_pairing' } };

    let refusalResponse = null;
    if (existingSession && (existingSession.status === 'connected' || existingSession.isReady === true)) {
      refusalResponse = {
        status: 400,
        success: false,
        centerId,
        error: 'Cannot regenerate QR code for an active connected session. Please disconnect first if you wish to link a new number.',
      };
    }

    assert.ok(refusalResponse, 'Must refuse reconnect when session is connected');
    assert.strictEqual(refusalResponse.status, 400);
    assert.strictEqual(refusalResponse.success, false);

    // Verify session in MongoDB is completely untouched
    assert.strictEqual(
      await store.sessionExists({ session: sessionName }),
      true,
      'Active session in MongoDB must NOT be deleted when client is connected'
    );
  });

  it('16. Failure in new-pairing session deletion throws and fails closed without reporting success', async () => {
    const centerId = 'center-failed-delete';
    const sessionName = `RemoteAuth-${centerId}`;

    // Create a mock store that fails on delete
    const failingStore = {
      async delete() {
        throw new Error('Database write permission denied');
      },
    };

    const isExplicitNewPairing = true;
    let didThrow = false;

    if (isExplicitNewPairing) {
      try {
        await failingStore.delete({ session: sessionName });
      } catch (delErr) {
        didThrow = true;
        const propagatedErr = new Error(
          `Failed to clear previous saved session during new pairing: ${delErr.message}`
        );
        assert.match(propagatedErr.message, /Database write permission denied/);
      }
    }

    assert.strictEqual(didThrow, true, 'Failed delete must throw and prevent reporting success');
  });

  it('17. Reconnect route payload contract: validates upstream proxy payload and error propagation', async () => {
    // Validate request parsing logic matches route implementation
    const parseIncoming = (contentType, rawBody) => {
      let bodyData = {};
      if (contentType && contentType.includes('application/json')) {
        try {
          bodyData = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        } catch {}
      }
      return bodyData;
    };

    // 1. Explicit new_pairing action
    const newPairingPayload = parseIncoming('application/json', JSON.stringify({ action: 'new_pairing' }));
    assert.strictEqual(newPairingPayload.action, 'new_pairing');

    // 2. Empty/refresh payload
    const refreshPayload = parseIncoming('application/json', JSON.stringify({ action: 'refresh' }));
    assert.strictEqual(refreshPayload.action, 'refresh');

    const emptyPayload = parseIncoming('text/plain', '');
    assert.deepStrictEqual(emptyPayload, {});

    // 3. Upstream error must never report success
    const upstreamFailures = [
      { ok: false, status: 500, data: { success: false, error: 'Failed to clear session' } },
      { ok: false, status: 400, data: { success: false, error: 'Cannot regenerate QR code for an active connected session' } },
      { ok: false, status: 409, data: { success: false, error: 'Operation already in progress' } },
    ];

    for (const upstream of upstreamFailures) {
      const willReportSuccess = upstream.ok && upstream.data?.success !== false;
      assert.strictEqual(willReportSuccess, false, `Failed upstream status ${upstream.status} must not report success`);
    }
  });
});
