/**
 * TuitionDesk Phase 2H — Safe Legacy Fee Backfill Planning CLI (Dry-Run Only)
 *
 * Usage:
 *   npx tsx scripts/plan-fees-backfill.ts --target=approved_readonly
 *
 * STRICT SAFETY BOUNDARIES:
 * - PROPOSAL & DRY-RUN ONLY.
 * - Requires explicit --target=approved_readonly or ALLOW_AUDIT_DATABASE_RUN=true.
 * - Performs zero inserts, updates, deletes, bulk writes, or index creations.
 * - Redacts all parent phone numbers, names, and transaction identifiers.
 * - Model mutation methods are stubbed out and throw immediately if called.
 */

import mongoose from "mongoose";
import {
  validateExecutionSafety,
  validateDatabaseTarget,
  sanitizeMongoUri,
  RawFeeRecord,
} from "../src/lib/reconciliationEngine.ts";
import {
  generateBackfillPlan,
  formatBackfillDryRunReport,
} from "../src/lib/backfillPlanner.ts";
import { readFeeSnapshotFile } from "../src/lib/snapshotReader.ts";

async function main() {
  const args = process.argv.slice(2);

  // 1. Enforce strict safety boundary check
  const safety = validateExecutionSafety(process.env, args);
  if (!safety.safe) {
    console.error("\n❌ BACKFILL PLANNING SAFETY CHECK FAILED");
    console.error(safety.reason);
    console.error(
      "\nTo run dry-run planning against an approved, isolated read-only audit database, pass:\n" +
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
      console.error("\n❌ SNAPSHOT BACKFILL PLANNING ERROR: Missing file path in --input=<path> argument.");
      process.exit(1);
    }

    console.log("\n=======================================================");
    console.log(" TuitionDesk Phase 2H: Fee Backfill Planner (Dry-Run)");
    console.log(" MODE: LOCAL SNAPSHOT AUDIT (OFFLINE / PROPOSAL ONLY)");
    console.log("=======================================================");
    console.log(`Snapshot File:    ${inputPath}`);
    console.log("SAFETY DIRECTIVES:");
    console.log("- ZERO database or network connections initiated.");
    console.log("- Source snapshot file is read-only and never modified.");
    console.log("- Proposal only: Zero mutations, writes, or index operations.");
    console.log("=======================================================\n");

    try {
      console.log(`Reading snapshot file: ${inputPath}...`);
      const snapshot = readFeeSnapshotFile(inputPath);
      console.log(`Loaded ${snapshot.records.length} records (${snapshot.fileSizeBytes} bytes, format: ${snapshot.format.toUpperCase()}).`);
      console.log(`Inspecting ${snapshot.records.length} records through backfill planner...`);

      const plan = generateBackfillPlan(snapshot.records);
      const reportText = formatBackfillDryRunReport(plan);

      console.log(reportText);
      return;
    } catch (err: unknown) {
      console.error("\n❌ SNAPSHOT BACKFILL PLANNING ERROR");
      const rawMessage = err instanceof Error ? err.message : String(err);
      console.error(rawMessage);
      process.exit(1);
    }
  }

  // 3. Strict Database Target Verification
  const auditUri = process.env.MONGODB_AUDIT_URI;
  const primaryUri = process.env.MONGODB_URI;
  const expectedDbName =
    process.env.EXPECTED_AUDIT_DB_NAME ||
    args.find((a) => a.startsWith("--expected-db="))?.split("=")[1];
  const allowPrimaryDb = args.includes("--allow-primary-db");

  if (!expectedDbName || !expectedDbName.trim()) {
    console.error("\n❌ DATABASE TARGET VERIFICATION FAILED");
    console.error(
      "Execution safety guard: Missing EXPECTED_AUDIT_DB_NAME. You must explicitly configure the expected audit database name."
    );
    console.error(
      "\nAlternatively, run offline against a local backup via --input=<path/to/fees.bson>.\n"
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
    process.exit(1);
  }

  console.log("\n=======================================================");
  console.log(" TuitionDesk Phase 2H: Fee Backfill Planner (Dry-Run)");
  console.log(" MODE: STRICT READ-ONLY / PROPOSAL ONLY");
  console.log("=======================================================");
  console.log(`Target Database:  ${targetValidation.databaseName}`);
  console.log("Connection URI: [REDACTED]");
  console.log("=======================================================\n");

  let connection: typeof mongoose | null = null;

  try {
    console.log("Connecting to audit database (autoIndex: false, bufferCommands: false)...");

    connection = await mongoose.connect(auditUri!, {
      autoIndex: false,
      bufferCommands: false,
      readPreference: "secondaryPreferred",
    });

    console.log("Connected successfully. Streaming fee records for dry-run analysis...");

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
        throw new Error(`CRITICAL MUTATION BLOCKED: Method "${method}" is strictly prohibited.`);
      };
    }

    const rawRecords = (await FeeModel.find({}).lean().exec()) as unknown as RawFeeRecord[];

    console.log(`Inspecting ${rawRecords.length} records through backfill planner...`);

    const plan = generateBackfillPlan(rawRecords);
    const reportText = formatBackfillDryRunReport(plan);

    console.log(reportText);
  } catch (err: unknown) {
    console.error("\n❌ BACKFILL PLANNING ERROR");
    const rawMessage = err instanceof Error ? err.message : String(err);
    const sanitized = sanitizeMongoUri(rawMessage)
      .replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, "[REDACTED_MONGODB_URI]")
      .replace(/[a-zA-Z0-9_\-]+\.mongodb\.net/gi, "[REDACTED_CLUSTER_HOST]");
    console.error(sanitized);
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

// Execute when invoked directly
if (process.argv[1]?.includes("plan-fees-backfill")) {
  main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
}

export { main };
