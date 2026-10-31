import test from "node:test";
import assert from "node:assert/strict";
import { generateOrGetMonthlyFee } from "../tution-desk-be/src/lib/feeService.ts";

test("TuitionDesk Phase 2I.5: Application Integration & Concurrency Test Suite", async (t) => {
  // Test Mock models
  const mockStudent = {
    _id: "student_int_01",
    centerId: "center_int_01",
    name: "Integration Test Student",
    monthlyFee: 2000,
    isActive: true,
    billingCycleDate: 5,
    joiningDate: new Date("2024-01-01T00:00:00Z"),
  };

  const mockCenter = {
    centerId: "center_int_01",
    dueDateOffsetDays: 5,
  };

  // =========================================================================
  // 1. DUPLICATE RECURRING FEE DETECTION VIA CANONICAL BILLING MONTH
  // =========================================================================
  await t.test("1. generateOrGetMonthlyFee reuses existing canonical fee without re-creating", async () => {
    const existingFee = {
      _id: "fee_canonical_1",
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-10",
      feeType: "monthly_recurring",
      amountDue: 2000,
      status: "Pending",
    };

    const mockModels = {
      Student: {
        findById: async () => mockStudent,
      },
      Center: {
        findOne: async () => mockCenter,
      },
      Fee: {
        findOne: async (q) => {
          if (q.billingMonth === "2026-10" && q.feeType === "monthly_recurring") {
            return existingFee;
          }
          return null;
        },
        find: async () => [],
        create: async () => {
          throw new Error("create() should NOT be called when canonical fee exists!");
        },
      },
    };

    const res = await generateOrGetMonthlyFee({
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-10",
      models: mockModels,
    });

    assert.equal(res.success, true);
    assert.equal(res.wasCreated, false);
    assert.equal(res.status, "reused");
    assert.equal(res.fee?._id, "fee_canonical_1");
  });

  // =========================================================================
  // 2. EXISTING LEGACY FEE DETECTION VIA SHORT / LONG MONTH LABELS
  // =========================================================================
  await t.test("2. generateOrGetMonthlyFee detects legacy month label and reuses legacy record", async () => {
    const legacyFee = {
      _id: "fee_legacy_oct_1",
      centerId: "center_int_01",
      studentId: "student_int_01",
      month: "October 2026",
      amountDue: 2000,
      status: "Paid",
    };

    const mockModels = {
      Student: {
        findById: async () => mockStudent,
      },
      Center: {
        findOne: async () => mockCenter,
      },
      Fee: {
        findOne: async () => null, // No canonical record yet
        find: async (q) => {
          // Legacy candidate query
          return [legacyFee];
        },
        create: async () => {
          throw new Error("create() should NOT be called when legacy record matches!");
        },
      },
    };

    const res = await generateOrGetMonthlyFee({
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-10",
      referenceDate: new Date("2026-10-05T10:00:00Z"),
      models: mockModels,
    });

    assert.equal(res.success, true);
    assert.equal(res.wasCreated, false);
    assert.equal(res.status, "reused_legacy");
    assert.equal(res.fee?._id, "fee_legacy_oct_1");
  });

  // =========================================================================
  // 3. MULTIPLE LEGACY RECORDS TRIGGER RECONCILIATION_REQUIRED
  // =========================================================================
  await t.test("3. Multiple legacy candidates trigger reconciliation_required error without creating a third invoice", async () => {
    const legacyNovA = {
      _id: "fee_nov_a",
      centerId: "center_int_01",
      studentId: "student_int_01",
      month: "November 2026",
      status: "Pending",
    };
    const legacyNovB = {
      _id: "fee_nov_b",
      centerId: "center_int_01",
      studentId: "student_int_01",
      month: "November 2026",
      status: "Paid",
    };

    const mockModels = {
      Student: {
        findById: async () => mockStudent,
      },
      Center: {
        findOne: async () => mockCenter,
      },
      Fee: {
        findOne: async () => null,
        find: async () => [legacyNovA, legacyNovB], // 2 matching candidates
        create: async () => {
          throw new Error("create() must NEVER be called on ambiguous legacy candidates!");
        },
      },
    };

    const res = await generateOrGetMonthlyFee({
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-11",
      referenceDate: new Date("2026-11-05T10:00:00Z"),
      models: mockModels,
    });

    assert.equal(res.success, false);
    assert.equal(res.wasCreated, false);
    assert.equal(res.status, "reconciliation_required");
    assert.ok(res.conflictReason?.includes("Multiple (2) legacy candidate records exist"));
  });

  // =========================================================================
  // 4. CONCURRENCY TEST WITH PROMISE BARRIER: TOCTOU RACE CONDITION
  // =========================================================================
  await t.test("4. Concurrent invocation without DB unique index exhibits Time-Of-Check to Time-Of-Use race", async () => {
    let checkCount = 0;
    let createCount = 0;
    const insertedDocs = [];

    // Barrier to synchronize two concurrent requests so both complete findOne before either inserts
    let releaseBarrier;
    const barrier = new Promise((resolve) => {
      releaseBarrier = resolve;
    });

    const mockModelsWithoutUniqueIndex = {
      Student: {
        findById: async () => mockStudent,
      },
      Center: {
        findOne: async () => mockCenter,
      },
      Fee: {
        findOne: async () => {
          checkCount++;
          // Both requests see null initially (empty database)
          return null;
        },
        find: async () => [],
        create: async (doc) => {
          // If this is the first create call, hold until barrier is released
          if (createCount === 0) {
            createCount++;
            await barrier;
          } else {
            createCount++;
          }
          const created = { ...doc, _id: `fee_${createCount}` };
          insertedDocs.push(created);
          return created;
        },
      },
    };

    // Launch Request 1 and Request 2 concurrently
    const req1Promise = generateOrGetMonthlyFee({
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-10",
      models: mockModelsWithoutUniqueIndex,
    });

    const req2Promise = generateOrGetMonthlyFee({
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-10",
      models: mockModelsWithoutUniqueIndex,
    });

    // Release the barrier after both have likely started their checks
    await new Promise((r) => setTimeout(r, 10));
    releaseBarrier();

    const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

    // CONFIRMED ARCHITECTURAL FINDING:
    // Without a MongoDB unique index, application-level read-before-write check alone
    // CANNOT prevent duplicate creation under simultaneous execution!
    assert.equal(res1.wasCreated, true, "Req 1 created document");
    assert.equal(res2.wasCreated, true, "Req 2 also created document due to TOCTOU race");
    assert.equal(insertedDocs.length, 2, "2 documents were created because no unique index caught Req 2");
  });

  // =========================================================================
  // 5. CONCURRENCY WITH MONGODB E11000 SIMULATION: ATOMIC RECOVERY
  // =========================================================================
  await t.test("5. Concurrency with MongoDB E11000 handles race condition atomically and reuses created fee", async () => {
    let checkCount = 0;
    let createCount = 0;
    let storedFee = null;

    let releaseBarrier;
    const barrier = new Promise((resolve) => {
      releaseBarrier = resolve;
    });

    const mockModelsWithUniqueIndex = {
      Student: {
        findById: async () => mockStudent,
      },
      Center: {
        findOne: async () => mockCenter,
      },
      Fee: {
        findOne: async (q) => {
          checkCount++;
          if (storedFee && q.billingMonth === "2026-10") {
            return storedFee;
          }
          return null;
        },
        find: async () => [],
        create: async (doc) => {
          if (createCount === 0) {
            createCount++;
            storedFee = { ...doc, _id: "fee_winner" };
            // Release second thread
            releaseBarrier();
            return storedFee;
          } else {
            // Second thread triggers E11000 duplicate key error from MongoDB unique index
            await barrier;
            createCount++;
            const err = new Error("E11000 duplicate key error collection: fees index: unique_cycle dup key");
            (err ).code = 11000;
            throw err;
          }
        },
      },
    };

    const req1 = generateOrGetMonthlyFee({
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-10",
      models: mockModelsWithUniqueIndex,
    });

    const req2 = generateOrGetMonthlyFee({
      centerId: "center_int_01",
      studentId: "student_int_01",
      billingMonth: "2026-10",
      models: mockModelsWithUniqueIndex,
    });

    const [res1, res2] = await Promise.all([req1, req2]);

    assert.equal(res1.wasCreated, true, "First request successfully created fee");
    assert.equal(res1.status, "created");
    assert.equal(res1.fee?._id, "fee_winner");

    assert.equal(res2.wasCreated, false, "Second request caught E11000 and did not create duplicate");
    assert.equal(res2.status, "reused", "Second request recovered atomically by reusing fee_winner");
    assert.equal(res2.fee?._id, "fee_winner");
  });
});
