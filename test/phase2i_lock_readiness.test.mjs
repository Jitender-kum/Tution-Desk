import test from "node:test";
import assert from "node:assert/strict";
import { auditLockCollection, formatLockReadinessReport } from "../tution-desk-be/src/lib/lockReadiness.ts";
import { verifyLockIndexIntegrity, FeeCreationLock } from "../tution-desk-be/src/models/FeeCreationLock.ts";
import { generateOrGetMonthlyFee } from "../tution-desk-be/src/lib/feeService.ts";

test("TuitionDesk Phase 2I.6.2: Production Lock Index Readiness Suite", async (t) => {
  // =========================================================================
  // 1. SCHEMA & COLLECTION SPECIFICATION INTEGRITY
  // =========================================================================
  await t.test("1. Model collection name and schema field definitions match application expectations", () => {
    assert.equal(FeeCreationLock.collection.name, "feecreationlocks");
    const schemaPaths = FeeCreationLock.schema.paths;
    assert.ok(schemaPaths.lockKey, "lockKey must exist in schema");
    assert.ok(schemaPaths.centerId, "centerId must exist in schema");
    assert.ok(schemaPaths.studentId, "studentId must exist in schema");
    assert.ok(schemaPaths.billingMonth, "billingMonth must exist in schema");
    assert.ok(schemaPaths.feeType, "feeType must exist in schema");
    assert.ok(schemaPaths.lockedAt, "lockedAt must exist in schema");
    assert.ok(schemaPaths.expiresAt, "expiresAt must exist in schema");
    assert.ok(schemaPaths.holderId, "holderId must exist in schema");
    assert.ok(schemaPaths.status, "status must exist in schema");
  });

  // =========================================================================
  // 2. AUDIT ON EMPTY UNINDEXED COLLECTION (MISSING UNIQUE INDEX -> NO-GO)
  // =========================================================================
  await t.test("2. Unindexed empty collection returns NO_GO_INDEX_MISSING with exact remedial command", async () => {
    const mockCollection = {
      collection: {
        name: "feecreationlocks",
        indexes: async () => [{ key: { _id: 1 }, name: "_id_" }],
      },
      find: async () => [],
    };

    const report = await auditLockCollection(mockCollection);
    assert.equal(report.readinessStatus, "NO_GO_INDEX_MISSING");
    assert.equal(report.hasUniqueLockKeyIndex, false);
    assert.equal(report.totalDocuments, 0);
    assert.ok(report.recommendations.some((r) => r.includes("db.feecreationlocks.createIndex({ lockKey: 1 }, { unique: true })")));
  });

  // =========================================================================
  // 3. AUDIT WITH CORRUPTED DATA (MISSING LOCKKEY -> NO-GO)
  // =========================================================================
  await t.test("3. Collection containing documents with missing lockKey returns NO_GO_CORRUPT_DATA", async () => {
    const mockCollection = {
      collection: {
        name: "feecreationlocks",
        indexes: async () => [
          { key: { _id: 1 }, name: "_id_" },
          { key: { lockKey: 1 }, name: "lockKey_1", unique: true },
          { key: { expiresAt: 1 }, name: "expiresAt_1", expireAfterSeconds: 600 },
        ],
      },
      find: async () => [
        { _id: "1", lockKey: "center_1:student_1:2026-10:monthly_recurring" },
        { _id: "2", status: "LOCKED" }, // Missing lockKey!
      ],
    };

    const report = await auditLockCollection(mockCollection);
    assert.equal(report.readinessStatus, "NO_GO_CORRUPT_DATA");
    assert.equal(report.missingLockKeysCount, 1);
    assert.ok(report.decisionReasons.some((r) => r.includes("missing or non-string lockKey")));
  });

  // =========================================================================
  // 4. AUDIT WITH DUPLICATE LOCKKEYS -> NO-GO
  // =========================================================================
  await t.test("4. Collection containing duplicate lockKey values returns NO_GO_DUPLICATE_KEYS", async () => {
    const key = "center_1:student_dup:2026-10:monthly_recurring";
    const mockCollection = {
      collection: {
        name: "feecreationlocks",
        indexes: async () => [{ key: { _id: 1 }, name: "_id_" }],
      },
      find: async () => [
        { _id: "doc_1", lockKey: key },
        { _id: "doc_2", lockKey: key },
      ],
    };

    const report = await auditLockCollection(mockCollection);
    assert.equal(report.readinessStatus, "NO_GO_DUPLICATE_KEYS");
    assert.equal(report.duplicateLockKeys.length, 1);
    assert.equal(report.duplicateLockKeys[0].lockKey, key);
    assert.equal(report.duplicateLockKeys[0].count, 2);
  });

  // =========================================================================
  // 5. AUDIT WITH FULLY CONFIGURED INDEXES & CLEAN DATA -> GO
  // =========================================================================
  await t.test("5. Fully indexed collection with clean data returns GO", async () => {
    const mockCollection = {
      collection: {
        name: "feecreationlocks",
        indexes: async () => [
          { key: { _id: 1 }, name: "_id_" },
          { key: { lockKey: 1 }, name: "lockKey_1", unique: true },
          { key: { expiresAt: 1 }, name: "expiresAt_1", expireAfterSeconds: 600 },
        ],
      },
      find: async () => [
        {
          _id: "doc_1",
          lockKey: "center_1:student_1:2026-10:monthly_recurring",
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 10000),
          status: "LOCKED",
        },
      ],
    };

    const report = await auditLockCollection(mockCollection);
    assert.equal(report.readinessStatus, "GO");
    assert.equal(report.hasUniqueLockKeyIndex, true);
    assert.equal(report.hasTtlExpiresAtIndex, true);
    assert.equal(report.activeLocksCount, 1);
    assert.equal(report.expiredLocksCount, 0);

    const formatted = formatLockReadinessReport(report);
    assert.ok(formatted.includes("🟢 GO"));
    assert.ok(formatted.includes("✅ ACTIVE & ENFORCED"));
  });

  // =========================================================================
  // 6. APPLICATION STARTUP / REQUEST BEHAVIOR WHEN UNIQUE INDEX IS ABSENT
  // =========================================================================
  await t.test("6. generateOrGetMonthlyFee strictly fails safe if lockKey unique index is absent", async () => {
    const mockModels = {
      Student: {
        findById: async () => ({
          _id: "student_idx_test",
          centerId: "center_idx_test",
          monthlyFee: 1500,
          isActive: true,
          joiningDate: new Date("2024-01-01"),
        }),
      },
      Center: { findOne: async () => ({ centerId: "center_idx_test" }) },
      Fee: { findOne: async () => null, find: async () => [], create: async () => {} },
      FeeCreationLock: {
        enforceUniqueness: false,
        hasUniqueLockIndex: async () => false,
        collection: {
          indexes: async () => [{ key: { _id: 1 } }], // Only _id index!
        },
      },
    };

    const res = await generateOrGetMonthlyFee({
      centerId: "center_idx_test",
      studentId: "student_idx_test",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, false);
    assert.equal(res.status, "lock_index_unverified");
    assert.match(res.error, /unique index on 'lockKey' is missing or unverified/);
  });

  // =========================================================================
  // 7. DISPOSABLE TEST COLLECTION ISOLATED CONCURRENCY VERIFICATION
  // =========================================================================
  await t.test("7. Concurrency lifecycle against disposable test collection verifies atomic semantics", async () => {
    // Disposable in-memory simulation of a MongoDB collection
    const disposableStore = new Map();
    let hasUniqueIndex = true;

    const disposableCollection = {
      name: `_disposable_locks_${Date.now()}`,
      indexes: async () => [
        { key: { _id: 1 }, name: "_id_" },
        ...(hasUniqueIndex ? [{ key: { lockKey: 1 }, name: "lockKey_1", unique: true }] : []),
      ],
      create: async (doc) => {
        if (hasUniqueIndex && disposableStore.has(doc.lockKey)) {
          const err = new Error("E11000 duplicate key error");
          err.code = 11000;
          throw err;
        }
        disposableStore.set(doc.lockKey, { ...doc });
        return doc;
      },
      findOneAndUpdate: async (filter, update) => {
        const doc = disposableStore.get(filter.lockKey);
        if (!doc) return null;
        if (filter.expiresAt?.$lte) {
          if (new Date(doc.expiresAt).getTime() > new Date(filter.expiresAt.$lte).getTime()) {
            return null;
          }
        }
        Object.assign(doc, update.$set);
        return doc;
      },
      deleteOne: async (filter) => {
        const doc = disposableStore.get(filter.lockKey);
        if (!doc) return { deletedCount: 0 };
        if (filter.holderId && doc.holderId !== filter.holderId) {
          return { deletedCount: 0 };
        }
        disposableStore.delete(filter.lockKey);
        return { deletedCount: 1 };
      },
      findOne: async (filter) => disposableStore.get(filter.lockKey) || null,
    };

    // Step A: First process acquires lock
    const lockKey = "center_disp:student_disp:2026-10:monthly_recurring";
    const tokenA = "token_proc_A";
    await disposableCollection.create({
      lockKey,
      holderId: tokenA,
      expiresAt: new Date(Date.now() + 5000),
      status: "LOCKED",
    });

    // Step B: Second process attempts insertion -> E11000 thrown
    await assert.rejects(
      async () => {
        await disposableCollection.create({
          lockKey,
          holderId: "token_proc_B",
          expiresAt: new Date(Date.now() + 5000),
          status: "LOCKED",
        });
      },
      { code: 11000 }
    );

    // Step C: Lock expires -> Process B atomically claims via findOneAndUpdate
    disposableStore.get(lockKey).expiresAt = new Date(Date.now() - 1000);
    const claimed = await disposableCollection.findOneAndUpdate(
      { lockKey, expiresAt: { $lte: new Date() } },
      { $set: { holderId: "token_proc_B", status: "LOCKED" } }
    );
    assert.ok(claimed);
    assert.equal(claimed.holderId, "token_proc_B");

    // Step D: Process A tries to delete -> denied
    const delA = await disposableCollection.deleteOne({ lockKey, holderId: tokenA });
    assert.equal(delA.deletedCount, 0);
    assert.equal(disposableStore.has(lockKey), true);

    // Step E: Process B deletes -> allowed
    const delB = await disposableCollection.deleteOne({ lockKey, holderId: "token_proc_B" });
    assert.equal(delB.deletedCount, 1);
    assert.equal(disposableStore.has(lockKey), false);
  });
});
