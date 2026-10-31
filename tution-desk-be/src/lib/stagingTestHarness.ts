/**
 * TuitionDesk Phase 2I.4 — Staging Test Harness Core Architecture
 *
 * Provides:
 * 1. BSON-safe canonical fingerprinting across non-migration fields.
 * 2. In-memory simulated Fee repository with atomic updateOne semantics.
 * 3. 5-state durable execution ledger (PREPARED, APPLIED, VERIFIED, FAILED, RECOVERY_REQUIRED).
 * 4. Crash recovery and rollback eligibility evaluators.
 *
 * SAFETY INVARIANTS:
 * - Strictly in-memory and isolated test harness.
 * - Zero network access, zero database connections, zero mutations to .audit_snapshot.
 */

import crypto from "crypto";
import type { RawFeeRecord } from "./reconciliationEngine.ts";

export type LedgerEntryState =
  | "PREPARED"
  | "APPLIED"
  | "VERIFIED"
  | "FAILED"
  | "RECOVERY_REQUIRED";

export interface MigrationPlannedUpdates {
  feeType: "monthly_recurring";
  billingMonth: string; // Strictly YYYY-MM
}

export interface LedgerEntry {
  planId: string;
  feeId: string;
  centerId: string;
  studentId: string;
  state: LedgerEntryState;
  preMigrationFingerprint: string;
  preMigrationSnapshot: Record<string, unknown>;
  plannedUpdates: MigrationPlannedUpdates;
  errorMessage?: string;
  recoveryNote?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * BSON-safe deterministic value canonicalizer.
 * Normalizes ObjectIds, Dates, nested objects, and arrays for reliable SHA-256 hashing.
 */
export function canonicalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) {
    return null;
  }

  // Handle BSON ObjectId or ObjectId-like structures
  if (typeof val === "object" && val !== null) {
    if ("_bsontype" in val && (val as { _bsontype: string })._bsontype === "ObjectId") {
      return String(val);
    }
    if (val instanceof Date) {
      return val.toISOString();
    }
    if (Array.isArray(val)) {
      return val.map(canonicalizeValue);
    }

    // Sort object keys deterministically
    const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeValue((val as Record<string, unknown>)[key]);
    }
    return result;
  }

  if (typeof val === "number" || typeof val === "boolean" || typeof val === "string") {
    return val;
  }

  return String(val);
}

/**
 * Computes a deterministic SHA-256 hash across all non-migration fields.
 *
 * EXCLUSION RATIONALE:
 * - `feeType` & `billingMonth`: Excluded because they are the exact target fields added by migration.
 * - `updatedAt`: Excluded because every document update in MongoDB automatically updates this timestamp.
 * - `__v`: Excluded because Mongoose internal version key increments on document modifications.
 *
 * ALL OTHER FIELDS (amountDue, paidAmount, status, utrNumber, upiTransactionId, paymentMode,
 * dueDate, month, title, notes, paymentTransactions, createdAt) ARE INCLUDED.
 */
export function computeDocumentFingerprint(doc: Record<string, unknown>): string {
  const {
    feeType: _ft,
    billingMonth: _bm,
    updatedAt: _ua,
    __v: _v,
    ...nonMigrationFields
  } = doc;

  const canonical = canonicalizeValue(nonMigrationFields);
  const jsonStr = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(jsonStr).digest("hex");
}

/**
 * Validates whether a live document is eligible for rollback against its original snapshot.
 * Detects any changes to non-migration fields.
 */
export function evaluateRollbackEligibility(
  liveDoc: Record<string, unknown>,
  ledgerEntry: LedgerEntry
): { eligible: boolean; reason?: string; driftedFields?: string[] } {
  const currentFingerprint = computeDocumentFingerprint(liveDoc);

  if (currentFingerprint === ledgerEntry.preMigrationFingerprint) {
    return { eligible: true };
  }

  // Identify drifted fields for detailed audit output
  const driftedFields: string[] = [];
  const snapshot = ledgerEntry.preMigrationSnapshot;

  const allKeys = Array.from(new Set([...Object.keys(snapshot), ...Object.keys(liveDoc)]));
  for (const k of allKeys) {
    if (k === "feeType" || k === "billingMonth" || k === "updatedAt" || k === "__v") {
      continue;
    }
    const snapVal = JSON.stringify(canonicalizeValue(snapshot[k]));
    const liveVal = JSON.stringify(canonicalizeValue(liveDoc[k]));
    if (snapVal !== liveVal) {
      driftedFields.push(k);
    }
  }

  return {
    eligible: false,
    reason: `Rollback refused: Document has been modified since migration (${driftedFields.join(", ")}).`,
    driftedFields,
  };
}

/**
 * In-memory simulated Fee repository with atomic updateOne filter matching semantics.
 */
export class MockFeeRepository {
  private docs: Map<string, Record<string, unknown>> = new Map();

  constructor(initialDocs: Record<string, unknown>[] = []) {
    for (const d of initialDocs) {
      const id = String(d._id);
      // Deep clone to guarantee test isolation
      this.docs.set(id, JSON.parse(JSON.stringify(d)));
    }
  }

