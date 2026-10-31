/**
 * TuitionDesk Phase 2H — Safe Legacy Fee Backfill Planner (Proposal & Dry-Run Only)
 *
 * SAFETY INVARIANTS:
 * 1. STRICTLY READ-ONLY: Never executes database updates, bulk writes, index creation, or deletes.
 * 2. IMMUTABILITY: Input records are treated as immutable and never modified in-memory.
 * 3. AUTHORITATIVE EVIDENCE ONLY: Only proposes backfill for records with unambiguous recurring evidence.
 * 4. COLLISION PRECLUSION: Prohibits backfill if multiple recurring candidate records exist for the same student and cycle.
 * 5. CANONICAL INVARIANCE: Existing valid canonical billingMonths and explicit non-recurring feeTypes are never overwritten.
 * 6. PRIVACY PRESERVING: Identifiers, parent phones, and references are masked in reports.
 *
 * OPERATIONAL MIGRATION GUIDELINES (FOR PHASE 2I EXECUTION PLANNING):
 * IMPORTANT NOTICE:
 * The following parameters and operational limits are theoretical recommendations
 * based on MongoDB design best practices. They have NOT been tested, validated,
 * or benchmarked against live production MongoDB Atlas instances. Any production
 * execution must be preceded by staging validation and gradual rollout.
 */

import {
  RawFeeRecord,
  classifyFeeRecord,
  resolveBillingMonth,
  isValidOperationalYear,
  isValidMonthNumber,
  maskIdentifier,
} from "./reconciliationEngine.ts";

export const MIGRATION_OPERATIONAL_GUIDELINES = {
  recommendedProcessingScope: "PER_CENTER",
  theoreticalBatchSizeRange: { min: 100, max: 250 },
  theoreticalTimeoutSeconds: 60,
  retryStrategy: {
    maxRetries: 3,
    backoffMs: 500,
    transientErrorHandling: "EXPONENTIAL_BACKOFF",
  },
  idempotencyRequirements: [
    "Include pre-condition filters on all update mutations (e.g. feeType: { $exists: false })",
    "Never execute unbounded updateMany operations",
    "Validate zero uncommitted writes before committing transactions",
  ],
  rollbackPlan: [
    "On unrecoverable transaction failure, execute session.abortTransaction() immediately",
    "Record all failed fee IDs with stack traces in an audit error collection",
    "Do NOT proceed to the next center if the active center transaction fails",
  ],
} as const;

export type BackfillExclusionReason =
  | "ALREADY_CANONICAL"
  | "NON_RECURRING_ADVANCE"
  | "NON_RECURRING_ADHOC"
  | "NON_RECURRING_REGISTRATION"
  | "AMBIGUOUS_EVIDENCE"
  | "INVALID_BILLING_MONTH"
  | "DUPLICATE_COLLISION_RISK"
  | "MISSING_REQUIRED_IDENTIFIERS";

export interface ProposedBackfillChange {
  feeId: string;
  centerId: string;
  studentId: string;
  currentValues: {
    feeType?: string;
    billingMonth?: string;
    month?: string;
    title?: string;
    isAdvance?: boolean;
    status: string;
  };
  proposedUpdates: {
    feeType: "monthly_recurring";
    billingMonth: string; // strictly YYYY-MM
  };
  reason: string;
  evidence: string[];
}

export interface ExcludedBackfillRecord {
  feeId: string;
  centerId: string;
  studentId: string;
  originalMonth?: string;
  originalFeeType?: string;
  reason: BackfillExclusionReason;
  explanation: string;
  status: string;
}

export interface BackfillDuplicateConflictGroup {
  identityKey: string;
  identityTuple: {
    centerId: string;
    studentId: string;
    canonicalBillingMonth: string;
  };
  centerId: string;
  studentId: string;
  canonicalBillingMonth: string;
  recordCount: number;
  feeIds: string[];
  statuses: string[];
  risk: string;
}

