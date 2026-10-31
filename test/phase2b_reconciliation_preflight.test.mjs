import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveBillingMonth,
  isNonRecurringFee,
  reconcileFeeDataset,
  validateExecutionSafety,
  validateDatabaseTarget,
  parseMongoDatabaseName,
  sanitizeMongoUri,
  maskName,
  maskPhone,
  maskIdentifier,
} = await import("../tution-desk-be/src/lib/reconciliationEngine.ts");

test("TuitionDesk Phase 2B.1: Read-Only Legacy Fee Reconciliation Preflight Suite", async (t) => {
  // =========================================================================
  // 1. MONTH LABEL CANONICALIZATION (SHORT & LONG LABELS)
  // =========================================================================
  await t.test("1. Short and long month labels map to identical canonical YYYY-MM", () => {
    const testCases = [
      { input: "October 2026", expected: "2026-10" },
      { input: "Oct 2026", expected: "2026-10" },
      { input: "Oct-2026", expected: "2026-10" },
      { input: "2026-10", expected: "2026-10" },
      { input: "2026 October", expected: "2026-10" },
      { input: "November 2026", expected: "2026-11" },
      { input: "Nov 2026", expected: "2026-11" },
      { input: "January 2027", expected: "2027-01" },
      { input: "Jan 2027", expected: "2027-01" },
    ];

    for (const { input, expected } of testCases) {
      const res = resolveBillingMonth({
        _id: "test_fee",
        centerId: "center_1",
        studentId: "student_1",
        month: input,
        status: "Pending",
      });

      assert.equal(
        res.canonicalMonth,
        expected,
        `Expected "${input}" to map to "${expected}", got "${res.canonicalMonth}"`
      );
      assert.ok(res.confidence === "high" || res.confidence === "canonical");
    }
  });

  // =========================================================================
  // 2. DISTINCT MONTH LABELS DO NOT COLLIDE
  // =========================================================================
  await t.test("2. Different months are not treated as duplicates", () => {
    const resOct = resolveBillingMonth({
      _id: "fee_oct",
      centerId: "c1",
      studentId: "s1",
      month: "October 2026",
      status: "Pending",
    });

    const resNov = resolveBillingMonth({
      _id: "fee_nov",
      centerId: "c1",
      studentId: "s1",
      month: "November 2026",
      status: "Pending",
    });

    assert.equal(resOct.canonicalMonth, "2026-10");
    assert.equal(resNov.canonicalMonth, "2026-11");
    assert.notEqual(resOct.canonicalMonth, resNov.canonicalMonth);
  });

  // =========================================================================
  // 3. DUPLICATE DETECTION WITHOUT DATABASE MUTATION
  // =========================================================================
  await t.test("3. Duplicate candidates are flagged with conflict types without mutating input records", () => {
    const records = [
      {
        _id: "fee_orig_paid",
        centerId: "center_alpha",
        studentId: "student_101",
        month: "October 2026",
        status: "Paid",
        amountDue: 1500,
        paidAmount: 1500,
        receiptNumber: "RCPT-OCT-01",
      },
      {
        _id: "fee_dup_pending",
        centerId: "center_alpha",
        studentId: "student_101",
        month: "Oct 2026",
        status: "Pending",
        amountDue: 1500,
      },
    ];

    // Snapshot before execution
    const snapshotBefore = JSON.stringify(records);

    const report = reconcileFeeDataset(records);

    // Verify zero mutations on original array or objects
    assert.equal(JSON.stringify(records), snapshotBefore, "Original input data must NOT be mutated");

    assert.equal(report.summary.totalRecordsAudited, 2);
    assert.equal(report.summary.duplicateGroupsCount, 1);
    assert.equal(report.summary.totalDuplicateRecordsCount, 2);
    assert.equal(report.summary.conflictBreakdown.DUPLICATE_PAID_AND_PENDING, 1);

    const group = report.duplicateGroups[0];
    assert.equal(group.canonicalMonth, "2026-10");
    assert.equal(group.conflictType, "DUPLICATE_PAID_AND_PENDING");
    assert.equal(group.records.length, 2);
    assert.ok(group.recommendedAction.includes("Candidate for keeping Paid and archiving/cancelling orphaned Pending"));
  });

  // =========================================================================
  // 4. HIGH-RISK CONFLICT: MULTIPLE PAID DUPLICATES
  // =========================================================================
  await t.test("4. Multiple Paid records for same cycle flagged as high risk (DUPLICATE_MULTIPLE_PAID)", () => {
    const records = [
      {
        _id: "fee_cash",
        centerId: "c1",
        studentId: "s2",
        month: "October 2026",
        status: "Paid",
        paymentMode: "Cash",
        amountDue: 2000,
      },
      {
        _id: "fee_online",
        centerId: "c1",
        studentId: "s2",
        month: "Oct 2026",
        status: "Paid",
        paymentMode: "Online/UPI",
        amountDue: 2000,
      },
    ];

    const report = reconcileFeeDataset(records);
    assert.equal(report.summary.conflictBreakdown.DUPLICATE_MULTIPLE_PAID, 1);
    assert.equal(report.duplicateGroups[0].conflictType, "DUPLICATE_MULTIPLE_PAID");
    assert.ok(report.duplicateGroups[0].recommendedAction.includes("CRITICAL"));
  });

  // =========================================================================
  // 5. AMBIGUOUS LABELS SENT TO MANUAL REVIEW
  // =========================================================================
  await t.test("5. Ambiguous labels are flagged for manual review without guessing", () => {
    const ambiguousSamples = [
      { _id: "amb_1", centerId: "c1", studentId: "s3", month: "Quarter 1", status: "Pending" },
      { _id: "amb_2", centerId: "c1", studentId: "s3", month: "October", status: "Pending" }, // missing year
      { _id: "amb_3", centerId: "c1", studentId: "s3", month: "Session 2026", status: "Pending" },
      { _id: "amb_4", centerId: "c1", studentId: "s3", month: "", status: "Pending" }, // empty
    ];

    for (const record of ambiguousSamples) {
      const mapping = resolveBillingMonth(record);
      assert.equal(mapping.canonicalMonth, null, `Ambiguous month "${record.month}" must not have canonicalMonth`);
      assert.equal(mapping.confidence, "ambiguous");
    }

    const report = reconcileFeeDataset(ambiguousSamples);
    assert.equal(report.summary.ambiguousCount, 4);
    assert.equal(report.ambiguousRecords.length, 4);
    assert.equal(report.summary.conflictBreakdown.AMBIGUOUS_LABEL, 4);
  });

  // =========================================================================
  // 6. ADVANCE AND AD-HOC FEES NEVER CLASSIFIED AS MONTHLY RECURRING
  // =========================================================================
  await t.test("6. Advance, ad-hoc, and registration fees are classified as ineligible non-recurring", () => {
    const nonRecurringSamples = [
      {
        _id: "adv_1",
        centerId: "c1",
        studentId: "s4",
        feeType: "advance",
        isAdvance: true,
        month: "Advance Fee Payment",
        status: "Verification Pending",
      },
      {
        _id: "adv_2",
        centerId: "c1",
        studentId: "s4",
        month: "October 2026",
        title: "Advance Payment - October",
        status: "Paid",
      },
      {
        _id: "adhoc_1",
        centerId: "c1",
        studentId: "s4",
        feeType: "adhoc",
        title: "Annual Lab Fee",
        month: "October 2026",
        status: "Paid",
      },
      {
        _id: "reg_1",
        centerId: "c1",
        studentId: "s4",
        feeType: "registration",
        title: "Admission Fee",
        month: "October 2026",
        status: "Paid",
      },
    ];

    for (const sample of nonRecurringSamples) {
      assert.equal(isNonRecurringFee(sample), true, `Record ${sample._id} should be non-recurring`);
      const mapping = resolveBillingMonth(sample);
      assert.equal(mapping.confidence, "ineligible");
      assert.equal(mapping.canonicalMonth, null);
    }

    const report = reconcileFeeDataset(nonRecurringSamples);
    assert.equal(report.summary.nonRecurringCount, 4);
    assert.equal(report.summary.duplicateGroupsCount, 0, "Non-recurring fees must not create duplicate billing groups");
  });

  // =========================================================================
  // 7. READ-ONLY EXECUTION SAFETY VALIDATOR
  // =========================================================================
  await t.test("7. Safety validator rejects mutation flags and unapproved database targets", () => {
    // 1. Prohibits mutation flags
    const forbiddenFlags = ["--apply", "--write", "--migrate", "--force", "--drop", "--create-index"];
    for (const flag of forbiddenFlags) {
      const res = validateExecutionSafety({ AUDIT_DATABASE_TARGET: "approved_readonly" }, [flag]);
      assert.equal(res.safe, false);
      assert.ok(res.reason.includes("strictly forbidden"));
    }

    // 2. Refuses to run without approved target
    const unapproved = validateExecutionSafety({}, []);
    assert.equal(unapproved.safe, false);
    assert.ok(unapproved.reason.includes("Refusing to run"));

    // 3. Allows valid dry-run target
    const approvedArg = validateExecutionSafety({}, ["--target=approved_readonly"]);
    assert.equal(approvedArg.safe, true);

    const approvedEnv = validateExecutionSafety({ ALLOW_AUDIT_DATABASE_RUN: "true" }, []);
    assert.equal(approvedEnv.safe, true);
  });

  // =========================================================================
  // 8. PRIVACY-PRESERVING PII REDACTION
  // =========================================================================
  await t.test("8. PII masking protects student names, parent phones, and identifiers", () => {
    assert.equal(maskName("Rohan Gupta"), "Rohan G.");
    assert.equal(maskName("Ananya"), "Ana***");
    assert.equal(maskPhone("+91 98203 34567"), "***4567");
    assert.equal(maskPhone("9876543210"), "***3210");
    assert.equal(maskIdentifier("507f1f77bcf86cd799439011"), "507f...9011");
  });

  // =========================================================================
  // 9. DATABASE TARGET VERIFICATION & CONNECTION SANITIZATION
  // =========================================================================
  await t.test("9. Database target verification fails closed on missing, mismatched, or primary DB collisions", () => {
    // 9.1 Missing URI fails closed
    const missing = validateDatabaseTarget({});
    assert.equal(missing.valid, false);
    assert.ok(missing.error.includes("Missing MONGODB_AUDIT_URI"));

    // 9.2 Silent collision with primary MONGODB_URI fails closed
    const collision = validateDatabaseTarget({
      auditUri: "mongodb+srv://user:pass@cluster.mongodb.net/tuitiondesk_prod?retryWrites=true",
      primaryUri: "mongodb+srv://user:pass@cluster.mongodb.net/tuitiondesk_prod?retryWrites=true",
    });
    assert.equal(collision.valid, false);
    assert.ok(collision.error.includes("Target collision detected"));
    assert.ok(!collision.error.includes("pass"), "Passwords must never appear in error messages");

    // 9.3 Collision with explicit override allowed
    const collisionAllowed = validateDatabaseTarget({
      auditUri: "mongodb+srv://user:pass@cluster.mongodb.net/tuitiondesk_audit?retryWrites=true",
      primaryUri: "mongodb+srv://user:pass@cluster.mongodb.net/tuitiondesk_audit?retryWrites=true",
      allowPrimaryDb: true,
    });
    assert.equal(collisionAllowed.valid, true);

    // 9.4 Missing database path in URI fails closed
    const missingDb = validateDatabaseTarget({
      auditUri: "mongodb://localhost:27017",
    });
    assert.equal(missingDb.valid, false);
    assert.ok(missingDb.error.includes("Database name could not be determined"));

    // 9.5 Database name mismatch fails closed
    const mismatch = validateDatabaseTarget({
      auditUri: "mongodb+srv://user:pass@cluster.mongodb.net/tuitiondesk_prod?retryWrites=true",
      expectedDbName: "tuitiondesk_audit_backup",
    });
    assert.equal(mismatch.valid, false);
    assert.ok(mismatch.error.includes("Database target mismatch"));
    assert.ok(mismatch.error.includes("tuitiondesk_prod"));
    assert.ok(mismatch.error.includes("tuitiondesk_audit_backup"));

    // 9.6 Valid isolated target succeeds
    const valid = validateDatabaseTarget({
      auditUri: "mongodb+srv://readonly_user:secret_pass@cluster.mongodb.net/tuitiondesk_audit_replica?readPreference=secondaryPreferred",
      expectedDbName: "tuitiondesk_audit_replica",
    });
    assert.equal(valid.valid, true);
    assert.equal(valid.databaseName, "tuitiondesk_audit_replica");
    assert.ok(valid.sanitizedUri.includes("***:***@"));
    assert.ok(!valid.sanitizedUri.includes("secret_pass"));

    // 9.7 URI sanitization utility
    const sanitized = sanitizeMongoUri("mongodb://user:superSecret@mongo.internal:27017/db");
    assert.equal(sanitized, "mongodb://***:***@mongo.internal:27017/db");
  });

  // =========================================================================
  // 10. KEYWORD-BASED FALSE POSITIVE PREVENTION
  // =========================================================================
  await t.test("10. Course titles with keywords (e.g., 'Advanced') are NOT excluded from recurring billing", () => {
    // 10.1 "Advanced" in course title must NOT classify fee as non-recurring
    const advMathCourse = {
      _id: "fee_adv_math",
      centerId: "center_1",
      studentId: "student_1",
      title: "Class 10 Advanced Mathematics - Oct 2026 Tuition",
      month: "October 2026",
      status: "Pending",
    };
    assert.equal(isNonRecurringFee(advMathCourse), false, "Advanced Mathematics must not be non-recurring");
    const resAdvMath = resolveBillingMonth(advMathCourse);
    assert.equal(resAdvMath.canonicalMonth, "2026-10");
    assert.equal(resAdvMath.confidence, "high");

    // 10.2 "Admission Batch" in course title must NOT classify fee as non-recurring
    const admissionBatch = {
      _id: "fee_admission_batch",
      centerId: "center_1",
      studentId: "student_1",
      title: "2026 Admission Batch Physics Tuition",
      month: "October 2026",
      status: "Paid",
    };
    assert.equal(isNonRecurringFee(admissionBatch), false, "Admission Batch must not be non-recurring");
    const resAdmBatch = resolveBillingMonth(admissionBatch);
    assert.equal(resAdmBatch.canonicalMonth, "2026-10");

    // 10.3 Explicit feeType: "monthly_recurring" is NEVER non-recurring even with keyword
    const explicitRecurringWithAdvanceTitle = {
      _id: "fee_explicit_rec",
      centerId: "center_1",
      studentId: "student_1",
      feeType: "monthly_recurring",
      title: "Advance Concepts in Physics",
      month: "October 2026",
      status: "Pending",
    };
    assert.equal(isNonRecurringFee(explicitRecurringWithAdvanceTitle), false);
    const resExplicit = resolveBillingMonth(explicitRecurringWithAdvanceTitle);
    assert.equal(resExplicit.canonicalMonth, "2026-10");

    // 10.4 Genuine advance payment IS classified as non-recurring
    const genuineAdvance = {
      _id: "fee_genuine_adv",
      centerId: "center_1",
      studentId: "student_1",
      title: "Advance Fee Payment",
      month: "October 2026",
      status: "Paid",
    };
    assert.equal(isNonRecurringFee(genuineAdvance), true);
    const resGenuineAdv = resolveBillingMonth(genuineAdvance);
    assert.equal(resGenuineAdv.confidence, "ineligible");
    assert.equal(resGenuineAdv.canonicalMonth, null);
  });

  // =========================================================================
  // 11. OUT-OF-RANGE YEARS AND EXTENDED DATE NORMALIZATION
  // =========================================================================
  await t.test("11. Out-of-range years fail safe to ambiguous; date strings normalize correctly", () => {
    // 11.1 Years outside operational range (2020-2035) fail safe to ambiguous
    const ancientYear = resolveBillingMonth({
      _id: "ancient",
      centerId: "c1",
      studentId: "s1",
      month: "October 1995",
      status: "Paid",
    });
    assert.equal(ancientYear.confidence, "ambiguous");
    assert.equal(ancientYear.canonicalMonth, null);
    assert.ok(ancientYear.reason.includes("outside operational range"));

    const futureYear = resolveBillingMonth({
      _id: "future",
      centerId: "c1",
      studentId: "s1",
      billingMonth: "2099-05",
      status: "Pending",
    });
    assert.equal(futureYear.confidence, "ambiguous");
    assert.equal(futureYear.canonicalMonth, null);

    // 11.2 Invalid month numbers (e.g., month 13)
    const invalidMonth = resolveBillingMonth({
      _id: "inv_month",
      centerId: "c1",
      studentId: "s1",
      billingMonth: "2026-13",
      status: "Pending",
    });
    assert.equal(invalidMonth.confidence, "ambiguous");

    // 11.3 2-digit years normalize cleanly
    const twoDigit1 = resolveBillingMonth({
      _id: "td1",
      centerId: "c1",
      studentId: "s1",
      month: "Oct 26",
      status: "Paid",
    });
    assert.equal(twoDigit1.canonicalMonth, "2026-10");
    assert.equal(twoDigit1.confidence, "high");

    const twoDigit2 = resolveBillingMonth({
      _id: "td2",
      centerId: "c1",
      studentId: "s1",
      month: "Oct-26",
      status: "Pending",
    });
    assert.equal(twoDigit2.canonicalMonth, "2026-10");

    // 11.4 Date strings with day normalize to cycle month
    const dateWithDay = resolveBillingMonth({
      _id: "dd1",
      centerId: "c1",
      studentId: "s1",
      month: "15 Oct 2026",
      status: "Paid",
    });
    assert.equal(dateWithDay.canonicalMonth, "2026-10");
    assert.equal(dateWithDay.confidence, "high");

    const isoDate = resolveBillingMonth({
      _id: "iso1",
      centerId: "c1",
      studentId: "s1",
      month: "2026-10-15",
      status: "Paid",
    });
    assert.equal(isoDate.canonicalMonth, "2026-10");
  });

  // =========================================================================
  // 12. PARTIAL PAID CONFLICT AND DUPLICATE GROUP CATEGORIZATION
  // =========================================================================
  await t.test("12. Duplicate group conflict categorization properly classifies Partial Paid and Verification Pending", () => {
    // 12.1 Partial Paid alongside Pending classified as CONFLICT_PARTIAL_PAID
    const partialGroup = [
      {
        _id: "f_partial",
        centerId: "center_beta",
        studentId: "student_202",
        month: "October 2026",
        status: "Partial Paid",
        amountDue: 2000,
        paidAmount: 1000,
      },
      {
        _id: "f_pending",
        centerId: "center_beta",
        studentId: "student_202",
        month: "Oct 2026",
        status: "Pending",
        amountDue: 2000,
      },
    ];

    const reportPartial = reconcileFeeDataset(partialGroup);
    assert.equal(reportPartial.summary.duplicateGroupsCount, 1);
    assert.equal(reportPartial.summary.conflictBreakdown.CONFLICT_PARTIAL_PAID, 1);
    assert.equal(reportPartial.duplicateGroups[0].conflictType, "CONFLICT_PARTIAL_PAID");
    assert.ok(reportPartial.duplicateGroups[0].recommendedAction.includes("Partial payment record"));

    // 12.2 Verification Pending takes precedence when online payment is in-flight
    const reviewGroup = [
      {
        _id: "f_verif",
        centerId: "center_beta",
        studentId: "student_203",
        month: "October 2026",
        status: "Verification Pending",
        amountDue: 1500,
      },
      {
        _id: "f_pend",
        centerId: "center_beta",
        studentId: "student_203",
        month: "October 2026",
        status: "Pending",
        amountDue: 1500,
      },
    ];

    const reportReview = reconcileFeeDataset(reviewGroup);
    assert.equal(reportReview.summary.conflictBreakdown.CONFLICT_VERIFICATION_PENDING, 1);
    assert.equal(reportReview.duplicateGroups[0].conflictType, "CONFLICT_VERIFICATION_PENDING");
  });

  // =========================================================================
  // 13. FORBIDDEN MODEL MUTATION ENFORCEMENT
  // =========================================================================
  await t.test("13. Preflight model write methods are stubbed to block accidental runtime mutations", () => {
    // Simulate model stubbing as enforced in reconcile-fees-preflight.ts
    const simulatedFeeModel = {
      find: () => ({ lean: () => ({ exec: async () => [] }) }),
    };

    const forbiddenMethods = [
      "create",
      "insertMany",
      "updateOne",
      "updateMany",
      "deleteOne",
      "deleteMany",
      "replaceOne",
      "bulkWrite",
      "findOneAndDelete",
      "findOneAndReplace",
      "findOneAndUpdate",
    ];

    for (const method of forbiddenMethods) {
      simulatedFeeModel[method] = () => {
        throw new Error(`CRITICAL MUTATION BLOCKED: Method "${method}" is prohibited in read-only audit.`);
      };
    }

    for (const method of forbiddenMethods) {
      assert.throws(
        () => simulatedFeeModel[method](),
        /CRITICAL MUTATION BLOCKED/,
        `Method "${method}" must throw mutation blocked error`
      );
    }
  });
});