  getDoc(id: string): Record<string, unknown> | null {
    const found = this.docs.get(id);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  getAllDocs(): Record<string, unknown>[] {
    return Array.from(this.docs.values()).map((d) => JSON.parse(JSON.stringify(d)));
  }

  /**
   * Simulates an atomic updateOne operation using strict precondition filters.
   */
  updateOne(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
  ): { matchedCount: number; modifiedCount: number } {
    const targetId = String(filter._id);
    const existing = this.docs.get(targetId);

    if (!existing) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    // Match centerId
    if (filter.centerId !== undefined && String(existing.centerId) !== String(filter.centerId)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    // Match studentId
    if (filter.studentId !== undefined && String(existing.studentId) !== String(filter.studentId)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    // Match feeType existence check
    if (filter.feeType && typeof filter.feeType === "object") {
      const ftFilter = filter.feeType as { $exists?: boolean };
      if (ftFilter.$exists === false && existing.feeType !== undefined) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
    }

    // Match billingMonth existence check
    if (filter.billingMonth && typeof filter.billingMonth === "object") {
      const bmFilter = filter.billingMonth as { $exists?: boolean };
      if (bmFilter.$exists === false && existing.billingMonth !== undefined) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
    }

    // Match isAdvance guard
    if (filter.isAdvance && typeof filter.isAdvance === "object") {
      const advFilter = filter.isAdvance as { $ne?: boolean };
      if (advFilter.$ne === true && existing.isAdvance === true) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
    }

    // Match month label
    if (filter.month !== undefined && existing.month !== filter.month) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    // Apply updates
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        existing[k] = v;
      }
    }

    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) {
        delete existing[k];
      }
    }

    existing.updatedAt = new Date().toISOString();
    return { matchedCount: 1, modifiedCount: 1 };
  }

  insertDoc(doc: Record<string, unknown>): Record<string, unknown> {
    const id = String(doc._id || `mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const newDoc = {
      ...doc,
      _id: id,
      createdAt: doc.createdAt || new Date().toISOString(),
      updatedAt: doc.updatedAt || new Date().toISOString(),
    };
    this.docs.set(id, newDoc);
    return JSON.parse(JSON.stringify(newDoc));
  }
}

/**
 * In-memory / durable test implementation of the 5-state execution ledger.
 */
export class TestExecutionLedger {
  public entries: LedgerEntry[] = [];
  public crashSimulatedOnId: string | null = null;

  recordState(entry: LedgerEntry): void {
    const idx = this.entries.findIndex((e) => e.feeId === entry.feeId);
    if (idx >= 0) {
      this.entries[idx] = { ...entry, updatedAt: new Date().toISOString() };
    } else {
      this.entries.push({
        ...entry,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  getEntry(feeId: string): LedgerEntry | undefined {
    return this.entries.find((e) => e.feeId === feeId);
  }

  /**
   * Reconciles incomplete ledger entries on startup.
   * Handles crashes occurring between DB update and APPLIED/VERIFIED ledger write.
   */
  reconcileStartup(repo: MockFeeRepository): {
    reconciledCount: number;
    failedCount: number;
    errors: string[];
  } {
    let reconciledCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    const unresolved = this.entries.filter(
      (e) => e.state === "PREPARED" || e.state === "APPLIED"
    );

    for (const entry of unresolved) {
      const liveDoc = repo.getDoc(entry.feeId);
      if (!liveDoc) {
        entry.state = "RECOVERY_REQUIRED";
        entry.errorMessage = `Document ${entry.feeId} not found in repository.`;
        failedCount++;
        errors.push(entry.errorMessage);
        continue;
      }

      const currentFingerprint = computeDocumentFingerprint(liveDoc);

      // Scenario A: DB update never executed
      if (!liveDoc.feeType && !liveDoc.billingMonth) {
        if (currentFingerprint === entry.preMigrationFingerprint) {
          entry.state = "PREPARED";
          entry.recoveryNote = "Crash occurred before DB write. Reset to PREPARED.";
          reconciledCount++;
        } else {
          entry.state = "RECOVERY_REQUIRED";
          entry.errorMessage = "Crash before write, but document drifted externally.";
          failedCount++;
          errors.push(entry.errorMessage);
        }
        continue;
      }

      // Scenario B: DB update succeeded, but ledger crashed before confirmation
      if (
        liveDoc.feeType === entry.plannedUpdates.feeType &&
        liveDoc.billingMonth === entry.plannedUpdates.billingMonth
      ) {
        if (currentFingerprint === entry.preMigrationFingerprint) {
          entry.state = "VERIFIED";
          entry.recoveryNote = "Crash after DB write detected. Reconciled to VERIFIED via fingerprint match.";
          reconciledCount++;
        } else {
          entry.state = "RECOVERY_REQUIRED";
          entry.errorMessage = "Target fields set, but non-migration fields drifted.";
          failedCount++;
          errors.push(entry.errorMessage);
        }
        continue;
      }

      // Scenario C: Unexpected or contradictory values
      entry.state = "RECOVERY_REQUIRED";
      entry.errorMessage = "Document has unexpected state differing from plan.";
      failedCount++;
      errors.push(entry.errorMessage);
    }

    return { reconciledCount, failedCount, errors };
  }
}
