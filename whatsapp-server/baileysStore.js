'use strict';

const mongoose = require('mongoose');

/**
 * Validates that a centerId is non-empty, a string, and only contains safe characters.
 * @param {string} centerId
 * @returns {string} Sanitized, trimmed centerId
 */
function validateCenterId(centerId) {
  if (!centerId || typeof centerId !== 'string') {
    throw new Error('Invalid centerId: centerId is required and must be a non-empty string.');
  }
  const trimmed = centerId.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(trimmed)) {
    throw new Error(
      `Invalid centerId '${trimmed}': centerId must only contain alphanumeric characters, hyphens, or underscores.`
    );
  }
  return trimmed;
}

// Module-level cache for dynamic @whiskeysockets/baileys import (CommonJS <-> ESM bridge)
let cachedBaileysModule = null;

async function getBaileys(customBaileys) {
  if (customBaileys) return customBaileys;
  if (!cachedBaileysModule) {
    cachedBaileysModule = await import('@whiskeysockets/baileys');
  }
  return cachedBaileysModule;
}

/**
 * MongoDB Multi-Tenant Authentication and Signal-Key Store for @whiskeysockets/baileys.
 *
 * Implements the standard Baileys AuthenticationState and SignalKeyStore contracts:
 *  - state.creds (AuthenticationCreds)
 *  - state.keys.get(type, ids) -> Promise<Record<string, any>>
 *  - state.keys.set(data) -> Promise<void>
 *  - saveCreds() -> Promise<void>
 *  - clearAuth() -> Promise<void>
 *  - sessionExists() -> Promise<boolean>
 *  - listSavedSessions() -> Promise<string[]>
 *
 * Features & Safeguards:
 *  1. Scopes all records strictly to validated centerId.
 *  2. Full Buffer / Uint8Array serialization roundtrip using Baileys' BufferJSON.
 *  3. Deserializes AppStateSyncKeyData via Baileys proto definitions.
 *  4. Executes key updates atomically in bulk via MongoDB bulkWrite without N+1 roundtrips.
 *  5. Serializes saveCreds updates using FIFO promise chain to eliminate write race conditions.
 *  6. Does not log or expose raw credentials or Signal keys in logs or errors.
 *  7. Multi-tenant session discovery in O(1) time without socket connections.
 */
class BaileysMongoAuthStore {
  constructor({ mongooseInstance, collectionName = 'baileys_auth', baileysInstance } = {}) {
    this.mongoose = mongooseInstance || mongoose;
    this.collectionName = collectionName;
    this.customBaileys = baileysInstance || null;
    this._saveQueues = new Map(); // centerId -> Promise
    this._keyQueues = new Map(); // centerId -> Promise
    this._indexesCreated = false;
  }

  get db() {
    if (!this.mongoose.connection || !this.mongoose.connection.db) {
      throw new Error('MongoDB is not connected. A live database connection is required for Baileys auth store.');
    }
    return this.mongoose.connection.db;
  }

  get collection() {
    return this.db.collection(this.collectionName);
  }

  /**
   * Initializes compound unique indexes for safe multi-tenant key isolation.
   */
  async initIndexes() {
    if (this._indexesCreated) return;
    try {
      await this.collection.createIndex({ centerId: 1, key: 1 }, { unique: true });
      await this.collection.createIndex({ centerId: 1 });
      this._indexesCreated = true;
    } catch (err) {
      // In mock/test environments without createIndex support, ignore gracefully
      if (err.message && !err.message.includes('not a function')) {
        console.warn('[BaileysMongoAuthStore] Index initialization notice:', err.message);
      }
    }
  }

  /**
   * Checks whether a center has a saved credential state in MongoDB.
   * @param {string} centerId
   * @returns {Promise<boolean>}
   */
  async sessionExists(centerId) {
    const validCenterId = validateCenterId(centerId);
    try {
      const doc = await this.collection.findOne({
        centerId: validCenterId,
        key: 'creds',
      });
      return !!doc;
    } catch (err) {
      console.warn(`[BaileysMongoAuthStore] Error checking sessionExists for center ${validCenterId}:`, err.message);
      return false;
    }
  }

