/**
 * TuitionDesk Phase 2B.1 — Read-Only Legacy Fee Reconciliation CLI Preflight
 *
 * Usage:
 *   npx tsx scripts/reconcile-fees-preflight.ts --target=approved_readonly
 *
 * STRICT SAFETY BOUNDARIES:
 * - Read-only execution mode strictly enforced.
 * - Requires explicit --target=approved_readonly or ALLOW_AUDIT_DATABASE_RUN=true.
 * - Performs zero inserts, updates, deletes, index operations, or schema migrations.
 * - Redacts all parent phone numbers, names, and transaction identifiers.
 * - Connection errors sanitized to avoid exposing database URIs or credentials.
 */

import mongoose from "mongoose";
import {
  reconcileFeeDataset,
  validateExecutionSafety,
  validateDatabaseTarget,
  sanitizeMongoUri,
  maskIdentifier,
  RawFeeRecord,
  ReconciliationReport,
} from "../src/lib/reconciliationEngine.ts";
import { readFeeSnapshotFile } from "../src/lib/snapshotReader.ts";

async function main() {
  const args = process.argv.slice(2);

  // 1. Enforce strict safety boundary check
  const safety = validateExecutionSafety(process.env, args);
  if (!safety.safe) {
    console.error("\n❌ PREFLIGHT SAFETY CHECK FAILED");
    console.error(safety.reason);
    console.error(
      "\nTo run against an approved, isolated read-only audit database, pass:\n" +
      "  --target=approved_readonly\n" +
      "along with an explicit MONGODB_AUDIT_URI environment variable.\n" +
      "Or to run offline against a local backup snapshot, pass:\n" +
      "  --input=<path/to/fees.bson>\n"
    );
    process.exit(1);
  }

  // 2. Check for local snapshot audit mode
  const inputArg = args.find((a) => a.startsWith("--input="));
  if (inputArg) {
    const inputPath = inputArg.split("=").slice(1).join("=").trim();
    if (!inputPath) {
      console.error("\n❌ SNAPSHOT AUDIT ERROR: Missing file path in --input=<path> argument.");
      process.exit(1);
    }

    console.log("\n=======================================================");
    console.log(" TuitionDesk Phase 2B.2: Fee Reconciliation Preflight");
    console.log(" MODE: LOCAL SNAPSHOT AUDIT (OFFLINE / ZERO NETWORK)");
    console.log("=======================================================");
    console.log(`Snapshot File:    ${inputPath}`);
    console.log("SAFETY DIRECTIVES:");
    console.log("- ZERO database or network connections initiated.");
    console.log("- Source snapshot file is read-only and never modified.");
    console.log("- autoIndex is disabled. Zero mutations or writes executed.");
    console.log("=======================================================\n");

    try {
      console.log(`Reading snapshot file: ${inputPath}...`);
      const snapshot = readFeeSnapshotFile(inputPath);
      console.log(`Loaded ${snapshot.records.length} records (${snapshot.fileSizeBytes} bytes, format: ${snapshot.format.toUpperCase()}).`);
      console.log(`Auditing ${snapshot.records.length} records through reconciliation engine...`);

      const report: ReconciliationReport = reconcileFeeDataset(snapshot.records);
      printReportSummary(report);
      return;
    } catch (err: unknown) {
      console.error("\n❌ SNAPSHOT AUDIT ERROR");
      const rawMessage = err instanceof Error ? err.message : String(err);
      console.error(rawMessage);
      process.exit(1);
    }
  }

  // 3. Strict Database Target Verification: Fail closed on missing, mismatched, or primary DB collisions
  const auditUri = process.env.MONGODB_AUDIT_URI;
  const primaryUri = process.env.MONGODB_URI;
  const expectedDbName =
    process.env.EXPECTED_AUDIT_DB_NAME ||
    args.find((a) => a.startsWith("--expected-db="))?.split("=")[1];
  const allowPrimaryDb = args.includes("--allow-primary-db");

  if (!expectedDbName || !expectedDbName.trim()) {
    console.error("\n❌ DATABASE TARGET VERIFICATION FAILED");
    console.error(
      "Execution safety guard: Missing EXPECTED_AUDIT_DB_NAME. You must explicitly configure the expected audit database name (via EXPECTED_AUDIT_DB_NAME env var or --expected-db=<name> flag)."
    );
    console.error(
      "\nRequirements for reconciliation audit:\n" +
      "- MONGODB_AUDIT_URI must point to an isolated read-only audit replica or backup.\n" +
      "- Never silently fallback to the live application MONGODB_URI.\n" +
      "- EXPECTED_AUDIT_DB_NAME must be explicitly set and match the database path in MONGODB_AUDIT_URI.\n" +
      "- Alternatively, run offline against a local backup via --input=<path/to/fees.bson>.\n"
    );
    process.exit(1);
  }

  const targetValidation = validateDatabaseTarget({
    auditUri,
    primaryUri,
    expectedDbName,
    allowPrimaryDb,
  });

  if (!targetValidation.valid) {
    console.error("\n❌ DATABASE TARGET VERIFICATION FAILED");
    console.error(targetValidation.error);
    console.error(
      "\nRequirements for reconciliation audit:\n" +
      "- MONGODB_AUDIT_URI must point to an isolated read-only audit replica or backup.\n" +
      "- Never silently fallback to the live application MONGODB_URI.\n" +
      "- Database name in URI must match EXPECTED_AUDIT_DB_NAME.\n"
    );
    process.exit(1);
  }

  console.log("\n=======================================================");
  console.log(" TuitionDesk Phase 2B.2: Fee Reconciliation Preflight");
  console.log(" MODE: STRICT READ-ONLY / ZERO-MUTATION AUDIT");
  console.log("=======================================================");
  console.log(`Target Database:  ${targetValidation.databaseName}`);
  console.log(`Connection URI:   ${targetValidation.sanitizedUri}`);
  console.log("SECURITY DIRECTIVES:");
  console.log("- MongoDB user credentials MUST have read-only privileges (Atlas 'read' role only).");
  console.log("- 'readPreference: secondaryPreferred' is used for replica query routing, NOT access control.");
  console.log("- autoIndex is disabled. All model mutation operations are stubbed and forbidden.");
  console.log("=======================================================\n");

  let connection: typeof mongoose | null = null;

  try {
    console.log("Connecting to audit database (autoIndex: false, bufferCommands: false)...");

    // Connect with autoIndex disabled and readPreference secondaryPreferred
    connection = await mongoose.connect(auditUri!, {
      autoIndex: false,
      bufferCommands: false,
      readPreference: "secondaryPreferred",
    });

    console.log("Connected successfully. Streaming fee records (lean query)...");

    const FeeModel =
      mongoose.models.Fee ||
      mongoose.model(
        "Fee",
        new mongoose.Schema({}, { strict: false, autoIndex: false }),
        "fees"
      );

    // Defense-in-depth: Stub any write/mutation methods on the model to block accidental mutations
    const forbiddenWriteMethods = [
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
    ] as const;

    for (const method of forbiddenWriteMethods) {
      ((FeeModel as unknown) as Record<string, unknown>)[method] = () => {
        throw new Error(`CRITICAL MUTATION BLOCKED: Method "${method}" is prohibited in read-only audit.`);
      };
    }

    // Read-only stream or cursor read
    const rawRecords = (await FeeModel.find({}).lean().exec()) as unknown as RawFeeRecord[];

    console.log(`Auditing ${rawRecords.length} records through reconciliation engine...`);

    const report: ReconciliationReport = reconcileFeeDataset(rawRecords);

    printReportSummary(report);
  } catch (err: unknown) {
    console.error("\n❌ AUDIT EXECUTION ERROR");
    // Ensure sensitive URI strings or credentials are never exposed in error output
    const rawMessage = err instanceof Error ? err.message : String(err);
    const sanitized = sanitizeMongoUri(rawMessage).replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, "[REDACTED_MONGODB_URI]");
    console.error(sanitized);
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

function printReportSummary(report: ReconciliationReport) {
  const { summary } = report;

  console.log("\n-------------------------------------------------------");
  console.log(" RECONCILIATION & FEE CLASSIFICATION SUMMARY");
  console.log("-------------------------------------------------------");
  console.log(`Total Fee Records Audited:       ${summary.totalRecordsAudited}`);
  console.log(`- Confirmed Recurring:           ${summary.confirmedRecurringCount}`);
  console.log(`- Confirmed Non-Recurring:       ${summary.confirmedNonRecurringCount}`);
  console.log(`    * Advance Fees:              ${summary.confirmedAdvanceCount}`);
  console.log(`    * Ad-hoc Fees:               ${summary.confirmedAdhocCount}`);
  console.log(`    * Registration Fees:         ${summary.confirmedRegistrationCount}`);
  console.log(`- Ambiguous Legacy Records:      ${summary.ambiguousLegacyCount}`);
  console.log(`Already Canonical (YYYY-MM):     ${summary.alreadyCanonicalCount}`);
  console.log(`Resolvable Legacy Month Labels:  ${summary.resolvableLegacyCount}`);
  console.log(`Missing feeType in Schema:       ${summary.missingFeeTypeCount}`);
  console.log(`Clean Single Records:            ${summary.cleanSingleRecordsCount}`);
  console.log(`Invalid Billing Month Count:     ${summary.invalidBillingMonthCount}`);
  console.log(`Records Eligible for Backfill:   ${summary.recordsEligibleForBackfill}`);
  console.log(`Records Requiring Manual Review: ${summary.recordsRequiringManualReview}`);

  console.log("\n-------------------------------------------------------");
  console.log(" DUPLICATE GROUPS BY CATEGORY");
  console.log("-------------------------------------------------------");
  console.log(`Total Duplicate Groups:          ${summary.duplicateGroupsCount}`);
  console.log(`Total Duplicate Records:         ${summary.totalDuplicateRecordsCount}`);
  console.log(`- Multiple Paid Records:         ${summary.conflictBreakdown.DUPLICATE_MULTIPLE_PAID}`);
  console.log(`- Paid + Pending Records:        ${summary.conflictBreakdown.DUPLICATE_PAID_AND_PENDING}`);
  console.log(`- Multiple Pending Records:      ${summary.conflictBreakdown.DUPLICATE_MULTIPLE_PENDING}`);
  console.log(`- Verification Pending Conflict: ${summary.conflictBreakdown.CONFLICT_VERIFICATION_PENDING}`);
  console.log(`- Partial Paid Conflict:         ${summary.conflictBreakdown.CONFLICT_PARTIAL_PAID}`);
  console.log(`- Ambiguous Label Conflict:      ${summary.conflictBreakdown.AMBIGUOUS_LABEL}`);

  console.log("\n-------------------------------------------------------");
  console.log(" UNIQUE INDEX READINESS SUMMARY");
  console.log("-------------------------------------------------------");
  console.log(`Target Recurring Records:        ${summary.indexReadiness.totalTargetRecords}`);
  console.log(`Ready for Index:                 ${summary.indexReadiness.readyRecordsCount}`);
  console.log(`Unready / Missing Invariants:    ${summary.indexReadiness.unreadyRecordsCount}`);
  console.log(`- Missing feeType='monthly_recurring': ${summary.indexReadiness.missingExplicitFeeTypeCount}`);
  console.log(`- Missing canonical billingMonth:     ${summary.indexReadiness.missingCanonicalBillingMonthCount}`);
  console.log(`- Duplicate Group Violations:          ${summary.indexReadiness.duplicateGroupViolationsCount}`);
  console.log(`Unique Index Creation Safe:      ${summary.indexReadiness.isSafeToCreate ? "YES (SAFE TO CREATE)" : "NO (BLOCKED)"}`);

  if (summary.indexReadiness.blockingIssues.length > 0) {
    console.log("\nBlocking Issues:");
    summary.indexReadiness.blockingIssues.forEach((issue, idx) => {
      console.log(`  ${idx + 1}. ${issue}`);
    });
  }

  if (report.duplicateGroups.length > 0) {
    console.log("\n-------------------------------------------------------");
    console.log(" POTENTIAL DUPLICATE GROUPS (FIRST 5 EXAMPLES)");
    console.log("-------------------------------------------------------");
    report.duplicateGroups.slice(0, 5).forEach((group, idx) => {
      console.log(`\nGroup #${idx + 1} [${group.canonicalMonth}] (${group.feeType}):`);
      console.log(`  Center: ${maskIdentifier(group.centerId)} | Student: ${maskIdentifier(group.studentId)}`);
      console.log(`  Conflict Type: ${group.conflictType}`);
      console.log(`  Recommendation: ${group.recommendedAction}`);
      group.records.forEach((rec) => {
        console.log(`    - Fee ID: ${maskIdentifier(rec.feeId)} | Status: ${rec.status} | Amount: ₹${rec.amountDue} | Label: "${rec.originalMonth}"`);
      });
    });
  }

  if (report.ambiguousRecords.length > 0) {
    console.log("\n-------------------------------------------------------");
    console.log(" AMBIGUOUS RECORDS REQUIRING MANUAL REVIEW (FIRST 5)");
    console.log("-------------------------------------------------------");
    report.ambiguousRecords.slice(0, 5).forEach((rec, idx) => {
      console.log(`  ${idx + 1}. Fee ID: ${maskIdentifier(rec.feeId)} | Month: "${rec.originalMonth}" | Notes: ${rec.notes.join("; ")}`);
    });
  }

  console.log("\n=======================================================");
  console.log(" ZERO DATABASE WRITES OR INDEX OPERATIONS EXECUTED.");
  console.log(" ALL DATA PRESERVED INTACT.");
  console.log("=======================================================\n");
}

// Execute when invoked directly
if (process.argv[1]?.includes("reconcile-fees-preflight")) {
  main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
}

export { main };