export interface BackfillPlanSummary {
  totalRecordsInspected: number;
  alreadyCanonicalCount: number;
  safeRecurringBackfillCandidatesCount: number;
  ambiguousRecordsRequiringReviewCount: number;
  nonRecurringRecordsCount: number;
  nonRecurringAdvanceCount: number;
  nonRecurringAdhocCount: number;
  nonRecurringRegistrationCount: number;
  duplicateConflictsCount: number;
  duplicateConflictGroupsCount: number;
  invalidBillingMonthCount: number;
  recordsExcludedFromBackfillCount: number;
  finalUniqueIndexReadiness: {
    isSafeToCreate: boolean;
    simulatedTargetRecords: number;
    readyRecordsCountAfterBackfill: number;
    unreadyRecordsCountAfterBackfill: number;
    duplicateGroupViolationsCount: number;
    blockingIssues: string[];
  };
}

export interface BackfillPlan {
  planId: string;
  generatedAt: string;
  executionMode: "PROPOSAL_ONLY_ZERO_MUTATION";
  summary: BackfillPlanSummary;
  proposedChanges: ProposedBackfillChange[];
  excludedRecords: ExcludedBackfillRecord[];
  duplicateConflictGroups: BackfillDuplicateConflictGroup[];
  ambiguousRecords: ExcludedBackfillRecord[];
}

/**
 * Validates whether a string is strictly a canonical YYYY-MM format
 * within TuitionDesk's operational year range (2020-2035).
 */
export function isStrictCanonicalBillingMonth(val?: string): boolean {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  return isValidOperationalYear(year) && isValidMonthNumber(month);
}

/**
 * Shared helper for invalid billingMonth detection across passes and summaries.
 * Correctly classifies empty strings, whitespace-only strings, malformed months,
 * and out-of-range years.
 */
export function isInvalidBillingMonthRecord(record: RawFeeRecord): { isInvalid: boolean; reason?: string } {
  // 1. Check fee.billingMonth if defined
  if (record.billingMonth !== undefined && record.billingMonth !== null) {
    const raw = typeof record.billingMonth === "string" ? record.billingMonth.trim() : "";
    if (raw === "") {
      return {
        isInvalid: true,
        reason: "Record contains empty or whitespace-only billingMonth",
      };
    }
    const match = raw.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return {
        isInvalid: true,
        reason: `billingMonth "${raw}" does not match canonical YYYY-MM format`,
      };
    }
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    if (!isValidOperationalYear(year)) {
      return {
        isInvalid: true,
        reason: `billingMonth "${raw}" specifies year ${year} outside operational range (2020-2035)`,
      };
    }
    if (!isValidMonthNumber(month)) {
      return {
        isInvalid: true,
        reason: `billingMonth "${raw}" specifies invalid month ${month} (must be 01-12)`,
      };
    }
  }

  // 2. Check fee.month label if 4-digit year is explicitly specified
  if (record.month && typeof record.month === "string") {
    const trimmedMonth = record.month.trim();
    if (trimmedMonth !== "") {
      const yearMatch = trimmedMonth.match(/\b(\d{4})\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        if (!isValidOperationalYear(year)) {
          return {
            isInvalid: true,
            reason: `Month label "${trimmedMonth}" specifies year ${year} outside operational range (2020-2035)`,
          };
        }
      }
    }
  }

  return { isInvalid: false };
}

/**
 * Diagnostic helper for validating centerId and studentId identifiers.
 */
export function validateRecordIdentifiers(
  centerId: string,
  studentId: string
): { valid: boolean; reason?: string } {
  if (!centerId || !centerId.trim()) {
    return { valid: false, reason: "Record missing centerId (empty or whitespace-only)" };
  }
  if (centerId === "unknown_center") {
    return { valid: false, reason: "Record contains unassigned centerId placeholder ('unknown_center')" };
  }
  if (!studentId || !studentId.trim()) {
    return { valid: false, reason: "Record missing studentId (empty or whitespace-only)" };
  }
  if (studentId === "unknown_student") {
    return { valid: false, reason: "Record contains unassigned studentId placeholder ('unknown_student')" };
  }
  return { valid: true };
}

