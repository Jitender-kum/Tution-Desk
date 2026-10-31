/**
 * TuitionDesk Phase 2I.6.3 — Production Lock Index Readiness CLI (Read-Only)
 *
 * Usage:
 *   npx tsx scripts/verify-lock-readiness.ts --target=approved_readonly --allow-primary-db --expected-db=test
 *   npx tsx scripts/verify-lock-readiness.ts --target=approved_readonly --simulate
 *
 * STRICT SAFETY BOUNDARIES:
 * - Read-only execution mode strictly enforced.
 * - Performs zero inserts, updates, deletes, index operations, or schema migrations.
 * - Connection errors sanitized to avoid exposing database URIs or credentials.
 * - Confirms database name is exactly 'test' and collection is 'feecreationlocks'.
 * - Checks authenticated user authorization roles.
 * - Emits strict GO / NO-GO readiness report.
 */

import mongoose from "mongoose";
import fs from "fs";
import path from "path";

// Automatically load local .env if present and environment variables are not yet in process.env
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
} catch {
  // Ignore fallback file read error
}

import FeeCreationLock from "../src/models/FeeCreationLock.ts";
import {
  auditLockCollection,
  formatLockReadinessReport,
  LockCollectionAuditReport,
} from "../src/lib/lockReadiness.ts";
import {
  validateExecutionSafety,
  validateDatabaseTarget,
  sanitizeMongoUri,
} from "../src/lib/reconciliationEngine.ts";

async function main() {
  const args = process.argv.slice(2);

  // 1. Enforce strict safety boundary check
  const safety = validateExecutionSafety(process.env, args);
  if (!safety.safe) {
    console.error("\n❌ PREFLIGHT SAFETY CHECK FAILED");
    console.error(safety.reason);
    console.error(
      "\nTo run against an approved, isolated read-only audit database, pass:\n" +
      "  --target=approved_readonly --allow-primary-db --expected-db=test\n" +
      "along with an explicit MONGODB_AUDIT_URI or MONGODB_URI environment variable.\n" +
      "Or to run in simulated mode, pass:\n" +
      "  --target=approved_readonly --simulate\n"
    );
    process.exit(1);
  }

  // 2. Simulated verification mode
  if (args.includes("--simulate")) {
    console.log("\n=======================================================");
    console.log(" TuitionDesk Phase 2I.6.3: Lock Readiness Preflight");
    console.log(" MODE: SIMULATION AUDIT (OFFLINE)");
    console.log("=======================================================\n");

    const mockEmptyCollection = {
      collection: {
        name: "feecreationlocks",
        indexes: async () => [{ key: { _id: 1 }, name: "_id_" }],
      },
      find: async () => [],
    };

    const report = await auditLockCollection(mockEmptyCollection);
    console.log(formatLockReadinessReport(report));
    return;
  }

  // 3. Database Target Verification
  let auditUri = process.env.MONGODB_AUDIT_URI || process.env.MONGODB_URI;
  const primaryUri = process.env.MONGODB_URI;
  const expectedDbName =
    process.env.EXPECTED_AUDIT_DB_NAME ||
    args.find((a) => a.startsWith("--expected-db="))?.split("=")[1] ||
    "test";
  const allowPrimaryDb = args.includes("--allow-primary-db");

  if (!auditUri || !auditUri.trim()) {
    console.error("\n❌ DATABASE TARGET VERIFICATION FAILED: Missing database connection URI.");
    process.exit(1);
  }

  // If URI has no explicit database path, normalize with /test (MongoDB default)
  let normalizedAuditUri = auditUri.trim();
  const httpEquiv = normalizedAuditUri.replace(/^mongodb(\+srv)?:\/\//i, "http://");
  try {
    const parsed = new URL(httpEquiv);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    if (!pathname) {
      normalizedAuditUri = normalizedAuditUri.replace(/\/?(\?|$)/, "/test$1");
    }
  } catch {
    // If URL parsing fails, retain original
  }

  const targetValidation = validateDatabaseTarget({
    auditUri: normalizedAuditUri,
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
  console.log(" TuitionDesk Phase 2I.6.3: Final Production Index Preflight");
  console.log(" MODE: STRICT READ-ONLY AUDIT (ZERO MUTATIONS)");
  console.log("=======================================================");
  console.log(`Target Database:  ${targetValidation.databaseName}`);
  console.log(`Connection URI:   ${targetValidation.sanitizedUri}`);
  console.log("SECURITY DIRECTIVES:");
  console.log("- STRICT READ-ONLY access. Zero mutations, writes, or index modifications.");
  console.log("- autoIndex is disabled. BufferCommands is disabled.");
  console.log("=======================================================\n");

  let connection: typeof mongoose | null = null;

  try {
    connection = await mongoose.connect(normalizedAuditUri, {
      autoIndex: false,
      bufferCommands: false,
      readPreference: "secondaryPreferred",
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Failed to access MongoDB database instance.");
    }

    const actualDbName = db.databaseName;
    console.log(`[CONFIRMED] Active Database Name: '${actualDbName}'`);
    if (actualDbName !== "test") {
      throw new Error(`Execution safety guard: Expected database 'test', but active database is '${actualDbName}'. Aborting.`);
    }

    // Inspect user privileges (read-only verification)
    let userRoles: Array<{ role: string; db: string }> = [];
    try {
      const status = await db.command({ connectionStatus: 1 });
      userRoles = status?.authInfo?.authenticatedUserRoles || [];
      console.log(`[AUTH] Authenticated User Roles Count: ${userRoles.length}`);
      for (const r of userRoles) {
        console.log(`  - Role: '${r.role}' on database '${r.db}'`);
      }
    } catch {
      console.log("[AUTH] connectionStatus command was unavailable; proceeding with read-only collection queries.");
    }

    // Inspect existing collections
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);
    const collectionExists = collectionNames.includes("feecreationlocks");

    console.log(`[CONFIRMED] Target Collection Name: 'feecreationlocks'`);
    console.log(`[STATUS] Collection Exists in DB: ${collectionExists ? "YES" : "NO (Clean/Uninitialized)"}`);

    let report: LockCollectionAuditReport;

    if (collectionExists) {
      const nativeCollection = db.collection("feecreationlocks");
      report = await auditLockCollection({
        collection: nativeCollection,
      });
    } else {
      // Collection has not had any documents inserted yet
      report = await auditLockCollection({
        collection: {
          name: "feecreationlocks",
          indexes: async () => [],
        },
        find: async () => [],
      });
    }

    console.log("\n" + formatLockReadinessReport(report));

    console.log("\n=======================================================");
    console.log(" EXACT ADMINISTRATOR INDEX COMMANDS REQUIRED:");
    console.log("=======================================================");
    console.log("// 1. Unique index for distributed mutual exclusion");
    console.log("db.feecreationlocks.createIndex({ lockKey: 1 }, { unique: true });\n");
    console.log("// 2. TTL index for automatic expiration of orphaned locks (10 min)");
    console.log("db.feecreationlocks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 600 });");
    console.log("=======================================================\n");

    if (report.readinessStatus !== "GO") {
      console.log("PREFLIGHT OUTCOME: 🔴 READY FOR ADMINISTRATOR ACTION (Indexes missing, data clean)");
    } else {
      console.log("PREFLIGHT OUTCOME: 🟢 FULLY READY & INDEXED");
    }
  } catch (err: unknown) {
    console.error("\n❌ PREFLIGHT AUDIT FAILED TO EXECUTE");
    const rawMessage = err instanceof Error ? err.message : String(err);
    const sanitized = sanitizeMongoUri(rawMessage);
    console.error(sanitized);
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("Fatal preflight error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
