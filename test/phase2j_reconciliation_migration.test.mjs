import test from "node:test";
import assert from "node:assert/strict";
import { readFeeSnapshotFile } from "../tution-desk-be/src/lib/snapshotReader.ts";
import { generateBackfillPlan } from "../tution-desk-be/src/lib/backfillPlanner.ts";
import { reconcileFeeDataset } from "../tution-desk-be/src/lib/reconciliationEngine.ts";

test("TuitionDesk Phase 2J: Production Fee Reconciliation & Controlled Migration Suite", async (t) => {
  const snapshot = readFeeSnapshotFile(".audit_snapshot/test/fees.bson");
  const rawRecords = snapshot.records;

  // =========================================================================
  // 1. NOVEMBER DUPLICATE FORENSIC EVIDENCE INSPECTION
  // =========================================================================
  await t.test("1. Forensic inspection of November records confirms distinct creation and payment evidence", () => {
    const novRecords = rawRecords.filter(
      (r) => /nov/i.test(r.month || "") || /nov/i.test(r.title || "") || r.billingMonth === "2026-11"
    );

    assert.equal(novRecords.length, 2, "Exactly 2 November records exist in snapshot");

    const recordA = novRecords.find((r) => r._id === "6adaeb6ef0f3a801a218e6df");
    const recordB = novRecords.find((r) => r._id === "6adaebb4f0f3a801a218e6e0");

    assert.ok(recordA, "Record A (Pending, ₹2,000) must exist");
    assert.ok(recordB, "Record B (Paid, ₹751) must exist");

    // Both point to identical student and center
    assert.equal(String(recordA.studentId), String(recordB.studentId));
    assert.equal(recordA.centerId, recordB.centerId);
    assert.equal(recordA.month, "November 2026");
    assert.equal(recordB.month, "November 2026");

    // Record A: Unpaid, round monthly rate, due Nov 15
    assert.equal(recordA.amountDue, 2000);
    assert.equal(recordA.status, "Pending");
    assert.equal(new Date(recordA.dueDate).toISOString(), "2026-11-15T00:00:00.000Z");
    assert.equal(recordA.paidAmount, undefined);
    assert.equal(recordA.utrNumber, undefined);

    // Record B: Paid via UPI, odd rate (₹751), due Nov 10
    assert.equal(recordB.amountDue, 751);
    assert.equal(recordB.status, "Paid");
    assert.equal(new Date(recordB.dueDate).toISOString(), "2026-11-10T00:00:00.000Z");
    assert.equal(recordB.paidAmount, 751);
    assert.equal(recordB.utrNumber, "CLAIM_DELAYED_985607");
    assert.equal(recordB.upiTransactionId, "YOUPI-FULL-5678");
    assert.equal(recordB.paymentMode, "Online/UPI");

    // Creation timeline: Record B created ~70.5 seconds after Record A
    const tA = new Date(recordA.createdAt).getTime();
    const tB = new Date(recordB.createdAt).getTime();
    const deltaSeconds = (tB - tA) / 1000;
    assert.ok(deltaSeconds >= 70 && deltaSeconds <= 71, `Delta should be ~70.5s, was ${deltaSeconds}`);
  });

  // =========================================================================
  // 2. ADMINISTRATIVE RESOLUTION MODELING
  // =========================================================================
  await t.test("2. Administrative resolution Option A safely resolves duplicate conflict group", () => {
    // Model Option A: Center administrator confirms ₹751 was agreed fee and ₹2,000 was accidental draft
    // Record A is archived/deleted or marked non-recurring adhoc cancellation
    const simulatedRecords = rawRecords.map((r) => {
      if (r._id === "6adaeb6ef0f3a801a218e6df") {
        return { ...r, feeType: "adhoc", title: "Cancelled Draft - Superseded by Fee 6adaebb4f0f3a801a218e6e0", status: "Cancelled" };
      }
      return { ...r };
    });

    const planAfterOptionA = generateBackfillPlan(simulatedRecords);

    // After resolving Record A, Record B is the sole active candidate for 2026-11
    assert.equal(planAfterOptionA.duplicateConflictGroups.length, 0, "Zero duplicate conflict groups remain");
    assert.equal(planAfterOptionA.summary.safeRecurringBackfillCandidatesCount, 10, "10 recurring candidates (9 Oct + 1 Nov)");
    assert.equal(planAfterOptionA.summary.finalUniqueIndexReadiness.isSafeToCreate, true, "Partial unique index is safe to create");
  });

  // =========================================================================
  // 3. OCTOBER BACKFILL ELIGIBILITY & IMMUTABILITY
  // =========================================================================
  await t.test("3. October backfill strictly isolates 9 clean records without touching advance fees", () => {
    const plan = generateBackfillPlan(rawRecords);

    assert.equal(plan.proposedChanges.length, 9, "Exactly 9 October records are eligible");
    for (const change of plan.proposedChanges) {
      assert.equal(change.proposedUpdates.billingMonth, "2026-10");
      assert.equal(change.proposedUpdates.feeType, "monthly_recurring");
      assert.ok(change.currentValues.status, "Existing status must be captured");
    }

    // Excluded records: 8 advance fees
    const advanceExcluded = plan.excludedRecords.filter((r) => r.reason === "NON_RECURRING_ADVANCE");
    assert.equal(advanceExcluded.length, 8, "All 8 advance records must be excluded from backfill");

    // Blocked duplicate conflict: 1 group containing the 2 November records
    assert.equal(plan.duplicateConflictGroups.length, 1);
    const novGroup = plan.duplicateConflictGroups[0];
    assert.equal(novGroup.canonicalBillingMonth, "2026-11");
    assert.equal(novGroup.recordCount, 2);
    assert.deepEqual(novGroup.feeIds.sort(), ["6adaeb6ef0f3a801a218e6df", "6adaebb4f0f3a801a218e6e0"].sort());
  });

  // =========================================================================
  // 4. PARTIAL UNIQUE INDEX READINESS PREFLIGHT
  // =========================================================================
  await t.test("4. Partial unique index filter expression correctly isolates recurring population", () => {
    // Target filter: { feeType: "monthly_recurring", billingMonth: { $type: "string" } }
    function matchesPartialFilter(doc) {
      return doc.feeType === "monthly_recurring" && typeof doc.billingMonth === "string";
    }

    // 1. Current raw dataset before backfill
    const indexedBefore = rawRecords.filter(matchesPartialFilter);
    assert.equal(indexedBefore.length, 0, "No raw records match partial filter before backfill");

    // 2. Dataset after October backfill (November still unresolved)
    const afterOctBackfill = rawRecords.map((r) => {
      // 9 October records get backfilled
      if (/oct/i.test(r.month || "")) {
        return { ...r, feeType: "monthly_recurring", billingMonth: "2026-10" };
      }
      return r;
    });

    const indexedOct = afterOctBackfill.filter(matchesPartialFilter);
    assert.equal(indexedOct.length, 9);

    // Verify all 9 have unique keys
    const octKeys = new Set(indexedOct.map((r) => `${r.centerId}:${r.studentId}:${r.billingMonth}:${r.feeType}`));
    assert.equal(octKeys.size, 9, "All 9 October recurring records have unique composite keys");

    // 3. Advance fees are excluded from the partial index
    const advRecords = rawRecords.filter((r) => r.isAdvance || /advance/i.test(r.title || "") || /advance/i.test(r.month || ""));
    assert.equal(advRecords.length, 8);
    for (const adv of advRecords) {
      assert.equal(matchesPartialFilter(adv), false, "Advance fees never match the partial unique index filter");
    }
  });
});