/**
 * Collision-safe identity serialization using JSON tuple serialization.
 * Fully immune to delimiter collision regardless of what characters are in IDs.
 */
export function serializeRecurringIdentityKey(
  centerId: string,
  studentId: string,
  canonicalMonth: string
): string {
  return JSON.stringify([centerId, studentId, canonicalMonth]);
}

export function deserializeRecurringIdentityKey(
  key: string
): [string, string, string] {
  return JSON.parse(key) as [string, string, string];
}

/**
 * Extracts a normalized student ID string from RawFeeRecord without mutating input.
 */
function extractStudentId(studentId: RawFeeRecord["studentId"]): string {
  if (typeof studentId === "object" && studentId !== null) {
    return String(studentId._id || "");
  }
  return String(studentId || "");
}

/**
 * Analyzes a dataset of fee records and generates a deterministic, zero-mutation
 * proposed backfill plan.
 *
 * Guarantees:
 * - Does not modify any input record object.
 * - Only proposes backfill for records with unambiguous recurring evidence.
 * - Blocks backfill if multiple recurring candidate records exist for the same student and month.
 * - Never overwrites an existing valid canonical billingMonth.
 * - Preserves existing explicit non-recurring fee types.
 */
export function generateBackfillPlan(records: readonly RawFeeRecord[]): BackfillPlan {
  const proposedChanges: ProposedBackfillChange[] = [];
  const excludedRecords: ExcludedBackfillRecord[] = [];
  const ambiguousRecords: ExcludedBackfillRecord[] = [];

  let alreadyCanonicalCount = 0;
  let nonRecurringAdvanceCount = 0;
  let nonRecurringAdhocCount = 0;
  let nonRecurringRegistrationCount = 0;
  let invalidBillingMonthCount = 0;

  // Pre-pass: map candidate recurring records by collision-safe identity tuple
  // to detect any duplicate recurring groups BEFORE proposing any backfill.
  interface CandidateEntry {
    record: RawFeeRecord;
    centerId: string;
    studentId: string;
    canonicalMonth: string;
    feeId: string;
    status: string;
    hasExplicitCanonical: boolean;
    evidence: string[];
  }

  const recurringCandidatesByIdentity = new Map<string, CandidateEntry[]>();
  const preClassified = new Map<string, { classification: ReturnType<typeof classifyFeeRecord>; mapping: ReturnType<typeof resolveBillingMonth> }>();

  for (const record of records) {
    const feeId = String(record._id || "");
    const centerId = String(record.centerId || "").trim();
    const studentId = extractStudentId(record.studentId).trim();

    const classification = classifyFeeRecord(record);
    const mapping = resolveBillingMonth(record);
    preClassified.set(feeId, { classification, mapping });

    // Track non-recurring categories
    if (classification.category === "CONFIRMED_ADVANCE") {
      nonRecurringAdvanceCount++;
      continue;
    }
    if (classification.category === "CONFIRMED_ADHOC") {
      nonRecurringAdhocCount++;
      continue;
    }
    if (classification.category === "CONFIRMED_REGISTRATION") {
      nonRecurringRegistrationCount++;
      continue;
    }

    // Check invalid billing month using shared helper
    const invalidCheck = isInvalidBillingMonthRecord(record);
    if (invalidCheck.isInvalid) {
      invalidBillingMonthCount++;
      continue;
    }

    // Check for ambiguous label
    if (classification.category === "AMBIGUOUS_LEGACY" || mapping.confidence === "ambiguous") {
      continue;
    }

    // If confirmed recurring and has resolvable canonical month
    if (classification.category === "CONFIRMED_RECURRING" && mapping.canonicalMonth) {
      if (!isStrictCanonicalBillingMonth(mapping.canonicalMonth)) {
        invalidBillingMonthCount++;
        continue;
      }

      const idValidation = validateRecordIdentifiers(centerId, studentId);
      if (!idValidation.valid) {
        continue; // Handled in second pass
      }

      const identityKey = serializeRecurringIdentityKey(centerId, studentId, mapping.canonicalMonth);
      const existing = recurringCandidatesByIdentity.get(identityKey) || [];
      existing.push({
        record,
        centerId,
        studentId,
        canonicalMonth: mapping.canonicalMonth,
        feeId,
        status: record.status || "Unknown",
        hasExplicitCanonical:
          record.feeType === "monthly_recurring" && isStrictCanonicalBillingMonth(record.billingMonth),
        evidence: classification.evidence,
      });
      recurringCandidatesByIdentity.set(identityKey, existing);
    }
  }

  // Identify duplicate conflict groups
  const duplicateConflictGroups: BackfillDuplicateConflictGroup[] = [];
  const conflictingFeeIds = new Set<string>();

  for (const [identityKey, group] of recurringCandidatesByIdentity.entries()) {
    if (group.length > 1) {
      const feeIds = group.map((g) => g.feeId);
      feeIds.forEach((id) => conflictingFeeIds.add(id));
      duplicateConflictGroups.push({
        identityKey,
        identityTuple: {
          centerId: group[0].centerId,
          studentId: group[0].studentId,
          canonicalBillingMonth: group[0].canonicalMonth,
        },
        centerId: group[0].centerId,
        studentId: group[0].studentId,
        canonicalBillingMonth: group[0].canonicalMonth,
        recordCount: group.length,
        feeIds,
        statuses: group.map((g) => g.status),
        risk: `Multiple candidate recurring records (${group.length}) detected for cycle. Automated backfill blocked to prevent duplicate key creation.`,
      });
    }
  }

  // Second pass: evaluate each record individually
  for (const record of records) {
    const feeId = String(record._id || "");
    const centerId = String(record.centerId || "").trim();
    const studentId = extractStudentId(record.studentId).trim();
    const { classification, mapping } = preClassified.get(feeId)!;

    // 1. Missing identifiers guard
    const idValidation = validateRecordIdentifiers(centerId, studentId);
    if (!idValidation.valid) {
      excludedRecords.push({
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "MISSING_REQUIRED_IDENTIFIERS",
        explanation: idValidation.reason || "Record missing valid centerId or studentId required for index identity.",
        status: record.status || "Unknown",
      });
      continue;
    }

    // 2. Non-recurring exclusions (must never become recurring)
    if (classification.category === "CONFIRMED_ADVANCE") {
      excludedRecords.push({
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "NON_RECURRING_ADVANCE",
        explanation: "Advance payment record; excluded from recurring monthly fee backfill.",
        status: record.status || "Unknown",
      });
      continue;
    }

    if (classification.category === "CONFIRMED_ADHOC") {
      excludedRecords.push({
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "NON_RECURRING_ADHOC",
        explanation: "Ad-hoc fee record (e.g. lab, uniform, exam); excluded from recurring monthly fee backfill.",
        status: record.status || "Unknown",
      });
      continue;
    }

    if (classification.category === "CONFIRMED_REGISTRATION") {
      excludedRecords.push({
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "NON_RECURRING_REGISTRATION",
        explanation: "Registration/admission fee record; excluded from recurring monthly fee backfill.",
        status: record.status || "Unknown",
      });
      continue;
    }

    // 3. Invalid billing month guard using shared helper
    const invalidCheck = isInvalidBillingMonthRecord(record);
    if (invalidCheck.isInvalid) {
      const item: ExcludedBackfillRecord = {
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "INVALID_BILLING_MONTH",
        explanation: invalidCheck.reason || "Invalid billingMonth format or out-of-range date",
        status: record.status || "Unknown",
      };
      excludedRecords.push(item);
      continue;
    }

    // 4. Ambiguous legacy records (never guessed, center-owner review required)
    if (classification.category === "AMBIGUOUS_LEGACY" || mapping.confidence === "ambiguous") {
      const item: ExcludedBackfillRecord = {
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "AMBIGUOUS_EVIDENCE",
        explanation: classification.reason || "Lacks authoritative recurring evidence; center-owner review required.",
        status: record.status || "Unknown",
      };
      excludedRecords.push(item);
      ambiguousRecords.push(item);
      continue;
    }

    // 5. Duplicate collision conflict guard
    if (conflictingFeeIds.has(feeId)) {
      excludedRecords.push({
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "DUPLICATE_COLLISION_RISK",
        explanation: "Part of a multiple-record recurring duplicate group for this cycle; automated backfill blocked.",
        status: record.status || "Unknown",
      });
      continue;
    }

    // 6. Already canonical check
    const hasCanonicalBillingMonth = isStrictCanonicalBillingMonth(record.billingMonth);
    const hasCanonicalFeeType = record.feeType === "monthly_recurring";

    if (hasCanonicalBillingMonth && hasCanonicalFeeType) {
      alreadyCanonicalCount++;
      excludedRecords.push({
        feeId,
        centerId,
        studentId,
        originalMonth: record.month,
        originalFeeType: record.feeType,
        reason: "ALREADY_CANONICAL",
        explanation: "Record already has explicit feeType='monthly_recurring' and canonical billingMonth YYYY-MM.",
        status: record.status || "Unknown",
      });
      continue;
    }

    // 7. Safe Recurring Backfill Candidate
    if (classification.category === "CONFIRMED_RECURRING" && mapping.canonicalMonth) {
      if (!isStrictCanonicalBillingMonth(mapping.canonicalMonth)) {
        excludedRecords.push({
          feeId,
          centerId,
          studentId,
          originalMonth: record.month,
          originalFeeType: record.feeType,
          reason: "INVALID_BILLING_MONTH",
          explanation: `Resolved billingMonth '${mapping.canonicalMonth}' is not within valid operational range (2020-2035).`,
          status: record.status || "Unknown",
        });
        continue;
      }

      // Safety rule: Never overwrite an existing valid canonical billingMonth
      const finalBillingMonth = hasCanonicalBillingMonth
        ? record.billingMonth!.trim()
        : mapping.canonicalMonth;

      proposedChanges.push({
        feeId,
        centerId,
        studentId,
        currentValues: {
          feeType: record.feeType,
          billingMonth: record.billingMonth,
          month: record.month,
          title: record.title,
          isAdvance: record.isAdvance,
          status: record.status || "Unknown",
        },
        proposedUpdates: {
          feeType: "monthly_recurring",
          billingMonth: finalBillingMonth,
        },
        reason: !hasCanonicalBillingMonth && !hasCanonicalFeeType
          ? `Backfill canonical billingMonth (${finalBillingMonth}) and feeType ('monthly_recurring') based on unambiguous month label '${record.month}'`
          : !hasCanonicalBillingMonth
          ? `Backfill canonical billingMonth (${finalBillingMonth}) based on month label '${record.month}'`
          : "Backfill explicit feeType ('monthly_recurring') to match canonical billingMonth",
        evidence: classification.evidence,
      });
    }
  }

  // Summary Metrics
  const nonRecurringRecordsCount =
    nonRecurringAdvanceCount + nonRecurringAdhocCount + nonRecurringRegistrationCount;

  const duplicateConflictsCount = conflictingFeeIds.size;
  const duplicateConflictGroupsCount = duplicateConflictGroups.length;

  const totalExcludedCount = excludedRecords.length;
  const safeRecurringBackfillCandidatesCount = proposedChanges.length;

  // Post-Backfill Simulated Unique Index Readiness
  const simulatedTargetRecords = alreadyCanonicalCount + safeRecurringBackfillCandidatesCount;
  const readyRecordsCountAfterBackfill = alreadyCanonicalCount + safeRecurringBackfillCandidatesCount;
  const unreadyRecordsCountAfterBackfill = ambiguousRecords.length + duplicateConflictsCount;

  const missingIdCount = excludedRecords.filter((r) => r.reason === "MISSING_REQUIRED_IDENTIFIERS").length;

  const blockingIssues: string[] = [];
  if (duplicateConflictGroupsCount > 0) {
    blockingIssues.push(
      `${duplicateConflictGroupsCount} duplicate recurring group(s) involving ${duplicateConflictsCount} records exist and must be resolved before index creation.`
    );
  }
  if (ambiguousRecords.length > 0) {
    blockingIssues.push(
      `${ambiguousRecords.length} ambiguous legacy record(s) lack authoritative evidence and require center-owner manual review.`
    );
  }
  if (invalidBillingMonthCount > 0) {
    blockingIssues.push(
      `${invalidBillingMonthCount} record(s) contain invalid billing month formats or out-of-range dates.`
    );
  }
  if (missingIdCount > 0) {
    blockingIssues.push(
      `${missingIdCount} record(s) lack required centerId or studentId identifiers.`
    );
  }

  const isSafeToCreate =
    duplicateConflictGroupsCount === 0 &&
    ambiguousRecords.length === 0 &&
    invalidBillingMonthCount === 0 &&
    missingIdCount === 0 &&
    unreadyRecordsCountAfterBackfill === 0;

  const summary: BackfillPlanSummary = {
    totalRecordsInspected: records.length,
    alreadyCanonicalCount,
    safeRecurringBackfillCandidatesCount,
    ambiguousRecordsRequiringReviewCount: ambiguousRecords.length,
    nonRecurringRecordsCount,
    nonRecurringAdvanceCount,
    nonRecurringAdhocCount,
    nonRecurringRegistrationCount,
    duplicateConflictsCount,
    duplicateConflictGroupsCount,
    invalidBillingMonthCount,
    recordsExcludedFromBackfillCount: totalExcludedCount,
    finalUniqueIndexReadiness: {
      isSafeToCreate,
      simulatedTargetRecords,
      readyRecordsCountAfterBackfill,
      unreadyRecordsCountAfterBackfill,
      duplicateGroupViolationsCount: duplicateConflictGroupsCount,
      blockingIssues,
    },
  };

  return {
    planId: `BACKFILL_PLAN_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    executionMode: "PROPOSAL_ONLY_ZERO_MUTATION",
    summary,
    proposedChanges,
    excludedRecords,
    duplicateConflictGroups,
    ambiguousRecords,
  };
}

/**
 * Formats a BackfillPlan into a structured, human-readable dry-run report.
 * Guaranteed zero PII exposure with masked identifiers.
 */
export function formatBackfillDryRunReport(plan: BackfillPlan): string {
  const { summary } = plan;
  const lines: string[] = [];

  lines.push("=======================================================");
  lines.push(" TuitionDesk Phase 2H: Safe Legacy Fee Backfill Plan");
  lines.push(" MODE: STRICT DRY-RUN / PROPOSAL ONLY (ZERO MUTATIONS)");
  lines.push("=======================================================");
  lines.push(`Plan ID:              ${plan.planId}`);
  lines.push(`Generated At:         ${plan.generatedAt}`);
  lines.push(`Total Records:        ${summary.totalRecordsInspected}`);
  lines.push("");

  lines.push("-------------------------------------------------------");
  lines.push(" BACKFILL CLASSIFICATION BREAKDOWN");
  lines.push("-------------------------------------------------------");
  lines.push(`- Already Canonical:             ${summary.alreadyCanonicalCount}`);
  lines.push(`- Safe Recurring Candidates:     ${summary.safeRecurringBackfillCandidatesCount}`);
  lines.push(`- Ambiguous Requiring Review:    ${summary.ambiguousRecordsRequiringReviewCount}`);
  lines.push(`- Non-Recurring Records:         ${summary.nonRecurringRecordsCount}`);
  lines.push(`    * Advance Fees:              ${summary.nonRecurringAdvanceCount}`);
  lines.push(`    * Ad-hoc Fees:               ${summary.nonRecurringAdhocCount}`);
  lines.push(`    * Registration Fees:         ${summary.nonRecurringRegistrationCount}`);
  lines.push(`- Duplicate Conflicts (Blocked): ${summary.duplicateConflictsCount} records (${summary.duplicateConflictGroupsCount} groups)`);
  lines.push(`- Invalid Billing Month Records: ${summary.invalidBillingMonthCount}`);
  lines.push(`- Records Excluded from Backfill:${summary.recordsExcludedFromBackfillCount}`);
  lines.push("");

  lines.push("-------------------------------------------------------");
  lines.push(" FINAL UNIQUE INDEX READINESS AFTER BACKFILL");
  lines.push("-------------------------------------------------------");
  lines.push(`Projected Target Records:        ${summary.finalUniqueIndexReadiness.simulatedTargetRecords}`);
  lines.push(`Projected Index-Ready Records:   ${summary.finalUniqueIndexReadiness.readyRecordsCountAfterBackfill}`);
  lines.push(`Projected Unready / Blocked:     ${summary.finalUniqueIndexReadiness.unreadyRecordsCountAfterBackfill}`);
  lines.push(`Duplicate Group Violations:      ${summary.finalUniqueIndexReadiness.duplicateGroupViolationsCount}`);
  lines.push(`Safe to Create Unique Index:     ${summary.finalUniqueIndexReadiness.isSafeToCreate ? "YES (SAFE TO CREATE)" : "NO (BLOCKED)"}`);

  if (summary.finalUniqueIndexReadiness.blockingIssues.length > 0) {
    lines.push("\nBlocking Issues:");
    summary.finalUniqueIndexReadiness.blockingIssues.forEach((issue, idx) => {
      lines.push(`  ${idx + 1}. ${issue}`);
    });
  }

  if (plan.proposedChanges.length > 0) {
    lines.push("\n-------------------------------------------------------");
    lines.push(" PROPOSED BACKFILL SAMPLES (FIRST 5 EXAMPLES)");
    lines.push("-------------------------------------------------------");
    plan.proposedChanges.slice(0, 5).forEach((item, idx) => {
      lines.push(`\nCandidate #${idx + 1}: Fee ID: ${maskIdentifier(item.feeId)}`);
      lines.push(`  Center: ${maskIdentifier(item.centerId)} | Student: ${maskIdentifier(item.studentId)}`);
      lines.push(`  Current:  feeType="${item.currentValues.feeType || 'undefined'}", billingMonth="${item.currentValues.billingMonth || 'undefined'}", month="${item.currentValues.month || ''}"`);
      lines.push(`  Proposed: feeType="${item.proposedUpdates.feeType}", billingMonth="${item.proposedUpdates.billingMonth}"`);
      lines.push(`  Reason:   ${item.reason}`);
    });
  }

  if (plan.duplicateConflictGroups.length > 0) {
    lines.push("\n-------------------------------------------------------");
    lines.push(" DUPLICATE CONFLICT GROUPS (FIRST 5 EXAMPLES)");
    lines.push("-------------------------------------------------------");
    plan.duplicateConflictGroups.slice(0, 5).forEach((group, idx) => {
      lines.push(`\nConflict Group #${idx + 1} [${group.canonicalBillingMonth}]:`);
      lines.push(`  Center: ${maskIdentifier(group.centerId)} | Student: ${maskIdentifier(group.studentId)}`);
      lines.push(`  Records Involved (${group.recordCount}): ${group.feeIds.map(maskIdentifier).join(", ")}`);
      lines.push(`  Statuses: ${group.statuses.join(", ")}`);
      lines.push(`  Risk: ${group.risk}`);
    });
  }

  if (plan.ambiguousRecords.length > 0) {
    lines.push("\n-------------------------------------------------------");
    lines.push(" AMBIGUOUS RECORDS REQUIRING MANUAL REVIEW (FIRST 5)");
    lines.push("-------------------------------------------------------");
    plan.ambiguousRecords.slice(0, 5).forEach((rec, idx) => {
      lines.push(`  ${idx + 1}. Fee ID: ${maskIdentifier(rec.feeId)} | Month: "${rec.originalMonth || ''}" | Reason: ${rec.explanation}`);
    });
  }

  lines.push("\n=======================================================");
  lines.push(" ZERO DATABASE WRITES OR INDEX OPERATIONS EXECUTED.");
  lines.push(" ALL HISTORICAL DATA REMAINS UNCHANGED.");
  lines.push("=======================================================\n");

  return lines.join("\n");
}