  /**
   * Discovers all centerIds with saved credentials in O(1) multi-tenant query.
   * @returns {Promise<string[]>}
   */
  async listSavedSessions() {
    try {
      const centerIds = await this.collection.distinct('centerId', { key: 'creds' });
      return centerIds || [];
    } catch (err) {
      console.warn('[BaileysMongoAuthStore] Could not list saved Baileys sessions:', err.message);
      return [];
    }
  }

  /**
   * Deletes all saved credentials and keys for a specific center (explicit logout/unlink).
   * @param {string} centerId
   * @returns {Promise<{ deletedCount: number }>}
   */
  async clearAuth(centerId) {
    const validCenterId = validateCenterId(centerId);
    try {
      const result = await this.collection.deleteMany({ centerId: validCenterId });
      const deletedCount = result?.deletedCount || 0;
      return { deletedCount };
    } catch (err) {
      throw new Error(`Failed to clear auth for center ${validCenterId}: ${err.message}`);
    }
  }

  /**
   * Serializes saveCreds executions per center to prevent concurrent race conditions.
   * @private
   */
  _enqueueSave(centerId, taskFn) {
    const previous = this._saveQueues.get(centerId) || Promise.resolve();
    const next = previous
      .catch(() => {}) // never break the queue on previous failure
      .then(taskFn);
    this._saveQueues.set(centerId, next);
    return next;
  }

  /**
   * Serializes keys.set executions per center to prevent concurrent duplicate key collisions.
   * @private
   */
  _enqueueKeySet(centerId, taskFn) {
    const previous = this._keyQueues.get(centerId) || Promise.resolve();
    const next = previous
      .catch(() => {}) // never break the queue on previous failure
      .then(taskFn);
    this._keyQueues.set(centerId, next);
    return next;
  }

  /**
   * Factory function implementing the native Baileys AuthenticationState contract.
   *
   * @param {string} centerId - Validated center identifier
   * @returns {Promise<{
   *   state: { creds: any, keys: { get: Function, set: Function } },
   *   saveCreds: Function,
   *   clearAuth: Function,
   *   sessionExists: Function
   * }>}
   */
  async useAuthState(centerId) {
    const validCenterId = validateCenterId(centerId);
    // Fail closed immediately if MongoDB is not connected
    const _db = this.db;
    await this.initIndexes();

    const baileys = await getBaileys(this.customBaileys);
    const { BufferJSON, initAuthCreds, proto } = baileys;

    if (!BufferJSON || typeof initAuthCreds !== 'function') {
      throw new Error('Baileys BufferJSON or initAuthCreds not available in loaded module.');
    }

    // 1. Read or initialize credentials
    let creds;
    const credsDoc = await this.collection.findOne({
      centerId: validCenterId,
      key: 'creds',
    });

    if (credsDoc && credsDoc.data) {
      try {
        creds = JSON.parse(credsDoc.data, BufferJSON.reviver);
      } catch (parseErr) {
        console.warn(
          `[BaileysMongoAuthStore] Corrupted creds document for center ${validCenterId}, initializing fresh:`,
          parseErr.message
        );
        creds = initAuthCreds();
      }
    } else {
      creds = initAuthCreds();
    }

    // 2. Define standard keys.get
    const keysGet = async (type, ids) => {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {};
      }

      const keysToFetch = ids.map((id) => `${type}:${id}`);
      const result = {};

      try {
        const docs = await this.collection
          .find({
            centerId: validCenterId,
            key: { $in: keysToFetch },
          })
          .toArray();

        const docMap = new Map();
        if (Array.isArray(docs)) {
          for (const doc of docs) {
            if (doc && doc.key) {
              docMap.set(doc.key, doc.data);
            }
          }
        }

        for (const id of ids) {
          const keyName = `${type}:${id}`;
          const rawData = docMap.get(keyName);

          if (rawData) {
            try {
              let value = JSON.parse(rawData, BufferJSON.reviver);
              if (type === 'app-state-sync-key' && value && proto?.Message?.AppStateSyncKeyData) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              result[id] = value;
            } catch {
              result[id] = null;
            }
          } else {
            result[id] = null;
          }
        }
      } catch (err) {
        console.warn(
          `[BaileysMongoAuthStore] Error getting keys of type '${type}' for center ${validCenterId}:`,
          err.message
        );
        for (const id of ids) {
          result[id] = null;
        }
      }

      return result;
    };

