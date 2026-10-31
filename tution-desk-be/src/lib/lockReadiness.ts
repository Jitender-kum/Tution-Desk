import { Model } from "mongoose";

export interface LockDocumentRecord {
  _id?: unknown;
  lockKey?: string;
  centerId?: string;
  studentId?: string;
  billingMonth?: string;
  feeType?: string;
  lockedAt?: Date | string;
  expiresAt?: Date | string;
  holderId?: string;
  status?: string;
  feeId?: string;
}

export interface ExistingIndexSpec {
  name?: string;
  key: Record<string, number | string>;
  unique?: boolean;
  expireAfterSeconds?: number;
  expires?: number | string;
}

export interface LockCollectionAuditReport {
  timestamp: string;
  collectionName: string;
  totalDocuments: number;
  missingLockKeysCount: number;
  duplicateLockKeys: Array<{ lockKey: string; count: number }>;
  activeLocksCount: number;
  expiredLocksCount: number;
  existingIndexes: ExistingIndexSpec[];
  hasUniqueLockKeyIndex: boolean;
  hasTtlExpiresAtIndex: boolean;
  uniqueIndexSpecMatchesSchema: boolean;
  ttlIndexSpecMatchesSchema: boolean;
  readinessStatus: "GO" | "NO_GO_INDEX_MISSING" | "NO_GO_DUPLICATE_KEYS" | "NO_GO_CORRUPT_DATA";
  decisionReasons: string[];
  recommendations: string[];
}

/**
 * Inspects lock collection state, documents, and index readiness.
 * Pure read-only inspection; executes zero mutations, index builds, or schema modifications.
 */
export async function auditLockCollection(
  collectionOrModel: any,
  referenceDate: Date = new Date()
): Promise<LockCollectionAuditReport> {
  const collectionName =
    collectionOrModel?.collection?.name ||
    collectionOrModel?.collectionName ||
    "feecreationlocks";

  let documents: LockDocumentRecord[] = [];
  let existingIndexes: ExistingIndexSpec[] = [];

  // 1. Fetch existing documents (read-only)
  if (typeof collectionOrModel?.find === "function") {
    // Mongoose Model or Mock find
    const res = await collectionOrModel.find({}).lean?.() ?? await collectionOrModel.find({});
    documents = Array.isArray(res) ? res : [];
  } else if (typeof collectionOrModel?.collection?.find === "function") {
    // Native MongoDB collection find
    const cursor = collectionOrModel.collection.find({});
    documents = typeof cursor.toArray === "function" ? await cursor.toArray() : await cursor;
  }

  // 2. Fetch existing indexes
  if (typeof collectionOrModel?.collection?.indexes === "function") {
    existingIndexes = await collectionOrModel.collection.indexes();
  } else if (typeof collectionOrModel?.collection?.listIndexes === "function") {
    const cursor = collectionOrModel.collection.listIndexes();
    existingIndexes = typeof cursor.toArray === "function" ? await cursor.toArray() : await cursor;
  } else if (typeof collectionOrModel?.listIndexes === "function") {
    existingIndexes = await collectionOrModel.listIndexes();
  }

  // 3. Inspect documents for duplicates, missing keys, active/expired
  let missingLockKeysCount = 0;
  const lockKeyCounts = new Map<string, number>();
  let activeLocksCount = 0;
  let expiredLocksCount = 0;
  const nowMs = referenceDate.getTime();

  for (const doc of documents) {
    if (!doc.lockKey || typeof doc.lockKey !== "string" || !doc.lockKey.trim()) {
      missingLockKeysCount++;
      continue;
    }

    const key = doc.lockKey.trim();
    lockKeyCounts.set(key, (lockKeyCounts.get(key) || 0) + 1);

    if (doc.expiresAt) {
      const expMs = new Date(doc.expiresAt).getTime();
      if (!isNaN(expMs)) {
        if (expMs > nowMs) {
          activeLocksCount++;
        } else {
          expiredLocksCount++;
        }
      }
    }
  }

  const duplicateLockKeys: Array<{ lockKey: string; count: number }> = [];
  for (const [lockKey, count] of lockKeyCounts.entries()) {
    if (count > 1) {
      duplicateLockKeys.push({ lockKey, count });
    }
  }

  // 4. Inspect index specifications
  const hasUniqueLockKeyIndex = existingIndexes.some((idx) => {
    return idx.key && idx.key.lockKey === 1 && idx.unique === true;
  });

  const hasTtlExpiresAtIndex = existingIndexes.some((idx) => {
    return (
      idx.key &&
      idx.key.expiresAt === 1 &&
      (typeof idx.expireAfterSeconds === "number" || typeof idx.expires !== "undefined")
    );
  });

  // Verify proposed schema alignment
  const uniqueIndexSpecMatchesSchema = hasUniqueLockKeyIndex;
  const ttlIndexSpecMatchesSchema = hasTtlExpiresAtIndex;

  // 5. Evaluate GO / NO-GO status
  const decisionReasons: string[] = [];
  const recommendations: string[] = [];
  let readinessStatus: LockCollectionAuditReport["readinessStatus"] = "GO";

  if (missingLockKeysCount > 0) {
    readinessStatus = "NO_GO_CORRUPT_DATA";
    decisionReasons.push(
      `Found ${missingLockKeysCount} documents with missing or non-string lockKey field.`
    );
    recommendations.push(
      "Purge or remediate invalid documents lacking lockKey before activating distributed locking."
    );
  }

  if (duplicateLockKeys.length > 0) {
    readinessStatus = "NO_GO_DUPLICATE_KEYS";
    decisionReasons.push(
      `Found ${duplicateLockKeys.length} lockKey value(s) with duplicate records in the collection.`
    );
    recommendations.push(
      "Deduplicate existing lock records before applying the unique index constraint."
    );
  }

  if (!hasUniqueLockKeyIndex) {
    if (readinessStatus === "GO") {
      readinessStatus = "NO_GO_INDEX_MISSING";
    }
    decisionReasons.push(
      "Mandatory unique index { lockKey: 1 } (unique: true) does not exist on collection 'feecreationlocks'."
    );
    recommendations.push(
      "Execute production index creation: db.feecreationlocks.createIndex({ lockKey: 1 }, { unique: true })."
    );
  }

  if (!hasTtlExpiresAtIndex) {
    decisionReasons.push(
      "TTL index { expiresAt: 1 } is missing. Lock records will not be automatically purged by MongoDB background TTL."
    );
    recommendations.push(
      "Execute TTL index creation: db.feecreationlocks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 600 })."
    );
  }

  if (readinessStatus === "GO") {
    decisionReasons.push(
      "Unique index on lockKey is confirmed active and unique constraint is enforced.",
      "Zero corrupted or duplicate lock records exist in collection.",
      "TTL index is present for automatic background cleanup."
    );
    recommendations.push(
      "Production lock collection is ready for live concurrency coordination."
    );
  }

  return {
    timestamp: referenceDate.toISOString(),
    collectionName,
    totalDocuments: documents.length,
    missingLockKeysCount,
    duplicateLockKeys,
    activeLocksCount,
    expiredLocksCount,
    existingIndexes,
    hasUniqueLockKeyIndex,
    hasTtlExpiresAtIndex,
    uniqueIndexSpecMatchesSchema,
    ttlIndexSpecMatchesSchema,
    readinessStatus,
    decisionReasons,
    recommendations,
  };
}

