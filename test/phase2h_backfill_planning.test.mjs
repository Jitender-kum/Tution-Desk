import test from "node:test";
import assert from "node:assert/strict";

const {
  generateBackfillPlan,
  formatBackfillDryRunReport,
  isStrictCanonicalBillingMonth,
  isInvalidBillingMonthRecord,
  validateRecordIdentifiers,
  serializeRecurringIdentityKey,
  deserializeRecurringIdentityKey,
  MIGRATION_OPERATIONAL_GUIDELINES,
} = await import("../tution-desk-be/src/lib/backfillPlanner.ts");

const {
  classifyFeeRecord,
} = await import("../tution-desk-be/src/lib/reconciliationEngine.ts");

test("TuitionDesk Phase 2H: Safe Legacy Fee Backfill Planning & Dry-Run Suite", async (t) => {
  // =========================================================================
  // 1. IMMUTABILITY OF SOURCE RECORDS
  // =========================================================================
  await t.test("1. A proposed backfill must not alter any source record (immutability check)", () => {
    const rawRecord = Object.freeze({
      _id: "fee_freeze_1",
      centerId: "center_101",
      studentId: "student_501",
      month: "October 2026",
      status: "Paid",
      amountDue: 2000,
    });

    const dataset = [rawRecord];
    const plan = generateBackfillPlan(dataset);

    // Assert that planning succeeded and proposed the change
    assert.equal(plan.proposedChanges.length, 1);
    assert.equal(plan.proposedChanges[0].proposedUpdates.feeType, "monthly_recurring");
    assert.equal(plan.proposedChanges[0].proposedUpdates.billingMonth, "2026-10");

    // Assert source record was NOT mutated
    assert.equal(rawRecord.feeType, undefined);
    assert.equal(rawRecord.billingMonth, undefined);
    assert.equal(rawRecord.month, "October 2026");
  });

  // =========================================================================
  // 2. EXPLICIT ADVANCE + CANONICAL BILLINGMONTH MUST REMAIN ADVANCE
  // =========================================================================
  await t.test("2. Explicit advance + canonical billingMonth must remain advance and be excluded", () => {
    const advanceFee = {
      _id: "fee_adv_canonical",
      centerId: "center_101",
      studentId: "student_501",
      feeType: "advance",
      billingMonth: "2026-10",
      status: "Paid",
      amountDue: 5000,
    };

    const plan = generateBackfillPlan([advanceFee]);

    assert.equal(plan.proposedChanges.length, 0);
    assert.equal(plan.summary.nonRecurringAdvanceCount, 1);
    assert.equal(plan.summary.safeRecurringBackfillCandidatesCount, 0);

    const excluded = plan.excludedRecords.find((r) => r.feeId === "fee_adv_canonical");
    assert.ok(excluded);
    assert.equal(excluded.reason, "NON_RECURRING_ADVANCE");
  });

  // =========================================================================
  // 3. EXPLICIT ADHOC + MONTH LABEL MUST REMAIN ADHOC
  // =========================================================================
  await t.test("3. Explicit adhoc + month label must remain adhoc and be excluded", () => {
    const adhocFee = {
      _id: "fee_adhoc_label",
      centerId: "center_101",
      studentId: "student_501",
      feeType: "adhoc",
      month: "October 2026",
      title: "Annual Lab Fee",
      status: "Paid",
      amountDue: 800,
    };

    const plan = generateBackfillPlan([adhocFee]);

    assert.equal(plan.proposedChanges.length, 0);
    assert.equal(plan.summary.nonRecurringAdhocCount, 1);

    const excluded = plan.excludedRecords.find((r) => r.feeId === "fee_adhoc_label");
    assert.ok(excluded);
    assert.equal(excluded.reason, "NON_RECURRING_ADHOC");
  });

  // =========================================================================
  // 4. EXISTING VALID BILLINGMONTH MUST NEVER BE OVERWRITTEN
  // =========================================================================
  await t.test("4. Existing valid billingMonth must never be overwritten", () => {
    // Record has valid canonical billingMonth "2026-10", but month label might say "Oct 2026" or something else
    const feeWithCanonicalMonth = {
      _id: "fee_has_canon_bm",
      centerId: "center_101",
      studentId: "student_501",
      billingMonth: "2026-10",
      month: "October 2026",
      status: "Pending",
      // missing feeType
    };

    const plan = generateBackfillPlan([feeWithCanonicalMonth]);

    assert.equal(plan.proposedChanges.length, 1);
    const proposal = plan.proposedChanges[0];
    assert.equal(proposal.proposedUpdates.billingMonth, "2026-10");
    assert.equal(proposal.proposedUpdates.feeType, "monthly_recurring");
    assert.equal(proposal.currentValues.billingMonth, "2026-10");

    // If both feeType and canonical billingMonth are already set, it's ALREADY_CANONICAL
    const alreadyCanonical = {
      _id: "fee_already_canonical",
      centerId: "center_101",
      studentId: "student_502",
      feeType: "monthly_recurring",
      billingMonth: "2026-10",
      status: "Paid",
    };

    const plan2 = generateBackfillPlan([alreadyCanonical]);
    assert.equal(plan2.proposedChanges.length, 0);
    assert.equal(plan2.summary.alreadyCanonicalCount, 1);
  });

  // =========================================================================
  // 5. INVALID DATES/MONTHS MUST NOT BECOME RECURRING AUTOMATICALLY
  // =========================================================================
  await t.test("5. Invalid dates/months must not become recurring automatically and match counters", () => {
    const invalidDataset = [
      {
        _id: "fee_inv_1",
        centerId: "center_valid_1",
        studentId: "student_valid_1",
        billingMonth: "2099-05", // Out of range year
        status: "Paid",
      },
      {
        _id: "fee_inv_2",
        centerId: "center_valid_1",
        studentId: "student_valid_2",
        billingMonth: "2026-13", // Invalid month 13
        status: "Pending",
      },
      {
        _id: "fee_inv_3",
        centerId: "center_valid_1",
        studentId: "student_valid_3",
        month: "October 1995", // Out of range year
        status: "Paid",
      },
      {
        _id: "fee_inv_4",
        centerId: "center_valid_1",
        studentId: "student_valid_4",
        billingMonth: "   ", // Whitespace-only billingMonth
        status: "Paid",
      },
    ];

    const plan = generateBackfillPlan(invalidDataset);

    assert.equal(plan.proposedChanges.length, 0);
    assert.equal(plan.summary.safeRecurringBackfillCandidatesCount, 0);
    assert.equal(plan.summary.invalidBillingMonthCount, 4);

    const invalidExcluded = plan.excludedRecords.filter((r) => r.reason === "INVALID_BILLING_MONTH");
    assert.equal(invalidExcluded.length, plan.summary.invalidBillingMonthCount);
    assert.equal(plan.summary.finalUniqueIndexReadiness.isSafeToCreate, false);
  });

  // =========================================================================
  // 6. MULTIPLE RECURRING RECORDS MUST BLOCK BACKFILL FOR THAT IDENTITY
  // =========================================================================
  await t.test("6. Multiple recurring records must block backfill for that identity", () => {
    const duplicateDataset = [
      // Record 1: Already canonical Paid record
      {
        _id: "f_paid_canon",
        centerId: "center_1",
        studentId: "student_999",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
        amountDue: 2000,
      },
      // Record 2: Unbackfilled Pending record for SAME student and month
      {
        _id: "f_pending_legacy",
        centerId: "center_1",
        studentId: "student_999",
        month: "Oct 2026",
        status: "Pending",
        amountDue: 2000,
      },
    ];

    const plan = generateBackfillPlan(duplicateDataset);

    // CRITICAL: Backfilling Record 2 would create a duplicate key collision with Record 1!
    // Therefore, backfill MUST be blocked for all records of that identity.
    assert.equal(plan.proposedChanges.length, 0);
    assert.equal(plan.summary.duplicateConflictGroupsCount, 1);
    assert.equal(plan.summary.duplicateConflictsCount, 2);
    assert.equal(plan.duplicateConflictGroups[0].canonicalBillingMonth, "2026-10");
    assert.equal(plan.summary.finalUniqueIndexReadiness.isSafeToCreate, false);
    assert.ok(
      plan.summary.finalUniqueIndexReadiness.blockingIssues.some((issue) =>
        issue.includes("duplicate recurring group")
      )
    );
  });

  // =========================================================================
  // 7. MISSING FEETYPE WITHOUT AUTHORITATIVE EVIDENCE
  // =========================================================================
  await t.test("7. Missing feeType must not automatically become recurring without authoritative evidence", () => {
    const ambiguousDataset = [
      {
        _id: "f_no_meta",
        centerId: "center_1",
        studentId: "student_100",
        status: "Pending",
      },
      {
        _id: "f_non_month_desc",
        centerId: "center_1",
        studentId: "student_101",
        month: "Session 2026-2027",
        title: "Session Fee",
        status: "Paid",
      },
      {
        _id: "f_quarter",
        centerId: "center_1",
        studentId: "student_102",
        month: "Quarter 1",
        status: "Paid",
      },
    ];

    const plan = generateBackfillPlan(ambiguousDataset);

    // Zero proposals! None of these have authoritative monthly recurring evidence
    assert.equal(plan.proposedChanges.length, 0);
    assert.equal(plan.summary.ambiguousRecordsRequiringReviewCount, 3);
    assert.equal(plan.ambiguousRecords.length, 3);
    assert.equal(plan.summary.finalUniqueIndexReadiness.isSafeToCreate, false);
  });

  // =========================================================================
  // 8. SAFE RECURRING BACKFILL PLANNING WITH CLEAN UNIQUE INDEX READINESS
  // =========================================================================
  await t.test("8. Clean dataset generates safe proposals and reports index-ready status", () => {
    const cleanDataset = [
      // 1. Clean legacy record 1: resolvable month label "October 2026"
      {
        _id: "fee_legacy_1",
        centerId: "center_alpha",
        studentId: "student_alpha_1",
        month: "October 2026",
        status: "Paid",
        amountDue: 1500,
      },
      // 2. Clean legacy record 2: canonical billingMonth present but feeType missing
      {
        _id: "fee_legacy_2",
        centerId: "center_alpha",
        studentId: "student_alpha_2",
        billingMonth: "2026-10",
        status: "Pending",
        amountDue: 2000,
      },
      // 3. Clean legacy record 3: resolvable short month label "Nov 2026"
      {
        _id: "fee_legacy_3",
        centerId: "center_alpha",
        studentId: "student_alpha_1",
        month: "Nov 2026",
        status: "Paid",
        amountDue: 1500,
      },
      // 4. Non-recurring advance fee for same center (does not interfere with recurring)
      {
        _id: "fee_adv_clean",
        centerId: "center_alpha",
        studentId: "student_alpha_1",
        feeType: "advance",
        month: "October 2026",
        status: "Paid",
        amountDue: 4000,
      },
    ];

    const plan = generateBackfillPlan(cleanDataset);

    assert.equal(plan.summary.totalRecordsInspected, 4);
    assert.equal(plan.summary.safeRecurringBackfillCandidatesCount, 3);
    assert.equal(plan.summary.nonRecurringAdvanceCount, 1);
    assert.equal(plan.summary.ambiguousRecordsRequiringReviewCount, 0);
    assert.equal(plan.summary.duplicateConflictGroupsCount, 0);

    // Verify all 3 proposed changes
    assert.equal(plan.proposedChanges[0].proposedUpdates.billingMonth, "2026-10");
    assert.equal(plan.proposedChanges[0].proposedUpdates.feeType, "monthly_recurring");

    assert.equal(plan.proposedChanges[1].proposedUpdates.billingMonth, "2026-10");
    assert.equal(plan.proposedChanges[1].proposedUpdates.feeType, "monthly_recurring");

    assert.equal(plan.proposedChanges[2].proposedUpdates.billingMonth, "2026-11");
    assert.equal(plan.proposedChanges[2].proposedUpdates.feeType, "monthly_recurring");

    // All recurring records become ready post-backfill without duplicates or ambiguous items
    assert.equal(plan.summary.finalUniqueIndexReadiness.isSafeToCreate, true);
    assert.equal(plan.summary.finalUniqueIndexReadiness.blockingIssues.length, 0);
    assert.equal(plan.summary.finalUniqueIndexReadiness.readyRecordsCountAfterBackfill, 3);
    assert.equal(plan.summary.finalUniqueIndexReadiness.simulatedTargetRecords, 3);
  });

  // =========================================================================
  // 9. CONFLICTING METADATA: FEETYPE VS NON-RECURRING MARKERS
  // =========================================================================
  await t.test("9. Conflicting metadata fails safe to AMBIGUOUS_LEGACY without creating recurring proposals", () => {
    // 9a: feeType='monthly_recurring' + isAdvance=true
    const conflict1 = {
      _id: "f_conf_1",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "monthly_recurring",
      isAdvance: true,
      month: "October 2026",
      status: "Paid",
    };
    const class1 = classifyFeeRecord(conflict1);
    assert.equal(class1.category, "AMBIGUOUS_LEGACY");
    assert.ok(class1.reason.includes("Conflicting metadata"));

    // 9b: feeType='monthly_recurring' + title='Advance Payment'
    const conflict2 = {
      _id: "f_conf_2",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "monthly_recurring",
      title: "Advance Payment for Quarter 1",
      month: "October 2026",
      status: "Paid",
    };
    const class2 = classifyFeeRecord(conflict2);
    assert.equal(class2.category, "AMBIGUOUS_LEGACY");

    // 9c: feeType='monthly_recurring' + title='Annual Lab Fee'
    const conflict3 = {
      _id: "f_conf_3",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "monthly_recurring",
      title: "Annual Lab Fee",
      month: "October 2026",
      status: "Paid",
    };
    const class3 = classifyFeeRecord(conflict3);
    assert.equal(class3.category, "AMBIGUOUS_LEGACY");

    // 9d: feeType='monthly_recurring' + title='Admission Registration Fee'
    const conflict4 = {
      _id: "f_conf_4",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "monthly_recurring",
      title: "Admission Registration Fee",
      month: "October 2026",
      status: "Paid",
    };
    const class4 = classifyFeeRecord(conflict4);
    assert.equal(class4.category, "AMBIGUOUS_LEGACY");

    // 9e: feeType='advance' + isAdvance=false
    const conflict5 = {
      _id: "f_conf_5",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "advance",
      isAdvance: false,
      status: "Paid",
    };
    const class5 = classifyFeeRecord(conflict5);
    assert.equal(class5.category, "AMBIGUOUS_LEGACY");

    // Ensure none of these generate recurring proposals in backfill planner
    const plan = generateBackfillPlan([conflict1, conflict2, conflict3, conflict4, conflict5]);
    assert.equal(plan.proposedChanges.length, 0);
    assert.equal(plan.summary.ambiguousRecordsRequiringReviewCount, 5);
  });

  // =========================================================================
  // 10. COLLISION-SAFE IDENTITY KEYS (DELIMITER SAFETY)
  // =========================================================================
  await t.test("10. IDs containing delimiters cannot collide under JSON tuple serialization", () => {
    // Record A: centerId="center:alpha", studentId="student_1"
    const recA = {
      _id: "f_delim_a",
      centerId: "center:alpha",
      studentId: "student_1",
      feeType: "monthly_recurring",
      billingMonth: "2026-10",
      status: "Paid",
    };
    // Record B: centerId="center", studentId="alpha:student_1"
    const recB = {
      _id: "f_delim_b",
      centerId: "center",
      studentId: "alpha:student_1",
      feeType: "monthly_recurring",
      billingMonth: "2026-10",
      status: "Paid",
    };

    const keyA = serializeRecurringIdentityKey(recA.centerId, recA.studentId, "2026-10");
    const keyB = serializeRecurringIdentityKey(recB.centerId, recB.studentId, "2026-10");

    assert.notEqual(keyA, keyB);
    assert.deepEqual(deserializeRecurringIdentityKey(keyA), ["center:alpha", "student_1", "2026-10"]);
    assert.deepEqual(deserializeRecurringIdentityKey(keyB), ["center", "alpha:student_1", "2026-10"]);

    const plan = generateBackfillPlan([recA, recB]);
    // Must NOT be treated as duplicate conflict
    assert.equal(plan.summary.duplicateConflictGroupsCount, 0);
    assert.equal(plan.summary.alreadyCanonicalCount, 2);
  });

  // =========================================================================
  // 11. MISSING OR WHITESPACE CENTERID / STUDENTID
  // =========================================================================
  await t.test("11. Missing or whitespace centerId/studentId fails safe with detailed diagnostics", () => {
    const invalidIdDataset = [
      {
        _id: "f_empty_center",
        centerId: "   ",
        studentId: "student_101",
        month: "October 2026",
        status: "Paid",
      },
      {
        _id: "f_unknown_center",
        centerId: "unknown_center",
        studentId: "student_101",
        month: "October 2026",
        status: "Paid",
      },
      {
        _id: "f_empty_student",
        centerId: "center_101",
        studentId: "",
        month: "October 2026",
        status: "Paid",
      },
      {
        _id: "f_unknown_student",
        centerId: "center_101",
        studentId: "unknown_student",
        month: "October 2026",
        status: "Paid",
      },
    ];

    const plan = generateBackfillPlan(invalidIdDataset);

    assert.equal(plan.proposedChanges.length, 0);
    assert.equal(plan.excludedRecords.length, 4);

    for (const item of plan.excludedRecords) {
      assert.equal(item.reason, "MISSING_REQUIRED_IDENTIFIERS");
      assert.ok(item.explanation.includes("centerId") || item.explanation.includes("studentId"));
    }

    assert.equal(plan.summary.finalUniqueIndexReadiness.isSafeToCreate, false);
    assert.ok(
      plan.summary.finalUniqueIndexReadiness.blockingIssues.some((issue) =>
        issue.includes("lack required centerId or studentId")
      )
    );
  });

  // =========================================================================
  // 12. REPEATED DRY-RUNS WITH IDENTICAL DETERMINISTIC OUTPUT
  // =========================================================================
  await t.test("12. Repeated dry-runs produce strictly deterministic and identical output", () => {
    const dataset = [
      {
        _id: "rec_1",
        centerId: "c1",
        studentId: "s1",
        month: "October 2026",
        status: "Paid",
      },
      {
        _id: "rec_2",
        centerId: "c1",
        studentId: "s2",
        month: "Oct 2026",
        status: "Pending",
      },
      {
        _id: "rec_adv",
        centerId: "c1",
        studentId: "s1",
        feeType: "advance",
        status: "Paid",
      },
    ];

    const plan1 = generateBackfillPlan(dataset);
    const plan2 = generateBackfillPlan(dataset);

    assert.equal(plan1.proposedChanges.length, plan2.proposedChanges.length);
    assert.deepEqual(plan1.summary, plan2.summary);
    assert.deepEqual(plan1.proposedChanges, plan2.proposedChanges);
    assert.deepEqual(plan1.excludedRecords, plan2.excludedRecords);
  });

  // =========================================================================
  // 13. OPERATIONAL GUIDELINES CONSTANT INTEGRITY
  // =========================================================================
  await t.test("13. Migration operational guidelines export expected parameters", () => {
    assert.equal(MIGRATION_OPERATIONAL_GUIDELINES.recommendedProcessingScope, "PER_CENTER");
    assert.equal(MIGRATION_OPERATIONAL_GUIDELINES.theoreticalBatchSizeRange.min, 100);
    assert.equal(MIGRATION_OPERATIONAL_GUIDELINES.theoreticalBatchSizeRange.max, 250);
    assert.equal(MIGRATION_OPERATIONAL_GUIDELINES.theoreticalTimeoutSeconds, 60);
    assert.ok(MIGRATION_OPERATIONAL_GUIDELINES.idempotencyRequirements.length >= 2);
    assert.ok(MIGRATION_OPERATIONAL_GUIDELINES.rollbackPlan.length >= 2);
  });

  // =========================================================================
  // 14. DRY-RUN REPORT FORMATTING AND PII MASKING
  // =========================================================================
  await t.test("14. Dry-run report formats correctly without leaking PII", () => {
    const dataset = [
      {
        _id: "507f1f77bcf86cd799439011",
        centerId: "507f1f77bcf86cd799439022",
        studentId: "507f1f77bcf86cd799439033",
        month: "October 2026",
        status: "Paid",
        amountDue: 2500,
      },
    ];

    const plan = generateBackfillPlan(dataset);
    const reportText = formatBackfillDryRunReport(plan);

    assert.ok(reportText.includes("TuitionDesk Phase 2H: Safe Legacy Fee Backfill Plan"));
    assert.ok(reportText.includes("MODE: STRICT DRY-RUN / PROPOSAL ONLY"));
    assert.ok(reportText.includes("Candidate #1: Fee ID: 507f...9011"));
    assert.ok(reportText.includes("Center: 507f...9022"));
    assert.ok(reportText.includes("Student: 507f...9033"));
    assert.ok(!reportText.includes("507f1f77bcf86cd799439011")); // Unmasked ID must not appear
  });

  // =========================================================================
  // 15. STRICT CANONICAL BILLING MONTH AND RECORD VALIDATORS
  // =========================================================================
  await t.test("15. isStrictCanonicalBillingMonth and isInvalidBillingMonthRecord validate correctly", () => {
    assert.equal(isStrictCanonicalBillingMonth("2026-10"), true);
    assert.equal(isStrictCanonicalBillingMonth("2020-01"), true);
    assert.equal(isStrictCanonicalBillingMonth("2035-12"), true);

    assert.equal(isStrictCanonicalBillingMonth("2026-00"), false);
    assert.equal(isStrictCanonicalBillingMonth("2026-13"), false);
    assert.equal(isStrictCanonicalBillingMonth("2019-12"), false);
    assert.equal(isStrictCanonicalBillingMonth("2036-01"), false);
    assert.equal(isStrictCanonicalBillingMonth("Oct 2026"), false);
    assert.equal(isStrictCanonicalBillingMonth("2026-10-01"), false);
    assert.equal(isStrictCanonicalBillingMonth(""), false);
    assert.equal(isStrictCanonicalBillingMonth(undefined), false);

    assert.equal(isInvalidBillingMonthRecord({ _id: "1", centerId: "c", studentId: "s", billingMonth: "2026-10", status: "Paid" }).isInvalid, false);
    assert.equal(isInvalidBillingMonthRecord({ _id: "2", centerId: "c", studentId: "s", billingMonth: "2099-01", status: "Paid" }).isInvalid, true);
    assert.equal(isInvalidBillingMonthRecord({ _id: "3", centerId: "c", studentId: "s", billingMonth: "   ", status: "Paid" }).isInvalid, true);
    assert.equal(isInvalidBillingMonthRecord({ _id: "4", centerId: "c", studentId: "s", month: "October 1995", status: "Paid" }).isInvalid, true);
  });
});
