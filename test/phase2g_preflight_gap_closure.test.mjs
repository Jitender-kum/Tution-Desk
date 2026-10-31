import test from "node:test";
import assert from "node:assert/strict";

const {
  classifyFeeRecord,
  resolveBillingMonth,
  isNonRecurringFee,
  reconcileFeeDataset,
  maskName,
  maskPhone,
  maskIdentifier,
} = await import("../tution-desk-be/src/lib/reconciliationEngine.ts");

test("TuitionDesk Phase 2G.1: Legacy Fee Classification & Preflight Gap Closure", async (t) => {
  // =========================================================================
  // 1. MISSING FEETYPE WITH ADVANCE METADATA
  // =========================================================================
  await t.test("1. Missing feeType with advance metadata is classified as CONFIRMED_ADVANCE", () => {
    // 1a. isAdvance: true flag without feeType
    const fee1 = {
      _id: "fee_adv_1",
      centerId: "center_1",
      studentId: "student_1",
      month: "October 2026",
      isAdvance: true,
      status: "Paid",
    };
    const class1 = classifyFeeRecord(fee1);
    assert.equal(class1.category, "CONFIRMED_ADVANCE");
    assert.equal(class1.inferredFeeType, "advance");
    assert.equal(isNonRecurringFee(fee1), true);

    // 1b. Title includes "Advance Fee" without feeType
    const fee2 = {
      _id: "fee_adv_2",
      centerId: "center_1",
      studentId: "student_1",
      title: "Advance Fee for Term 1",
      month: "October 2026",
      status: "Paid",
    };
    const class2 = classifyFeeRecord(fee2);
    assert.equal(class2.category, "CONFIRMED_ADVANCE");
    assert.equal(class2.inferredFeeType, "advance");
    assert.equal(isNonRecurringFee(fee2), true);

    // 1c. Month label is "Advance Payment"
    const fee3 = {
      _id: "fee_adv_3",
      centerId: "center_1",
      studentId: "student_1",
      month: "Advance Payment",
      status: "Paid",
    };
    const class3 = classifyFeeRecord(fee3);
    assert.equal(class3.category, "CONFIRMED_ADVANCE");
    assert.equal(class3.inferredFeeType, "advance");
    assert.equal(isNonRecurringFee(fee3), true);

    // Month mapping should be ineligible for all advance records
    assert.equal(resolveBillingMonth(fee1).confidence, "ineligible");
    assert.equal(resolveBillingMonth(fee2).confidence, "ineligible");
    assert.equal(resolveBillingMonth(fee3).confidence, "ineligible");
  });

  // =========================================================================
  // 2. MISSING FEETYPE WITH CLEAR RECURRING EVIDENCE
  // =========================================================================
  await t.test("2. Missing feeType with clear recurring evidence is classified as CONFIRMED_RECURRING", () => {
    // 2a. Canonical billingMonth present in schema
    const fee1 = {
      _id: "fee_rec_1",
      centerId: "center_1",
      studentId: "student_1",
      billingMonth: "2026-10",
      status: "Paid",
    };
    const class1 = classifyFeeRecord(fee1);
    assert.equal(class1.category, "CONFIRMED_RECURRING");
    assert.equal(class1.inferredFeeType, "monthly_recurring");
    assert.equal(isNonRecurringFee(fee1), false);
    assert.equal(resolveBillingMonth(fee1).canonicalMonth, "2026-10");

    // 2b. Month label is recognizable cycle (e.g., "Oct 2026", "October 2026", "15 Oct 2026")
    const fee2 = {
      _id: "fee_rec_2",
      centerId: "center_1",
      studentId: "student_1",
      month: "Oct 2026",
      status: "Pending",
    };
    const class2 = classifyFeeRecord(fee2);
    assert.equal(class2.category, "CONFIRMED_RECURRING");
    assert.equal(class2.inferredFeeType, "monthly_recurring");
    assert.equal(isNonRecurringFee(fee2), false);
    assert.equal(resolveBillingMonth(fee2).canonicalMonth, "2026-10");
  });

  // =========================================================================
  // 3. MISSING FEETYPE WITH INSUFFICIENT EVIDENCE
  // =========================================================================
  await t.test("3. Missing feeType with insufficient evidence is classified as AMBIGUOUS_LEGACY", () => {
    // 3a. Blank or missing month and title
    const fee1 = {
      _id: "fee_amb_1",
      centerId: "center_1",
      studentId: "student_1",
      status: "Pending",
    };
    const class1 = classifyFeeRecord(fee1);
    assert.equal(class1.category, "AMBIGUOUS_LEGACY");
    assert.equal(class1.inferredFeeType, null);
    assert.equal(resolveBillingMonth(fee1).confidence, "ambiguous");

    // 3b. Non-standard description without month or year ("General Fee", "Quarter 1", "Session 2026")
    const fee2 = {
      _id: "fee_amb_2",
      centerId: "center_1",
      studentId: "student_1",
      month: "Special Session",
      title: "Session dues",
      status: "Paid",
    };
    const class2 = classifyFeeRecord(fee2);
    assert.equal(class2.category, "AMBIGUOUS_LEGACY");
    assert.equal(class2.inferredFeeType, null);
    assert.equal(resolveBillingMonth(fee2).confidence, "ambiguous");
  });

  // =========================================================================
  // 4. EXPLICIT NON-RECURRING FEE TYPES
  // =========================================================================
  await t.test("4. Explicit feeType always takes precedence even if month/title has recurring look", () => {
    // 4a. feeType: 'advance' takes precedence even if month looks like 'October 2026'
    const feeAdvance = {
      _id: "fee_exp_adv",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "advance",
      month: "October 2026",
      status: "Paid",
    };
    assert.equal(classifyFeeRecord(feeAdvance).category, "CONFIRMED_ADVANCE");
    assert.equal(isNonRecurringFee(feeAdvance), true);
    assert.equal(resolveBillingMonth(feeAdvance).confidence, "ineligible");

    // 4b. feeType: 'adhoc'
    const feeAdhoc = {
      _id: "fee_exp_adhoc",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "adhoc",
      month: "October 2026",
      status: "Paid",
    };
    assert.equal(classifyFeeRecord(feeAdhoc).category, "CONFIRMED_ADHOC");
    assert.equal(isNonRecurringFee(feeAdhoc), true);
    assert.equal(resolveBillingMonth(feeAdhoc).confidence, "ineligible");

    // 4c. feeType: 'registration'
    const feeReg = {
      _id: "fee_exp_reg",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "registration",
      month: "October 2026",
      status: "Paid",
    };
    assert.equal(classifyFeeRecord(feeReg).category, "CONFIRMED_REGISTRATION");
    assert.equal(isNonRecurringFee(feeReg), true);
    assert.equal(resolveBillingMonth(feeReg).confidence, "ineligible");

    // 4d. feeType: 'monthly_recurring'
    const feeRec = {
      _id: "fee_exp_rec",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "monthly_recurring",
      billingMonth: "2026-10",
      status: "Pending",
    };
    assert.equal(classifyFeeRecord(feeRec).category, "CONFIRMED_RECURRING");
    assert.equal(isNonRecurringFee(feeRec), false);
    assert.equal(resolveBillingMonth(feeRec).confidence, "canonical");
  });

  // =========================================================================
  // 5. DUPLICATE RECURRING FEES DETECTION ACROSS STATUS COMBINATIONS
  // =========================================================================
  await t.test("5. Duplicate recurring fees are correctly detected and grouped by category", () => {
    // 5a. Multiple Paid duplicate
    const multiPaid = [
      {
        _id: "f1",
        centerId: "c1",
        studentId: "s1",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
        amountDue: 1500,
      },
      {
        _id: "f2",
        centerId: "c1",
        studentId: "s1",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
        amountDue: 1500,
      },
    ];
    const report1 = reconcileFeeDataset(multiPaid);
    assert.equal(report1.summary.duplicateGroupsCount, 1);
    assert.equal(report1.summary.conflictBreakdown.DUPLICATE_MULTIPLE_PAID, 1);

    // 5b. Paid + Pending duplicate
    const paidAndPending = [
      {
        _id: "f3",
        centerId: "c1",
        studentId: "s2",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
        amountDue: 1500,
      },
      {
        _id: "f4",
        centerId: "c1",
        studentId: "s2",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Pending",
        amountDue: 1500,
      },
    ];
    const report2 = reconcileFeeDataset(paidAndPending);
    assert.equal(report2.summary.duplicateGroupsCount, 1);
    assert.equal(report2.summary.conflictBreakdown.DUPLICATE_PAID_AND_PENDING, 1);

    // 5c. Multiple Pending duplicate
    const multiPending = [
      {
        _id: "f5",
        centerId: "c1",
        studentId: "s3",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Pending",
        amountDue: 1500,
      },
      {
        _id: "f6",
        centerId: "c1",
        studentId: "s3",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Pending",
        amountDue: 1500,
      },
    ];
    const report3 = reconcileFeeDataset(multiPending);
    assert.equal(report3.summary.duplicateGroupsCount, 1);
    assert.equal(report3.summary.conflictBreakdown.DUPLICATE_MULTIPLE_PENDING, 1);

    // 5d. Verification Pending conflict
    const verifPending = [
      {
        _id: "f7",
        centerId: "c1",
        studentId: "s4",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
        amountDue: 1500,
      },
      {
        _id: "f8",
        centerId: "c1",
        studentId: "s4",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Verification Pending",
        amountDue: 1500,
      },
    ];
    const report4 = reconcileFeeDataset(verifPending);
    assert.equal(report4.summary.duplicateGroupsCount, 1);
    assert.equal(report4.summary.conflictBreakdown.CONFLICT_VERIFICATION_PENDING, 1);

    // 5e. Partial Paid conflict
    const partialPaid = [
      {
        _id: "f9",
        centerId: "c1",
        studentId: "s5",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Partial Paid",
        amountDue: 500,
      },
      {
        _id: "f10",
        centerId: "c1",
        studentId: "s5",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Pending",
        amountDue: 1000,
      },
    ];
    const report5 = reconcileFeeDataset(partialPaid);
    assert.equal(report5.summary.duplicateGroupsCount, 1);
    assert.equal(report5.summary.conflictBreakdown.CONFLICT_PARTIAL_PAID, 1);
  });

  // =========================================================================
  // 6. DIFFERENT FEE TYPES FOR THE SAME STUDENT AND MONTH
  // =========================================================================
  await t.test("6. Different fee types for the same student and month do NOT collide into duplicate groups", () => {
    const dataset = [
      // Monthly recurring fee for October 2026
      {
        _id: "fee_recur",
        centerId: "c1",
        studentId: "student_99",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
        amountDue: 2000,
      },
      // Non-recurring advance fee in the same month
      {
        _id: "fee_advance",
        centerId: "c1",
        studentId: "student_99",
        feeType: "advance",
        month: "October 2026",
        status: "Paid",
        amountDue: 5000,
      },
      // Non-recurring ad-hoc lab fee in the same month
      {
        _id: "fee_adhoc",
        centerId: "c1",
        studentId: "student_99",
        feeType: "adhoc",
        title: "Annual Lab Fee",
        month: "October 2026",
        status: "Paid",
        amountDue: 600,
      },
      // Non-recurring registration fee in the same month
      {
        _id: "fee_reg",
        centerId: "c1",
        studentId: "student_99",
        feeType: "registration",
        month: "October 2026",
        status: "Paid",
        amountDue: 1000,
      },
    ];

    const report = reconcileFeeDataset(dataset);

    // Non-recurring fees should be in ineligibleNonRecurring and NOT in duplicate groups
    assert.equal(report.duplicateGroups.length, 0);
    assert.equal(report.summary.duplicateGroupsCount, 0);
    assert.equal(report.summary.cleanSingleRecordsCount, 1); // Only the single recurring fee
    assert.equal(report.summary.confirmedRecurringCount, 1);
    assert.equal(report.summary.confirmedNonRecurringCount, 3);
    assert.equal(report.summary.confirmedAdvanceCount, 1);
    assert.equal(report.summary.confirmedAdhocCount, 1);
    assert.equal(report.summary.confirmedRegistrationCount, 1);
    assert.equal(report.ineligibleNonRecurring.length, 3);
  });

  // =========================================================================
  // 7. INVALID MONTH FORMATS AND OUT-OF-RANGE YEARS
  // =========================================================================
  await t.test("7. Invalid month formats fail safe to AMBIGUOUS_LEGACY and flag index unreadiness", () => {
    const invalidRecords = [
      // Out of operational range year (year 1999)
      {
        _id: "fee_inv_1",
        centerId: "c1",
        studentId: "s1",
        month: "October 1999",
        status: "Paid",
      },
      // Far future year (year 2099)
      {
        _id: "fee_inv_2",
        centerId: "c1",
        studentId: "s2",
        billingMonth: "2099-10",
        status: "Paid",
      },
      // Corrupt / unparseable string
      {
        _id: "fee_inv_3",
        centerId: "c1",
        studentId: "s3",
        month: "RandomString123",
        status: "Pending",
      },
    ];

    for (const rec of invalidRecords) {
      const mapping = resolveBillingMonth(rec);
      assert.equal(mapping.confidence, "ambiguous");
      assert.equal(mapping.canonicalMonth, null);
    }

    const report = reconcileFeeDataset(invalidRecords);
    assert.equal(report.summary.ambiguousLegacyCount, 3);
    assert.equal(report.summary.invalidBillingMonthCount, 3);
    assert.equal(report.summary.indexReadiness.isSafeToCreate, false);
    assert.ok(report.summary.indexReadiness.blockingIssues.length > 0);
  });

  // =========================================================================
  // 8. AMBIGUOUS LEGACY LABELS PRESERVED AND REQUIRE MANUAL REVIEW
  // =========================================================================
  await t.test("8. Ambiguous legacy labels are isolated and never automatically converted", () => {
    const records = [
      {
        _id: "fee_amb_rev_1",
        centerId: "center_101",
        studentId: "student_202",
        month: "Quarter 2 Tuition",
        status: "Paid",
        amountDue: 3000,
      },
      {
        _id: "fee_amb_rev_2",
        centerId: "center_101",
        studentId: "student_203",
        month: "2026 Batch",
        status: "Pending",
        amountDue: 2500,
      },
    ];

    const report = reconcileFeeDataset(records);
    assert.equal(report.summary.ambiguousLegacyCount, 2);
    assert.equal(report.summary.recordsRequiringManualReview, 2);
    assert.equal(report.ambiguousRecords.length, 2);
    assert.equal(report.ambiguousRecords[0].requiresManualReview, true);
    assert.equal(report.ambiguousRecords[0].conflictType, "AMBIGUOUS_LABEL");
    assert.equal(report.summary.indexReadiness.isSafeToCreate, false);
  });

  // =========================================================================
  // 9. UNIQUE INDEX READINESS EVALUATION
  // =========================================================================
  await t.test("9. Unique index readiness correctly reflects clean vs unready datasets", () => {
    // 9a. Dataset with unbackfilled records (missing explicit feeType or non-canonical month)
    const unreadyDataset = [
      {
        _id: "f_clean_1",
        centerId: "c_valid_1",
        studentId: "student_valid_1",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
      },
      {
        _id: "f_legacy_label",
        centerId: "c_valid_1",
        studentId: "student_valid_2",
        // Missing explicit feeType and billingMonth, but resolvable month label
        month: "Oct 2026",
        status: "Paid",
      },
    ];

    const unreadyReport = reconcileFeeDataset(unreadyDataset);
    assert.equal(unreadyReport.summary.indexReadiness.totalTargetRecords, 2);
    assert.equal(unreadyReport.summary.indexReadiness.readyRecordsCount, 1);
    assert.equal(unreadyReport.summary.indexReadiness.unreadyRecordsCount, 1);
    assert.equal(unreadyReport.summary.indexReadiness.missingExplicitFeeTypeCount, 1);
    assert.equal(unreadyReport.summary.indexReadiness.missingCanonicalBillingMonthCount, 1);
    assert.equal(unreadyReport.summary.recordsEligibleForBackfill, 1);
    assert.equal(unreadyReport.summary.indexReadiness.isSafeToCreate, false);

    // 9b. Fully canonical, ready dataset without duplicates
    const readyDataset = [
      {
        _id: "f_ready_1",
        centerId: "c_valid_1",
        studentId: "student_valid_1",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Paid",
      },
      {
        _id: "f_ready_2",
        centerId: "c_valid_1",
        studentId: "student_valid_2",
        feeType: "monthly_recurring",
        billingMonth: "2026-10",
        status: "Pending",
      },
      {
        // Non-recurring fee does not block index readiness
        _id: "f_adv",
        centerId: "c_valid_1",
        studentId: "student_valid_1",
        feeType: "advance",
        month: "October 2026",
        status: "Paid",
      },
    ];

    const readyReport = reconcileFeeDataset(readyDataset);
    assert.equal(readyReport.summary.indexReadiness.totalTargetRecords, 2);
    assert.equal(readyReport.summary.indexReadiness.readyRecordsCount, 2);
    assert.equal(readyReport.summary.indexReadiness.unreadyRecordsCount, 0);
    assert.equal(readyReport.summary.indexReadiness.duplicateGroupViolationsCount, 0);
    assert.equal(readyReport.summary.indexReadiness.isSafeToCreate, true);
    assert.equal(readyReport.summary.indexReadiness.blockingIssues.length, 0);
  });

  // =========================================================================
  // 10. PRIVACY PRESERVATION & MASKING
  // =========================================================================
  await t.test("10. PII masking prevents leaking student names, phone numbers, or identifiers", () => {
    assert.equal(maskName("John Doe"), "John D.");
    assert.equal(maskName("Alice"), "Ali***");
    assert.equal(maskPhone("9876543210"), "***3210");
    assert.equal(maskPhone("+91-9876543210"), "***3210");
    assert.equal(maskIdentifier("507f1f77bcf86cd799439011"), "507f...9011");
    assert.equal(maskIdentifier("short"), "short");
  });
});