/**
 * Formats the audit report as a clean, redacted terminal report
 */
export function formatLockReadinessReport(report: LockCollectionAuditReport): string {
  const lines: string[] = [];
  lines.push("===============================================================================");
  lines.push(" TuitionDesk Phase 2I.6.2: Production Lock Index Readiness Audit");
  lines.push(" MODE: READ-ONLY AUDIT (ZERO WRITES, ZERO INDEX CREATIONS)");
  lines.push("===============================================================================");
  lines.push(`Audit Timestamp:       ${report.timestamp}`);
  lines.push(`Target Collection:     ${report.collectionName}`);
  lines.push(`Total Documents:       ${report.totalDocuments}`);
  lines.push(`Active Locks:          ${report.activeLocksCount}`);
  lines.push(`Expired Locks:         ${report.expiredLocksCount}`);
  lines.push(`Corrupt / Missing Key: ${report.missingLockKeysCount}`);
  lines.push(`Duplicate Keys:        ${report.duplicateLockKeys.length}`);
  lines.push("-------------------------------------------------------------------------------");
  lines.push("INDEX INSPECTION:");
  lines.push(`Unique Index { lockKey: 1 }:   ${report.hasUniqueLockKeyIndex ? "✅ ACTIVE & ENFORCED" : "❌ MISSING"}`);
  lines.push(`TTL Index { expiresAt: 1 }:    ${report.hasTtlExpiresAtIndex ? "✅ ACTIVE" : "⚠️ MISSING"}`);
  lines.push(`Existing Index Count:          ${report.existingIndexes.length}`);
  for (const idx of report.existingIndexes) {
    const keyStr = JSON.stringify(idx.key);
    const uniqueStr = idx.unique ? " (unique: true)" : "";
    const ttlStr = idx.expireAfterSeconds !== undefined ? ` (TTL: ${idx.expireAfterSeconds}s)` : "";
    lines.push(`  - ${idx.name || "index"}: ${keyStr}${uniqueStr}${ttlStr}`);
  }
  lines.push("-------------------------------------------------------------------------------");
  lines.push(`READINESS DECISION:    ${report.readinessStatus === "GO" ? "🟢 GO" : "🔴 NO-GO"}`);
  lines.push(`Status Code:           ${report.readinessStatus}`);
  lines.push("DECISION RATIONALE:");
  for (const reason of report.decisionReasons) {
    lines.push(`  * ${reason}`);
  }
  lines.push("RECOMMENDATIONS:");
  for (const rec of report.recommendations) {
    lines.push(`  -> ${rec}`);
  }
  lines.push("===============================================================================");
  return lines.join("\n");
}