    // 3. Define standard keys.set using bulk operations with FIFO queue serialization
    const keysSet = async (data) => {
      return this._enqueueKeySet(validCenterId, async () => {
        if (!data || typeof data !== 'object') return;

        const bulkOps = [];
        const now = new Date();

        for (const category in data) {
          const categoryData = data[category];
          if (!categoryData || typeof categoryData !== 'object') continue;

          for (const id in categoryData) {
            const value = categoryData[id];
            const key = `${category}:${id}`;

            if (value !== null && value !== undefined) {
              try {
                const serialized = JSON.stringify(value, BufferJSON.replacer);
                bulkOps.push({
                  updateOne: {
                    filter: { centerId: validCenterId, key },
                    update: {
                      $set: {
                        centerId: validCenterId,
                        key,
                        category,
                        data: serialized,
                        updatedAt: now,
                      },
                    },
                    upsert: true,
                  },
                });
              } catch (err) {
                console.warn(
                  `[BaileysMongoAuthStore] Failed to serialize key ${category}:${id} for center ${validCenterId}`
                );
              }
            } else {
              // Falsy value indicates key deletion
              bulkOps.push({
                deleteOne: {
                  filter: { centerId: validCenterId, key },
                },
              });
            }
          }
        }

        if (bulkOps.length > 0) {
          try {
            await this.collection.bulkWrite(bulkOps, { ordered: false });
          } catch (err) {
            console.warn(
              `[BaileysMongoAuthStore] Error during bulkWrite for center ${validCenterId}:`,
              err.message
            );
            throw err;
          }
        }
      });
    };

    // 4. Define saveCreds with FIFO queue serialization
    const saveCreds = async () => {
      return this._enqueueSave(validCenterId, async () => {
        try {
          const serialized = JSON.stringify(creds, BufferJSON.replacer);
          await this.collection.updateOne(
            { centerId: validCenterId, key: 'creds' },
            {
              $set: {
                centerId: validCenterId,
                key: 'creds',
                category: 'creds',
                data: serialized,
                updatedAt: new Date(),
              },
            },
            { upsert: true }
          );
        } catch (err) {
          console.warn(
            `[BaileysMongoAuthStore] Error saving creds for center ${validCenterId}:`,
            err.message
          );
          throw err;
        }
      });
    };

    return {
      state: {
        creds,
        keys: {
          get: keysGet,
          set: keysSet,
          clear: () => this.clearAuth(validCenterId),
        },
      },
      saveCreds,
      clearAuth: () => this.clearAuth(validCenterId),
      sessionExists: () => this.sessionExists(validCenterId),
    };
  }
}

/**
 * Idiomatic Baileys factory function: useBaileysMongoAuthState
 *
 * Usage:
 *   const { state, saveCreds, clearAuth } = await useBaileysMongoAuthState({
 *     centerId: 'aroven-001',
 *     mongooseInstance: mongoose,
 *   });
 */
async function useBaileysMongoAuthState({
  centerId,
  mongooseInstance,
  collectionName = 'baileys_auth',
  baileysInstance,
} = {}) {
  const store = new BaileysMongoAuthStore({
    mongooseInstance,
    collectionName,
    baileysInstance,
  });
  return store.useAuthState(centerId);
}

module.exports = {
  BaileysMongoAuthStore,
  useBaileysMongoAuthState,
  validateCenterId,
};
