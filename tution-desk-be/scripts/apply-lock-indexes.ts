/**
 * TuitionDesk Phase 2I.6.4 — Execute Approved Production Lock Indexes
 *
 * Target:
 *   Database:   test
 *   Collection: feecreationlocks
 *
 * Indexes to apply:
 *   1. Unique index: { lockKey: 1 }, { unique: true, name: "lockKey_1" }
 *   2. TTL index:    { expiresAt: 1 }, { expireAfterSeconds: 600, name: "expiresAt_1" }
 */

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { sanitizeMongoUri } from "../src/lib/reconciliationEngine.ts";

// Automatically load local .env if present
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

async function main() {
  const rawUri = process.env.MONGODB_AUDIT_URI || process.env.MONGODB_URI;

  if (!rawUri || !rawUri.trim()) {
    console.error("❌ ERROR: Missing database connection URI.");
    process.exit(1);
  }

  // Normalize URI to target database 'test' if no database specified in path
  let targetUri = rawUri.trim();
  const httpEquiv = targetUri.replace(/^mongodb(\+srv)?:\/\//i, "http://");
  try {
    const parsed = new URL(httpEquiv);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    if (!pathname) {
      targetUri = targetUri.replace(/\/?(\?|$)/, "/test$1");
    }
  } catch {
    // Retain targetUri if URL parsing fails
  }

  console.log("===============================================================================");
  console.log(" TuitionDesk Phase 2I.6.4: Execute Approved Lock Indexes");
  console.log(" TARGET: Database 'test', Collection 'feecreationlocks'");
  console.log("===============================================================================");
  console.log(`Connection URI: ${sanitizeMongoUri(targetUri)}`);

  let connection: typeof mongoose | null = null;

  try {
    connection = await mongoose.connect(targetUri, {
      autoIndex: false,
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Failed to access MongoDB database instance.");
    }

    // Step 1: Final safety check
    const dbName = db.databaseName;
    console.log(`[VERIFY 1] Active Database Name: '${dbName}'`);
    if (dbName !== "test") {
      throw new Error(`ABORT: Expected database 'test', but active database is '${dbName}'.`);
    }

    const collectionName = "feecreationlocks";
    console.log(`[VERIFY 2] Target Collection: '${collectionName}'`);

    const collection = db.collection(collectionName);

    // Recheck documents
    const docCount = await collection.countDocuments();
    console.log(`[VERIFY 3] Current Document Count: ${docCount}`);

    if (docCount > 0) {
      const docs = await collection.find({}).toArray();
      const keys = new Set<string>();
      for (const doc of docs) {
        if (!doc.lockKey || typeof doc.lockKey !== "string" || !doc.lockKey.trim()) {
          throw new Error(`ABORT: Document ${doc._id} has invalid or missing lockKey.`);
        }
        if (keys.has(doc.lockKey)) {
          throw new Error(`ABORT: Duplicate lockKey found: '${doc.lockKey}'.`);
        }
        keys.add(doc.lockKey);
      }
      console.log(`[VERIFY 4] Document check passed: All ${docCount} documents have unique, valid lockKeys.`);
    } else {
      console.log(`[VERIFY 4] Collection is empty. Ready for index initialization.`);
    }

    // Recheck current indexes
    let existingIndexes: any[] = [];
    try {
      existingIndexes = await collection.indexes();
    } catch {
      // Collection does not exist yet; listIndexes returns empty
      existingIndexes = [];
    }

    console.log(`[VERIFY 5] Existing Index Count: ${existingIndexes.length}`);
    for (const idx of existingIndexes) {
      console.log(`  - Index '${idx.name}': ${JSON.stringify(idx.key)} (unique: ${Boolean(idx.unique)})`);
    }

    // Step 2: Execute approved index creation
    console.log("\n-------------------------------------------------------------------------------");
    console.log(" EXECUTING INDEX CREATION:");
    console.log("-------------------------------------------------------------------------------");

    // 1. Unique index on lockKey
    const hasLockKeyIndex = existingIndexes.some(
      (idx) => idx.key && idx.key.lockKey === 1 && idx.unique === true
    );

    if (hasLockKeyIndex) {
      console.log("-> Unique index { lockKey: 1 } already exists. Verified.");
    } else {
      console.log("-> Creating unique index: { lockKey: 1 } with unique: true, name: 'lockKey_1'...");
      const resultName1 = await collection.createIndex(
        { lockKey: 1 },
        { unique: true, name: "lockKey_1" }
      );
      console.log(`✅ Unique index created successfully: '${resultName1}'`);
    }

    // 2. TTL index on expiresAt
    const hasTtlIndex = existingIndexes.some(
      (idx) => idx.key && idx.key.expiresAt === 1 && idx.expireAfterSeconds === 600
    );

    if (hasTtlIndex) {
      console.log("-> TTL index { expiresAt: 1 } already exists. Verified.");
    } else {
      console.log("-> Creating TTL index: { expiresAt: 1 } with expireAfterSeconds: 600, name: 'expiresAt_1'...");
      const resultName2 = await collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 600, name: "expiresAt_1" }
      );
      console.log(`✅ TTL index created successfully: '${resultName2}'`);
    }

    // Step 3: Verify indexes in database
    console.log("\n-------------------------------------------------------------------------------");
    console.log(" VERIFYING FINAL INDEXES (listIndexes):");
    console.log("-------------------------------------------------------------------------------");

    const finalIndexes = await collection.indexes();
    console.log(`Total Active Indexes on '${collectionName}': ${finalIndexes.length}`);

    let lockKeyVerified = false;
    let ttlVerified = false;

    for (const idx of finalIndexes) {
      const isUnique = idx.unique === true;
      const ttlSec = idx.expireAfterSeconds;
      const details = [
        isUnique ? "UNIQUE" : "",
        ttlSec !== undefined ? `TTL: ${ttlSec}s` : "",
      ]
        .filter(Boolean)
        .join(", ");

      console.log(`  * Index '${idx.name}': ${JSON.stringify(idx.key)} [${details || "STANDARD"}]`);

      if (idx.key && idx.key.lockKey === 1 && isUnique) {
        lockKeyVerified = true;
      }
      if (idx.key && idx.key.expiresAt === 1 && ttlSec === 600) {
        ttlVerified = true;
      }
    }

    if (!lockKeyVerified) {
      throw new Error("Verification failed: Unique index on 'lockKey' was not found after creation.");
    }
    if (!ttlVerified) {
      throw new Error("Verification failed: TTL index on 'expiresAt' was not found after creation.");
    }

    console.log("\n✅ ALL INDEX CREATIONS CONFIRMED ACTIVE AND ENFORCED.");
  } catch (err: unknown) {
    console.error("\n❌ INDEX CREATION FAILED:");
    const msg = err instanceof Error ? err.message : String(err);
    console.error(sanitizeMongoUri(msg));
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
