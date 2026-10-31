import test from "node:test";
import assert from "node:assert/strict";
import { generateOrGetMonthlyFee } from "../tution-desk-be/src/lib/feeService.ts";

test("TuitionDesk Phase 2I.6: Production-Safe Recurring Fee Concurrency Suite", async (t) => {
  const mockStudent = {
    _id: "student_conc_01",
    centerId: "center_conc_01",
    name: "Concurrency Student",
    monthlyFee: 2500,
    isActive: true,
    billingCycleDate: 5,
    joiningDate: new Date("2024-01-01T00:00:00Z"),
  };

  const mockCenter = {
    centerId: "center_conc_01",
    dueDateOffsetDays: 5,
  };

  // Helper to create an in-memory mock environment with FeeCreationLock simulation
  function createConcurrencyMockEnv(envOpts = {}) {
    const feeDocs = new Map();
    const lockDocs = new Map();
    let uniqueIndexEnforced = envOpts.uniqueIndexEnforced !== undefined ? envOpts.uniqueIndexEnforced : true;

    const mockModels = {
      Student: {
        findById: async () => mockStudent,
      },
      Center: {
        findOne: async () => mockCenter,
      },
      Fee: {
        findOne: async (q) => {
          for (const doc of feeDocs.values()) {
            if (
              doc.centerId === q.centerId &&
              String(doc.studentId) === String(q.studentId) &&
              doc.billingMonth === q.billingMonth &&
              doc.feeType === q.feeType
            ) {
              return doc;
            }
          }
          return null;
        },
        find: async () => [],
        create: async (doc) => {
          const id = `fee_${feeDocs.size + 1}`;
          const newDoc = { ...doc, _id: id };
          feeDocs.set(id, newDoc);
          return newDoc;
        },
      },
      FeeCreationLock: {
        enforceUniqueness: uniqueIndexEnforced,
        hasUniqueLockIndex: async () => uniqueIndexEnforced,
        collection: {
          indexes: async () => [
            { key: { _id: 1 } },
            ...(uniqueIndexEnforced ? [{ key: { lockKey: 1 }, unique: true }] : []),
          ],
        },
        create: async (lockPayload) => {
          const key = lockPayload.lockKey;
          // Atomic uniqueness enforcement on lockKey (mirroring MongoDB unique index on FeeCreationLock)
          if (uniqueIndexEnforced && lockDocs.has(key)) {
            const err = new Error(`E11000 duplicate key error collection: feecreationlocks index: lockKey_1 dup key: { lockKey: "${key}" }`);
            err.code = 11000;
            throw err;
          }
          const lockDoc = { ...lockPayload, _id: `lock_${lockDocs.size + 1}` };
          lockDocs.set(key, lockDoc);
          return lockDoc;
        },
        findOne: async (q) => lockDocs.get(q.lockKey) || null,
        findOneAndUpdate: async (filter, update) => {
          const existing = lockDocs.get(filter.lockKey);
          if (!existing) return null;

          if (filter.expiresAt && filter.expiresAt.$lte) {
            const lteTime = new Date(filter.expiresAt.$lte).getTime();
            const docExpiry = new Date(existing.expiresAt).getTime();
            if (docExpiry > lteTime) {
              return null; // Not expired yet
            }
          }

          if (update.$set) {
            Object.assign(existing, update.$set);
          }
          return existing;
        },
        deleteOne: async (q) => {
          const existing = lockDocs.get(q.lockKey);
          if (existing) {
            if (q.holderId && existing.holderId !== q.holderId) {
              // Current process does not own the lock! (CRITICAL CHECK 4, 7)
              return { deletedCount: 0 };
            }
            lockDocs.delete(q.lockKey);
            return { deletedCount: 1 };
          }
          return { deletedCount: 0 };
        },
        updateOne: async (q, u) => {
          const existing = lockDocs.get(q.lockKey);
          if (existing) {
            if (q.holderId && existing.holderId !== q.holderId) {
              return { matchedCount: 0, modifiedCount: 0 };
            }
            Object.assign(existing, u.$set);
            return { matchedCount: 1, modifiedCount: 1 };
          }
          return { matchedCount: 0, modifiedCount: 0 };
        },
      },
    };

    return {
      mockModels,
      feeDocs,
      lockDocs,
      setIndexEnforced: (val) => {
        uniqueIndexEnforced = val;
        mockModels.FeeCreationLock.enforceUniqueness = val;
      },
    };
  }

  // =========================================================================
  // 1. TWO SIMULTANEOUS MANUAL REQUESTS (RACING ON SAME CANONICAL KEY)
  // =========================================================================
  await t.test("1. Two simultaneous manual requests produce exactly ONE recurring fee and zero duplicates", async () => {
    const { mockModels, feeDocs } = createConcurrencyMockEnv();

    const [res1, res2] = await Promise.all([
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: true,
        models: mockModels,
      }),
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: true,
        models: mockModels,
      }),
    ]);

    assert.equal(feeDocs.size, 1, "Exactly one fee document must exist in database");

    const createdResults = [res1, res2].filter((r) => r.wasCreated);
    const reusedResults = [res1, res2].filter((r) => r.status === "reused");

    assert.equal(createdResults.length, 1, "Exactly one request must report wasCreated: true");
    assert.equal(reusedResults.length, 1, "The racing request must report status: reused");
    assert.equal(res1.fee?._id, res2.fee?._id, "Both requests must receive the same fee ID");
  });

  // =========================================================================
  // 2. TWO SIMULTANEOUS CRON REQUESTS (DISTRIBUTED INSTANCE SIMULATION)
  // =========================================================================
  await t.test("2. Two simultaneous cron instances produce exactly ONE recurring fee", async () => {
    const { mockModels, feeDocs } = createConcurrencyMockEnv();

    const [cronA, cronB] = await Promise.all([
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: false,
        models: mockModels,
      }),
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: false,
        models: mockModels,
      }),
    ]);

    assert.equal(feeDocs.size, 1);
    assert.equal(cronA.fee?._id, cronB.fee?._id);
  });

  // =========================================================================
  // 3. MANUAL REQUEST RACING WITH CRON REQUEST
  // =========================================================================
  await t.test("3. Manual request racing with cron request safely coordinates via lock", async () => {
    const { mockModels, feeDocs } = createConcurrencyMockEnv();

    const [manualRes, cronRes] = await Promise.all([
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: true,
        models: mockModels,
      }),
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: false,
        models: mockModels,
      }),
    ]);

    assert.equal(feeDocs.size, 1);
    assert.equal(manualRes.fee?._id, cronRes.fee?._id);
  });

  // =========================================================================
  // 4. RETRY AFTER UNCERTAIN CREATE OUTCOME (POST-LOCK IDEMPOTENCY)
  // =========================================================================
  await t.test("4. Retry after uncertain outcome reuses canonical fee without re-inserting", async () => {
    const { mockModels, feeDocs } = createConcurrencyMockEnv();

    // First attempt creates fee
    const res1 = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });
    assert.equal(res1.wasCreated, true);
    assert.equal(feeDocs.size, 1);

    // Second attempt (retry) immediately reuses
    const res2 = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });
    assert.equal(res2.wasCreated, false);
    assert.equal(res2.status, "reused");
    assert.equal(feeDocs.size, 1);
  });

  // =========================================================================
  // 5. EXISTING LEGACY FEE REUSE (STEP B INVARIANT PRESERVED)
  // =========================================================================
  await t.test("5. Legacy single candidate record is reused and lock is not acquired unnecessarily", async () => {
    const { mockModels, feeDocs, lockDocs } = createConcurrencyMockEnv();

    const legacyDoc = {
      _id: "fee_legacy_oct",
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      month: "Oct 2026",
      status: "Paid",
      amountDue: 2500,
    };
    feeDocs.set(legacyDoc._id, legacyDoc);

    mockModels.Fee.find = async () => [legacyDoc];

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      referenceDate: new Date("2026-10-05T10:00:00Z"),
      models: mockModels,
    });

    assert.equal(res.success, true);
    assert.equal(res.status, "reused_legacy");
    assert.equal(res.fee?._id, "fee_legacy_oct");
    assert.equal(lockDocs.size, 0, "No creation lock should be generated for legacy reuse");
  });

  // =========================================================================
  // 6. MULTIPLE LEGACY CANDIDATES RETURN RECONCILIATION_REQUIRED
  // =========================================================================
  await t.test("6. Multiple legacy candidates return reconciliation_required and abort without creating a lock", async () => {
    const { mockModels, lockDocs } = createConcurrencyMockEnv();

    const legacyA = { _id: "legacy_1", status: "Pending", month: "Nov 2026" };
    const legacyB = { _id: "legacy_2", status: "Paid", month: "Nov 2026" };

    mockModels.Fee.find = async () => [legacyA, legacyB];

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-11",
      referenceDate: new Date("2026-11-05T10:00:00Z"),
      models: mockModels,
    });

    assert.equal(res.success, false);
    assert.equal(res.status, "reconciliation_required");
    assert.equal(lockDocs.size, 0);
  });

  // =========================================================================
  // 7. PAID AND PARTIAL PAID RECORDS REMAIN UNCHANGED
  // =========================================================================
  await t.test("7. Settled Paid and Partial Paid records are returned intact without field overwrites", async () => {
    const { mockModels, feeDocs } = createConcurrencyMockEnv();

    const settledFee = {
      _id: "fee_paid_full",
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      feeType: "monthly_recurring",
      amountDue: 2500,
      paidAmount: 2500,
      status: "Paid",
      utrNumber: "UTR_IMMUTABLE_123",
    };
    feeDocs.set(settledFee._id, settledFee);

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.status, "reused");
    assert.equal(res.fee?.status, "Paid");
    assert.equal(res.fee?.paidAmount, 2500);
    assert.equal(res.fee?.utrNumber, "UTR_IMMUTABLE_123");
  });

  // =========================================================================
  // 8. TWO SEPARATE SIMULATED APPLICATION INSTANCES
  // =========================================================================
  await t.test("8. Two separate simulated application instances safely coordinate via shared lock collection", async () => {
    // Shared database state accessible by both serverless instances
    const sharedDb = createConcurrencyMockEnv();

    // Instance Alpha and Instance Beta have separate local runtimes but shared DB
    const instanceAlphaModels = { ...sharedDb.mockModels };
    const instanceBetaModels = { ...sharedDb.mockModels };

    const [resAlpha, resBeta] = await Promise.all([
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: true,
        models: instanceAlphaModels,
      }),
      generateOrGetMonthlyFee({
        centerId: "center_conc_01",
        studentId: "student_conc_01",
        billingMonth: "2026-10",
        isManual: false,
        models: instanceBetaModels,
      }),
    ]);

    assert.equal(sharedDb.feeDocs.size, 1, "Only 1 fee created across separate instances");
    assert.equal(resAlpha.fee?._id, resBeta.fee?._id, "Both instances must reference the exact same fee");
    const createdCount = [resAlpha, resBeta].filter((r) => r.wasCreated).length;
    assert.equal(createdCount, 1, "Exactly one instance marked as creator");
  });

  // =========================================================================
  // 9. DUPLICATE-KEY HANDLING ON FEE INSERTION
  // =========================================================================
  await t.test("9. Duplicate-key error during FeeModel.create recovers safely and reuses existing fee", async () => {
    const { mockModels, feeDocs } = createConcurrencyMockEnv();

    let createAttempted = false;
    const originalCreate = mockModels.Fee.create;
    mockModels.Fee.create = async (doc) => {
      // Simulate race where another worker inserted right before create, triggering duplicate key code 11000
      if (!createAttempted) {
        createAttempted = true;
        const insertedDoc = { ...doc, _id: "fee_concurrent_dup_11000" };
        feeDocs.set(insertedDoc._id, insertedDoc);

        const dupErr = new Error("E11000 duplicate key error collection: fees index: centerId_1_studentId_1_billingMonth_1_feeType_1 dup key");
        dupErr.code = 11000;
        throw dupErr;
      }
      return originalCreate(doc);
    };

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, true, "Should gracefully recover on duplicate-key error");
    assert.equal(res.status, "reused", "Status should be reused");
    assert.equal(res.fee?._id, "fee_concurrent_dup_11000");
    assert.equal(res.wasCreated, false);
  });

  // =========================================================================
  // 10. NON-RECURRING FEE TYPES REMAIN UNAFFECTED
  // =========================================================================
  await t.test("10. Non-recurring fee types (advance, adhoc, registration) do not interfere with recurring fees", async () => {
    const { mockModels, feeDocs, lockDocs } = createConcurrencyMockEnv();

    // Advance fee exists for the student
    const advanceFee = {
      _id: "fee_adv_01",
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      feeType: "advance",
      isAdvance: true,
      amountDue: 5000,
      paidAmount: 5000,
      status: "Paid",
      month: "Advance Payment Oct-Dec",
    };
    feeDocs.set(advanceFee._id, advanceFee);

    // Adhoc fee exists for the student
    const adhocFee = {
      _id: "fee_adhoc_01",
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      feeType: "adhoc",
      amountDue: 600,
      paidAmount: 600,
      status: "Paid",
      title: "Science Lab Materials",
    };
    feeDocs.set(adhocFee._id, adhocFee);

    // Registration fee exists for the student
    const regFee = {
      _id: "fee_reg_01",
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      feeType: "registration",
      amountDue: 1000,
      paidAmount: 1000,
      status: "Paid",
      title: "Admission Fee",
    };
    feeDocs.set(regFee._id, regFee);

    // Now generating monthly recurring fee for 2026-10 must proceed independently
    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, true);
    assert.equal(res.wasCreated, true);
    assert.equal(res.fee?.feeType, "monthly_recurring");
    assert.equal(res.fee?.billingMonth, "2026-10");

    // Advance and Adhoc records remain untouched
    assert.equal(feeDocs.get("fee_adv_01").feeType, "advance");
    assert.equal(feeDocs.get("fee_adhoc_01").feeType, "adhoc");
    assert.equal(feeDocs.get("fee_reg_01").feeType, "registration");
    assert.equal(feeDocs.size, 4); // 3 non-recurring + 1 newly created recurring fee
  });

  // =========================================================================
  // 11. MISSING UNIQUE INDEX FAILS SAFE (CRITICAL CHECK 1, 2, 10)
  // =========================================================================
  await t.test("11. Missing unique index prevents lock acquisition and returns lock_index_unverified", async () => {
    // Simulate collection where autoIndex=false and no unique index was created on lockKey
    const { mockModels, feeDocs, lockDocs } = createConcurrencyMockEnv({ uniqueIndexEnforced: false });

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, false, "Must fail when unique index is unverified");
    assert.equal(res.status, "lock_index_unverified");
    assert.equal(feeDocs.size, 0, "No fee document should be created without verified lock index");
    assert.equal(lockDocs.size, 0, "No lock document should be retained");
  });

  // =========================================================================
  // 12. LOCK OWNER A EXPIRES, OWNER B ACQUIRES, OWNER A ATTEMPTS RELEASE (CRITICAL CHECK 3, 4, 7)
  // =========================================================================
  await t.test("12. Lock owner A expires, owner B acquires, owner A attempts release but cannot delete owner B's lock", async () => {
    const { mockModels, lockDocs } = createConcurrencyMockEnv();

    const lockKey = "center_conc_01:student_conc_01:2026-10:monthly_recurring";
    const tokenA = "token_owner_a_1111";

    // Simulate Owner A holding an expired lock (expired 5 seconds ago)
    lockDocs.set(lockKey, {
      _id: "lock_01",
      lockKey,
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      feeType: "monthly_recurring",
      lockedAt: new Date(Date.now() - 20000),
      expiresAt: new Date(Date.now() - 5000), // Expired!
      holderId: tokenA,
      status: "LOCKED",
    });

    // Owner B executes generateOrGetMonthlyFee and takes over the expired lock atomically
    // We delay Fee.create so we can verify the lock state while Owner B is executing
    let ownerBToken = null;
    const originalCreate = mockModels.Fee.create;
    mockModels.Fee.create = async (doc) => {
      const activeLock = lockDocs.get(lockKey);
      ownerBToken = activeLock.holderId;
      assert.notEqual(ownerBToken, tokenA, "Owner B must have a new, distinct lock token");

      // While Owner B is inside the critical section, Owner A tries to release its lock with tokenA
      const deleteResult = await mockModels.FeeCreationLock.deleteOne({
        lockKey,
        holderId: tokenA,
      });

      assert.equal(deleteResult.deletedCount, 0, "Owner A must not be allowed to delete Owner B's lock");
      assert.equal(lockDocs.has(lockKey), true, "Owner B's lock must remain in database");
      assert.equal(lockDocs.get(lockKey).holderId, ownerBToken, "Lock holder must still be Owner B");

      return originalCreate(doc);
    };

    const resB = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(resB.success, true);
    assert.equal(resB.wasCreated, true);
    // After Owner B finishes, Owner B's finally block properly releases its own lock
    assert.equal(lockDocs.has(lockKey), false, "Owner B cleanly releases its own lock upon completion");
  });

  // =========================================================================
  // 13. WORKER FAILURE DURING FEE CREATION TRIGGERS FINALLY CLEANUP (CRITICAL CHECK 5)
  // =========================================================================
  await t.test("13. Worker failure during fee creation triggers finally cleanup releasing the lock", async () => {
    const { mockModels, lockDocs } = createConcurrencyMockEnv();

    mockModels.Fee.create = async () => {
      throw new Error("Simulated database network disconnection during insert");
    };

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, false);
    assert.equal(res.status, "skipped_ineligible");
    assert.match(res.error, /Simulated database network disconnection/);

    // Guaranteed finally cleanup must have released the lock
    assert.equal(lockDocs.size, 0, "Lock must be reliably cleaned up in finally block even after worker error");
  });

  // =========================================================================
  // 14. POLL TIMEOUT RETURNS CONTROLLED RETRYABLE ERROR (CRITICAL CHECK 8)
  // =========================================================================
  await t.test("14. Poll timeout returns controlled retryable error without creating fee", async () => {
    const { mockModels, feeDocs, lockDocs } = createConcurrencyMockEnv();

    const lockKey = "center_conc_01:student_conc_01:2026-10:monthly_recurring";

    // Simulate another worker holding a lock that remains active for 10 minutes
    lockDocs.set(lockKey, {
      _id: "lock_active",
      lockKey,
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      feeType: "monthly_recurring",
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + 600000), // 10 minutes in future
      holderId: "other_active_process_999",
      status: "LOCKED",
    });

    // Run with small pollIntervalMs and maxPollAttempts to test polling timeout swiftly
    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      pollIntervalMs: 10,
      maxPollAttempts: 3,
      models: mockModels,
    });

    assert.equal(res.success, false);
    assert.equal(res.status, "lock_timeout");
    assert.match(res.error, /Timed out waiting for concurrent fee creation lock/);
    assert.equal(feeDocs.size, 0, "Must NEVER create a fee without acquiring the lock");
  });

  // =========================================================================
  // 15. RETRY AFTER EXPIRED LOCK ATOMICALLY CLAIMS AND COMPLETES (CRITICAL CHECK 6, 9)
  // =========================================================================
  await t.test("15. Retry after expired lock atomically claims abandoned lock and completes fee creation", async () => {
    const { mockModels, feeDocs, lockDocs } = createConcurrencyMockEnv();

    const lockKey = "center_conc_01:student_conc_01:2026-10:monthly_recurring";

    // Abandoned lock left by crashed process (expired)
    lockDocs.set(lockKey, {
      _id: "lock_abandoned",
      lockKey,
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      feeType: "monthly_recurring",
      lockedAt: new Date(Date.now() - 30000),
      expiresAt: new Date(Date.now() - 15000), // Expired 15s ago
      holderId: "crashed_worker_dead",
      status: "LOCKED",
    });

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, true);
    assert.equal(res.wasCreated, true);
    assert.equal(feeDocs.size, 1, "Exactly one fee should be created");
    assert.equal(lockDocs.size, 0, "Lock must be released after completion");
  });

  // =========================================================================
  // 16. LOCK CLEANUP AFTER SUCCESS AND FAILURE (CRITICAL CHECK 5)
  // =========================================================================
  await t.test("16. Lock cleanup after success ensures no stale lock documents remain", async () => {
    const { mockModels, lockDocs } = createConcurrencyMockEnv();

    const res = await generateOrGetMonthlyFee({
      centerId: "center_conc_01",
      studentId: "student_conc_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, true);
    assert.equal(res.wasCreated, true);
    assert.equal(lockDocs.size, 0, "Lock collection must be empty after successful creation");
  });
});


