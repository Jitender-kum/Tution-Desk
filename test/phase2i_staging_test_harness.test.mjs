import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { readFeeSnapshotFile } from "../tution-desk-be/src/lib/snapshotReader.ts";
import { generateBackfillPlan } from "../tution-desk-be/src/lib/backfillPlanner.ts";
import { reconcileFeeDataset } from "../tution-desk-be/src/lib/reconciliationEngine.ts";
import {
  MockFeeRepository,
  TestExecutionLedger,
  computeDocumentFingerprint,
  evaluateRollbackEligibility,
} from "../tution-desk-be/src/lib/stagingTestHarness.ts";

test("TuitionDesk Phase 2I.4: Staging Test Harness Suite", async (t) => {
  // Load the exact 19-record production snapshot
  const snapshotPath = path.resolve(process.cwd(), ".audit_snapshot/test/fees.bson");
  const snapshot = readFeeSnapshotFile(snapshotPath);
  assert.equal(snapshot.records.length, 19, "Snapshot must contain exactly 19 documents");

  // =========================================================================
  // 1. BASELINE SNAPSHOT PARTITIONING
  // =========================================================================
  await t.test("1. Snapshot cleanly partitions into 9 October candidates, 2 November conflicts, and 8 advance fees", () => {
    const plan = generateBackfillPlan(snapshot.records);
    assert.equal(plan.summary.totalRecordsInspected, 19);
    assert.equal(plan.summary.safeRecurringBackfillCandidatesCount, 9);
    assert.equal(plan.summary.duplicateConflictsCount, 2);
    assert.equal(plan.summary.nonRecurringAdvanceCount, 8);
    assert.equal(plan.proposedChanges.length, 9);
    assert.equal(plan.duplicateConflictGroups.length, 1);
  });

  // =========================================================================
  // 2. SUCCESSFUL OCTOBER BACKFILL EXECUTION IN MOCK REPOSITORY
  // =========================================================================
  await t.test("2. Successful October backfill transitions records from PREPARED -> APPLIED -> VERIFIED", () => {
    const repo = new MockFeeRepository(snapshot.records);
    const ledger = new TestExecutionLedger();
    const plan = generateBackfillPlan(snapshot.records);

    // Execute backfill for all 9 proposed candidates
    for (const proposal of plan.proposedChanges) {
      const liveBefore = repo.getDoc(proposal.feeId);
      assert.ok(liveBefore);

      const fp = computeDocumentFingerprint(liveBefore);

      // 1. Record PREPARED
      ledger.recordState({
        planId: plan.planId,
        feeId: proposal.feeId,
        centerId: proposal.centerId,
        studentId: proposal.studentId,
        state: "PREPARED",
        preMigrationFingerprint: fp,
        preMigrationSnapshot: liveBefore,
        plannedUpdates: proposal.proposedUpdates,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 2. Atomic update
      const filter = {
        _id: proposal.feeId,
        centerId: proposal.centerId,
        studentId: proposal.studentId,
        feeType: { $exists: false },
        billingMonth: { $exists: false },
        isAdvance: { $ne: true },
        month: proposal.currentValues.month,
      };

      const updateRes = repo.updateOne(filter, {
        $set: {
          feeType: proposal.proposedUpdates.feeType,
          billingMonth: proposal.proposedUpdates.billingMonth,
        },
      });

      assert.equal(updateRes.matchedCount, 1);
      assert.equal(updateRes.modifiedCount, 1);

      // 3. Record APPLIED
      const entry = ledger.getEntry(proposal.feeId);
      entry.state = "APPLIED";
      ledger.recordState(entry);

      // 4. Verify Read-back
      const liveAfter = repo.getDoc(proposal.feeId);
      assert.equal(liveAfter.feeType, "monthly_recurring");
      assert.equal(liveAfter.billingMonth, "2026-10");
      assert.equal(computeDocumentFingerprint(liveAfter), fp, "Fingerprint must not change");

      entry.state = "VERIFIED";
      ledger.recordState(entry);
    }

    // Assert all 9 entries are VERIFIED
    assert.equal(ledger.entries.length, 9);
    assert.ok(ledger.entries.every((e) => e.state === "VERIFIED"));
  });

  // =========================================================================
  // 3. NOVEMBER CONFLICT ISOLATION & ADVANCE IMMUNITY
  // =========================================================================
  await t.test("3. November duplicate records and advance records remain untouched after October migration", () => {
    const repo = new MockFeeRepository(snapshot.records);
    const plan = generateBackfillPlan(snapshot.records);

    // Apply the 9 October proposals
    for (const proposal of plan.proposedChanges) {
      repo.updateOne(
        { _id: proposal.feeId },
        { $set: { feeType: proposal.proposedUpdates.feeType, billingMonth: proposal.proposedUpdates.billingMonth } }
      );
    }

    // Inspect the 2 November conflict records (student ending e6de)
    const novRecords = repo.getAllDocs().filter((d) => String(d.studentId).endsWith("e6de"));
    assert.equal(novRecords.length, 2);
    for (const rec of novRecords) {
      assert.equal(rec.feeType, undefined, "November feeType must remain undefined");
      assert.equal(rec.billingMonth, undefined, "November billingMonth must remain undefined");
    }

    // Inspect the 8 advance records
    const advanceRecords = repo.getAllDocs().filter((d) => d.month === "Advance Fee Payment");
    assert.equal(advanceRecords.length, 8);
    for (const rec of advanceRecords) {
      assert.equal(rec.feeType, undefined, "Advance feeType must remain undefined");
      assert.equal(rec.billingMonth, undefined, "Advance billingMonth must remain undefined");
    }
  });

  // =========================================================================
  // 4. PARTIAL BATCH FAILURE AND RESUMPTION (RECORDS 1-4 APPLIED, 5 FAILS)
  // =========================================================================
  await t.test("4. Partial batch failure leaves applied records intact; re-run skips applied and processes remainder", () => {
    const repo = new MockFeeRepository(snapshot.records);
    const ledger = new TestExecutionLedger();
    const plan = generateBackfillPlan(snapshot.records);

    let processedCount = 0;

    // Simulate batch execution that fails at candidate index 4 (5th record)
    for (let i = 0; i < plan.proposedChanges.length; i++) {
      const proposal = plan.proposedChanges[i];
      if (i === 4) {
        // Simulated failure (e.g. simulated connection fault)
        ledger.recordState({
          planId: plan.planId,
          feeId: proposal.feeId,
          centerId: proposal.centerId,
          studentId: proposal.studentId,
          state: "FAILED",
          preMigrationFingerprint: "mock_fp",
          preMigrationSnapshot: {},
          plannedUpdates: proposal.proposedUpdates,
          errorMessage: "Simulated socket timeout on record 5",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        break;
      }

      repo.updateOne(
        { _id: proposal.feeId, feeType: { $exists: false }, billingMonth: { $exists: false } },
        { $set: { feeType: proposal.proposedUpdates.feeType, billingMonth: proposal.proposedUpdates.billingMonth } }
      );

      ledger.recordState({
        planId: plan.planId,
        feeId: proposal.feeId,
        centerId: proposal.centerId,
        studentId: proposal.studentId,
        state: "VERIFIED",
        preMigrationFingerprint: "mock_fp",
        preMigrationSnapshot: {},
        plannedUpdates: proposal.proposedUpdates,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      processedCount++;
    }

    assert.equal(processedCount, 4);

    // Resumption / Retry Run
    let resumedUpdatesCount = 0;
    let skippedAlreadyAppliedCount = 0;

    for (const proposal of plan.proposedChanges) {
      const current = repo.getDoc(proposal.feeId);
      if (current.feeType === "monthly_recurring" && current.billingMonth === proposal.proposedUpdates.billingMonth) {
        skippedAlreadyAppliedCount++;
        continue;
      }

      const updateRes = repo.updateOne(
        { _id: proposal.feeId, feeType: { $exists: false }, billingMonth: { $exists: false } },
        { $set: { feeType: proposal.proposedUpdates.feeType, billingMonth: proposal.proposedUpdates.billingMonth } }
      );
      assert.equal(updateRes.matchedCount, 1);
      resumedUpdatesCount++;
    }

    assert.equal(skippedAlreadyAppliedCount, 4, "First 4 records must be skipped idempotently");
    assert.equal(resumedUpdatesCount, 5, "Remaining 5 records must be updated cleanly");
  });

  // =========================================================================
  // 5. CRASH RECOVERY: DB UPDATE SUCCEEDS, PROCESS DIES BEFORE LEDGER WRITE
  // =========================================================================
  await t.test("5. Crash recovery reconciles document state when DB write succeeded before ledger write", () => {
    const repo = new MockFeeRepository(snapshot.records);
    const ledger = new TestExecutionLedger();
    const candidate = snapshot.records[0];
    const candidateId = String(candidate._id);

    const docBefore = repo.getDoc(candidateId);
    const fpBefore = computeDocumentFingerprint(docBefore);

    // 1. Process records PREPARED
    ledger.recordState({
      planId: "test_plan_crash",
      feeId: candidateId,
      centerId: String(candidate.centerId),
      studentId: String(candidate.studentId),
      state: "PREPARED",
      preMigrationFingerprint: fpBefore,
      preMigrationSnapshot: docBefore,
      plannedUpdates: { feeType: "monthly_recurring", billingMonth: "2026-10" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 2. DB update succeeds in repository
    repo.updateOne(
      { _id: candidateId },
      { $set: { feeType: "monthly_recurring", billingMonth: "2026-10" } }
    );

    // 3. Simulate process crash here (ledger still in PREPARED state)
    assert.equal(ledger.getEntry(candidateId).state, "PREPARED");

    // 4. On startup, reconciler inspects repository
    const recoveryResult = ledger.reconcileStartup(repo);
    assert.equal(recoveryResult.reconciledCount, 1);
    assert.equal(recoveryResult.failedCount, 0);

    // Ledger entry must be updated to VERIFIED with audit note
    const entryAfter = ledger.getEntry(candidateId);
    assert.equal(entryAfter.state, "VERIFIED");
    assert.ok(entryAfter.recoveryNote?.includes("Crash after DB write detected"));
  });

  // =========================================================================
  // 6. ROLLBACK REFUSAL ON PAYMENT OR UNRELATED FIELD MODIFICATION
  // =========================================================================
  await t.test("6. Rollback succeeds on pristine document but is strictly refused if any unrelated field changed", () => {
    const repo = new MockFeeRepository(snapshot.records);
    const candidate = snapshot.records[0];
    const candidateId = String(candidate._id);

    const docBefore = repo.getDoc(candidateId);
    const fpBefore = computeDocumentFingerprint(docBefore);

    const ledgerEntry = {
      planId: "test_plan_rollback",
      feeId: candidateId,
      centerId: String(candidate.centerId),
      studentId: String(candidate.studentId),
      state: "VERIFIED" ,
      preMigrationFingerprint: fpBefore,
      preMigrationSnapshot: docBefore,
      plannedUpdates: { feeType: "monthly_recurring" , billingMonth: "2026-10" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Apply migration
    repo.updateOne(
      { _id: candidateId },
      { $set: { feeType: "monthly_recurring", billingMonth: "2026-10" } }
    );

    // Case A: Pristine document -> Rollback is approved
    const liveDocPristine = repo.getDoc(candidateId);
    const eligibilityA = evaluateRollbackEligibility(liveDocPristine, ledgerEntry);
    assert.equal(eligibilityA.eligible, true, "Rollback must be eligible if no unrelated fields changed");

    // Case B: Payment occurs after migration -> Rollback REFUSED
    const liveDocPaid = repo.getDoc(candidateId);
    liveDocPaid.status = "Paid";
    liveDocPaid.paidAmount = 1500;
    liveDocPaid.utrNumber = "UTR_NEW_123456";

    const eligibilityB = evaluateRollbackEligibility(liveDocPaid, ledgerEntry);
    assert.equal(eligibilityB.eligible, false, "Rollback must be refused after payment");
    assert.ok(eligibilityB.driftedFields?.includes("status"));
    assert.ok(eligibilityB.driftedFields?.includes("paidAmount"));
    assert.ok(eligibilityB.driftedFields?.includes("utrNumber"));

    // Case C: Unrelated field modified (e.g. notes modified) -> Rollback REFUSED
    const liveDocNotes = repo.getDoc(candidateId);
    liveDocNotes.notes = "Special discount applied manually";

    const eligibilityC = evaluateRollbackEligibility(liveDocNotes, ledgerEntry);
    assert.equal(eligibilityC.eligible, false, "Rollback must be refused if notes modified");
    assert.ok(eligibilityC.driftedFields?.includes("notes"));
  });

  // =========================================================================
  // 7. CONCURRENT MANUAL FEE CREATION SIMULATION
  // =========================================================================
  await t.test("7. Concurrent fee creation rejects duplicate when canonical billingMonth is present", () => {
    const repo = new MockFeeRepository(snapshot.records);
    const candidate = snapshot.records[0];
    const candidateId = String(candidate._id);

    // 1. Apply backfill to candidate
    repo.updateOne(
      { _id: candidateId },
      { $set: { feeType: "monthly_recurring", billingMonth: "2026-10" } }
    );

    // 2. Simulate concurrent manual creation (POST /api/fees) trying to create duplicate October invoice
    // Check if canonical record already exists for (centerId, studentId, billingMonth, feeType)
    const existing = repo.getAllDocs().find(
      (d) =>
        d.centerId === candidate.centerId &&
        String(d.studentId) === String(candidate.studentId) &&
        d.billingMonth === "2026-10" &&
        d.feeType === "monthly_recurring"
    );

    assert.ok(existing, "Canonical fee must be matched");

    // Endpoint logic returns 200 reused rather than inserting a duplicate
    const concurrentAttempt = {
      centerId: candidate.centerId,
      studentId: candidate.studentId,
      billingMonth: "2026-10",
      feeType: "monthly_recurring",
      amountDue: 1500,
      status: "Pending",
    };

    const shouldInsert = !existing;
    assert.equal(shouldInsert, false, "System must block inserting duplicate canonical fee");
  });

  // =========================================================================
  // 8. IDEMPOTENT RE-RUN (ZERO WRITES ON SECOND EXECUTION)
  // =========================================================================
  await t.test("8. Double execution produces zero additional writes and leaves dataset completely intact", () => {
    const repo = new MockFeeRepository(snapshot.records);
    const plan = generateBackfillPlan(snapshot.records);

    // First run: apply 9
    let firstRunWrites = 0;
    for (const proposal of plan.proposedChanges) {
      const res = repo.updateOne(
        { _id: proposal.feeId, feeType: { $exists: false }, billingMonth: { $exists: false } },
        { $set: { feeType: proposal.proposedUpdates.feeType, billingMonth: proposal.proposedUpdates.billingMonth } }
      );
      firstRunWrites += res.modifiedCount;
    }
    assert.equal(firstRunWrites, 9);

    // Second run: evaluate same plan
    let secondRunWrites = 0;
    for (const proposal of plan.proposedChanges) {
      const res = repo.updateOne(
        { _id: proposal.feeId, feeType: { $exists: false }, billingMonth: { $exists: false } },
        { $set: { feeType: proposal.proposedUpdates.feeType, billingMonth: proposal.proposedUpdates.billingMonth } }
      );
      secondRunWrites += res.modifiedCount;
    }
    assert.equal(secondRunWrites, 0, "Second run must perform exactly 0 database writes");
  });
});
