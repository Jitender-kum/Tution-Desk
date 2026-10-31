/**
 * TuitionDesk Phase 2B.1 — Read-Only Legacy Fee Reconciliation Engine
 *
 * Provides deterministic, zero-mutation analysis and canonicalization
 * mapping for historical monthly fee records prior to Phase 2B index creation.
 *
 * SAFETY GUARANTEES:
 * 1. Strictly read-only: Contains NO write, update, delete, or index operations.
 * 2. Deterministic: Pure evaluation without database mutations or side effects.
 * 3. Privacy-preserving: Masks parent phone numbers, names, and transaction identifiers.
 * 4. Fails safe: Ambiguous records are marked for manual review, never guessed.
 */

export interface RawFeeRecord {
  _id: string;
  centerId: string;
  studentId: string | { _id: string; name?: string; parentWhatsApp?: string };
  month?: string;
  billingMonth?: string;
  feeType?: string;
  title?: string;
  status: string;
  isAdvance?: boolean;
  amountDue?: number;
  paidAmount?: number;
  dueDate?: Date | string;
  paidDate?: Date | string;
  utrNumber?: string;
  paymentMode?: string;
  receiptNumber?: string;
  createdAt?: Date | string;
}

export type MonthMappingConfidence =
  | "canonical"     // Already has valid YYYY-MM
  | "high"          // Unambiguously mapped from standard month + year string
  | "low"           // Inferred with lower certainty
  | "ambiguous"     // Cannot determine billing cycle with certainty; requires review
  | "ineligible";   // Explicitly non-recurring (advance, adhoc, registration)

export interface MonthMappingResult {
  canonicalMonth: string | null;
  confidence: MonthMappingConfidence;
  source: "billingMonth" | "month_label" | "ineligible" | "ambiguous";
  reason?: string;
}

export type FeeConflictType =
  | "NONE"
  | "DUPLICATE_PAID_AND_PENDING"
  | "DUPLICATE_MULTIPLE_PAID"
  | "DUPLICATE_MULTIPLE_PENDING"
  | "CONFLICT_VERIFICATION_PENDING"
  | "CONFLICT_PARTIAL_PAID"
  | "AMBIGUOUS_LABEL";

export type FeeClassificationCategory =
  | "CONFIRMED_RECURRING"
  | "CONFIRMED_ADVANCE"
  | "CONFIRMED_ADHOC"
  | "CONFIRMED_REGISTRATION"
  | "AMBIGUOUS_LEGACY";

export interface FeeClassificationResult {
  category: FeeClassificationCategory;
  reason: string;
  inferredFeeType: "monthly_recurring" | "advance" | "adhoc" | "registration" | null;
  evidence: string[];
}

export interface IndexReadinessSummary {
  isSafeToCreate: boolean;
  totalTargetRecords: number;
  readyRecordsCount: number;
  unreadyRecordsCount: number;
  missingExplicitFeeTypeCount: number;
  missingCanonicalBillingMonthCount: number;
  duplicateGroupViolationsCount: number;
  blockingIssues: string[];
}

export interface ReconciledFeeItem {
  feeId: string;
  centerId: string;
  studentId: string;
  originalMonth: string;
  originalFeeType?: string;
  classificationCategory?: FeeClassificationCategory;
  inferredFeeType?: "monthly_recurring" | "advance" | "adhoc" | "registration" | null;
  resolvedBillingMonth: string | null;
  confidence: MonthMappingConfidence;
  status: string;
  amountDue: number;
  conflictType: FeeConflictType;
  requiresManualReview: boolean;
  notes: string[];
}

export interface ReconciledGroup {
  groupKey: string; // centerId:studentId:canonicalMonth:feeType
  centerId: string;
  studentId: string;
  canonicalMonth: string;
  feeType?: string;
  records: ReconciledFeeItem[];
  conflictType: FeeConflictType;
  requiresManualReview: boolean;
  recommendedAction: string;
}

export interface ReconciliationReport {
  summary: {
    totalRecordsAudited: number;
    confirmedRecurringCount: number;
    confirmedNonRecurringCount: number;
    confirmedAdvanceCount: number;
    confirmedAdhocCount: number;
    confirmedRegistrationCount: number;
    ambiguousLegacyCount: number;
    alreadyCanonicalCount: number;
    resolvableLegacyCount: number;
    nonRecurringCount: number;
    ambiguousCount: number;
    missingFeeTypeCount: number;
    cleanSingleRecordsCount: number;
    duplicateGroupsCount: number;
    totalDuplicateRecordsCount: number;
    invalidBillingMonthCount: number;
    recordsEligibleForBackfill: number;
    recordsRequiringManualReview: number;
    requiresManualReviewCount: number; // Backwards compatibility alias
    conflictBreakdown: Record<FeeConflictType, number>;
    indexReadiness: IndexReadinessSummary;
  };
  ambiguousRecords: ReconciledFeeItem[];
  duplicateGroups: ReconciledGroup[];
  ineligibleNonRecurring: ReconciledFeeItem[];
  executionMode: "READ_ONLY_DRY_RUN";
  generatedAt: string;
}

// English month name to 2-digit number lookup
const MONTH_NAME_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

/**
 * PII Masking Utilities
 */
export function maskName(name?: string): string {
  if (!name || !name.trim()) return "Unknown";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 3) + "***";
  }
  return `${parts[0]} ${parts[parts.length - 1].slice(0, 1)}.`;
}

export function maskPhone(phone?: string): string {
  if (!phone || !phone.trim()) return "N/A";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 4) return "***";
  return `***${cleaned.slice(-4)}`;
}

export function maskIdentifier(id?: string): string {
  if (!id || !id.trim()) return "N/A";
  const str = id.trim();
  if (str.length <= 8) return str;
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

/**
 * Database Target & URI Sanitization Utilities
 */
export function parseMongoDatabaseName(uri: string): string | null {
  if (!uri || typeof uri !== "string") return null;
  const trimmed = uri.trim();
  try {
    // Replace scheme with http: to safely parse with URL API
    const httpEquiv = trimmed.replace(/^mongodb(\+srv)?:\/\//i, "http://");
    const parsed = new URL(httpEquiv);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    if (!pathname) return null;
    const dbName = pathname.split("/")[0].split("?")[0].trim();
    return dbName.length > 0 ? dbName : null;
  } catch {
    // Regex fallback
    const match = trimmed.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?/\s]+)/i);
    return match ? match[1].trim() : null;
  }
}

export function sanitizeMongoUri(uri?: string): string {
  if (!uri || typeof uri !== "string") return "";
  let sanitized = uri;
  // If user:pass@ is present, replace both with ***:***@. If only user@ is present, replace with ***@.
  if (/(mongodb(?:\+srv)?:\/\/)[^:@\s]+:[^@\s]+@/i.test(sanitized)) {
    sanitized = sanitized.replace(/(mongodb(?:\+srv)?:\/\/)[^:@\s]+:[^@\s]+@/gi, "$1***:***@");
  } else {
    sanitized = sanitized.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s]+@/gi, "$1***@");
  }
  // Mask Atlas cluster hostnames
  sanitized = sanitized.replace(/[a-zA-Z0-9_\-]+\.mongodb\.net/gi, "[REDACTED_CLUSTER_HOST]");
  return sanitized;
}

export interface DatabaseTargetValidationOptions {
  auditUri?: string;
  primaryUri?: string;
  expectedDbName?: string;
  allowPrimaryDb?: boolean;
}

export interface DatabaseTargetValidationResult {
  valid: boolean;
  databaseName?: string;
  sanitizedUri?: string;
  error?: string;
}

export function validateDatabaseTarget(
  options: DatabaseTargetValidationOptions
): DatabaseTargetValidationResult {
  const { auditUri, primaryUri, expectedDbName, allowPrimaryDb } = options;

  if (!auditUri || !auditUri.trim()) {
    return {
      valid: false,
      error:
        "Execution safety guard: Missing MONGODB_AUDIT_URI. You must specify an explicit audit database URI.",
    };
  }

  const trimmedAudit = auditUri.trim();
  const sanitized = sanitizeMongoUri(trimmedAudit);

  // Target collision check: Cannot point to primary application database unless explicitly overridden
  if (primaryUri && trimmedAudit === primaryUri.trim() && !allowPrimaryDb) {
    return {
      valid: false,
      sanitizedUri: sanitized,
      error:
        "Execution safety guard: Target collision detected. MONGODB_AUDIT_URI matches the application's primary MONGODB_URI. Running reconciliation audit against the live application database is strictly prohibited without explicit override (--allow-primary-db).",
    };
  }

  const dbName = parseMongoDatabaseName(trimmedAudit);
  if (!dbName) {
    return {
      valid: false,
      sanitizedUri: sanitized,
      error:
        "Execution safety guard: Database name could not be determined from MONGODB_AUDIT_URI. An explicit database path (e.g. /<dbname>) is required.",
    };
  }

  if (expectedDbName && expectedDbName.trim()) {
    const expected = expectedDbName.trim();
    if (dbName !== expected) {
      return {
        valid: false,
        databaseName: dbName,
        sanitizedUri: sanitized,
        error: `Execution safety guard: Database target mismatch. Expected database "${expected}", but connection URI specifies "${dbName}".`,
      };
    }
  }

  return {
    valid: true,
    databaseName: dbName,
    sanitizedUri: sanitized,
  };
}

/**
 * Validates whether a numerical year falls within TuitionDesk's reasonable operational range (2020-2035).
 */
export function isValidOperationalYear(year: number): boolean {
  return !isNaN(year) && year >= 2020 && year <= 2035;
}

/**
 * Validates whether a 1-12 month number is valid.
 */
export function isValidMonthNumber(month: number): boolean {
  return !isNaN(month) && month >= 1 && month <= 12;
}

/**
 * Normalizes and extracts valid calendar month and operational year from arbitrary labels.
 * Returns null if the label is unparseable, out-of-range, or ambiguous.
 */
export function parseMonthAndYearFromLabel(
  rawMonth?: string
): { year: number; month: number; canonicalMonth: string } | null {
  if (!rawMonth || typeof rawMonth !== "string") return null;
  const trimmed = rawMonth.trim();
  if (!trimmed) return null;

  // 1. "YYYY-MM" format
  const yyyyMmMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (yyyyMmMatch) {
    const year = parseInt(yyyyMmMatch[1], 10);
    const month = parseInt(yyyyMmMatch[2], 10);
    if (isValidOperationalYear(year) && isValidMonthNumber(month)) {
      return { year, month, canonicalMonth: `${year}-${String(month).padStart(2, "0")}` };
    }
  }

  // 2. "YYYY-MM-DD" format
  const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoDateMatch) {
    const year = parseInt(isoDateMatch[1], 10);
    const month = parseInt(isoDateMatch[2], 10);
    if (isValidOperationalYear(year) && isValidMonthNumber(month)) {
      return { year, month, canonicalMonth: `${year}-${String(month).padStart(2, "0")}` };
    }
  }

  // 3. "DD Month YYYY" or "DD-Month-YYYY" (e.g. "15 Oct 2026", "05-October-2026")
  const dayMonthYearMatch = trimmed.match(/^(\d{1,2})[,\s\-_]+([A-Za-z]+)[,\s\-_]+(\d{4})$/);
  if (dayMonthYearMatch) {
    const monthKey = dayMonthYearMatch[2].toLowerCase();
    const year = parseInt(dayMonthYearMatch[3], 10);
    const monthNum = MONTH_NAME_MAP[monthKey];
    if (monthNum && isValidOperationalYear(year)) {
      const month = parseInt(monthNum, 10);
      return { year, month, canonicalMonth: `${year}-${monthNum}` };
    }
  }

  // 4. "Month Year" (e.g. "October 2026", "Oct 2026", "Oct-2026", "October, 2026")
  const monthYearMatch = trimmed.match(/^([A-Za-z]+)[,\s\-_]+(\d{4})$/);
  if (monthYearMatch) {
    const monthKey = monthYearMatch[1].toLowerCase();
    const year = parseInt(monthYearMatch[2], 10);
    const monthNum = MONTH_NAME_MAP[monthKey];
    if (monthNum && isValidOperationalYear(year)) {
      const month = parseInt(monthNum, 10);
      return { year, month, canonicalMonth: `${year}-${monthNum}` };
    }
  }

  // 5. "Year Month" (e.g. "2026 October", "2026-Oct")
  const yearMonthMatch = trimmed.match(/^(\d{4})[,\s\-_]+([A-Za-z]+)$/);
  if (yearMonthMatch) {
    const year = parseInt(yearMonthMatch[1], 10);
    const monthKey = yearMonthMatch[2].toLowerCase();
    const monthNum = MONTH_NAME_MAP[monthKey];
    if (monthNum && isValidOperationalYear(year)) {
      const month = parseInt(monthNum, 10);
      return { year, month, canonicalMonth: `${year}-${monthNum}` };
    }
  }

  // 6. "Month YY" (e.g. "Oct 26", "Oct-26", "October '26")
  const monthTwoDigitYearMatch = trimmed.match(/^([A-Za-z]+)[,\s\-']+(\d{2})$/);
  if (monthTwoDigitYearMatch) {
    const monthKey = monthTwoDigitYearMatch[1].toLowerCase();
    const shortYear = parseInt(monthTwoDigitYearMatch[2], 10);
    const monthNum = MONTH_NAME_MAP[monthKey];
    if (monthNum) {
      const fullYear = 2000 + shortYear;
      if (isValidOperationalYear(fullYear)) {
        const month = parseInt(monthNum, 10);
        return { year: fullYear, month, canonicalMonth: `${fullYear}-${monthNum}` };
      }
    }
  }

  return null;
}

/**
 * Explicitly classifies a fee record into one of five deterministic categories:
 * - CONFIRMED_RECURRING
 * - CONFIRMED_ADVANCE
 * - CONFIRMED_ADHOC
 * - CONFIRMED_REGISTRATION
 * - AMBIGUOUS_LEGACY
 *
 * Implements strict, conservative classification:
 * 1. Existing valid feeType takes absolute precedence.
 * 2. isAdvance === true is never classified as recurring.
 * 3. Does NOT assume missing feeType means recurring.
 * 4. Recognizes non-recurring metadata (advance, registration, adhoc).
 * 5. Requires clear recurring evidence (canonical billingMonth, tuition keywords, or valid monthly billing label).
 * 6. Insufficient or unresolvable evidence safely defaults to AMBIGUOUS_LEGACY.
 */
export const ADVANCE_PATTERNS = [
  /\badvance\s+(?:fee|payment|dues?|deposit)\b/i,
  /^(advance(?:\s+fee)?(?:\s+payment)?)$/i,
  /^advance$/i,
];

export const REGISTRATION_PATTERNS = [
  /\b(?:registration|admission)\s+(?:fee|charge|dues?)\b/i,
  /^(?:registration|admission)(?:\s+fee)?$/i,
];

export const ADHOC_PATTERNS = [
  /\b(?:annual\s+)?lab\s+fee\b/i,
  /\b(?:annual\s+)?exam\s+fee\b/i,
  /\bstudy\s+material(?:\s+fee)?\b/i,
  /\buniform(?:\s+fee)?\b/i,
  /^(lab fee|exam fee|study material|uniform)$/i,
];

export function classifyFeeRecord(fee: RawFeeRecord): FeeClassificationResult {
  const evidence: string[] = [];
  const title = (fee.title || "").trim();
  const month = (fee.month || "").trim();

  const hasAdvanceKeyword = ADVANCE_PATTERNS.some((p) => p.test(title) || p.test(month));
  const hasAdvanceMetadata = fee.isAdvance === true || hasAdvanceKeyword;
  const hasRegistrationMetadata = REGISTRATION_PATTERNS.some((p) => p.test(title) || p.test(month));
  const hasAdhocMetadata = ADHOC_PATTERNS.some((p) => p.test(title));

  // 1. Authoritative explicit feeType checks with metadata contradiction guard
  if (fee.feeType === "monthly_recurring") {
    const contradictions: string[] = [];
    if (fee.isAdvance === true) contradictions.push("isAdvance=true");
    if (hasAdvanceKeyword) contradictions.push(`advance keyword in title/month ("${title || month}")`);
    if (hasRegistrationMetadata) contradictions.push(`registration keyword in title/month ("${title || month}")`);
    if (hasAdhocMetadata) contradictions.push(`ad-hoc keyword in title ("${title}")`);

    if (contradictions.length > 0) {
      evidence.push(`Explicit feeType='monthly_recurring' contradicts non-recurring metadata: ${contradictions.join("; ")}`);
      return {
        category: "AMBIGUOUS_LEGACY",
        reason: `Conflicting metadata: explicit feeType='monthly_recurring' contradicts non-recurring metadata (${contradictions.join("; ")})`,
        inferredFeeType: null,
        evidence,
      };
    }

    evidence.push("Explicit feeType is 'monthly_recurring'");
    return {
      category: "CONFIRMED_RECURRING",
      reason: "Explicit feeType: monthly_recurring",
      inferredFeeType: "monthly_recurring",
      evidence,
    };
  }

  if (fee.feeType === "advance") {
    if (fee.isAdvance === false) {
      evidence.push("Explicit feeType='advance' contradicts isAdvance=false");
      return {
        category: "AMBIGUOUS_LEGACY",
        reason: "Conflicting metadata: explicit feeType='advance' contradicts isAdvance=false",
        inferredFeeType: null,
        evidence,
      };
    }
    if (hasRegistrationMetadata || hasAdhocMetadata) {
      evidence.push("Explicit feeType='advance' contradicts registration/adhoc keywords");
      return {
        category: "AMBIGUOUS_LEGACY",
        reason: "Conflicting metadata: explicit feeType='advance' contradicts registration/adhoc metadata",
        inferredFeeType: null,
        evidence,
      };
    }
    evidence.push("Explicit feeType is 'advance'");
    return {
      category: "CONFIRMED_ADVANCE",
      reason: "Explicit feeType: advance",
      inferredFeeType: "advance",
      evidence,
    };
  }

  if (fee.feeType === "adhoc") {
    if (hasAdvanceMetadata || hasRegistrationMetadata) {
      evidence.push("Explicit feeType='adhoc' contradicts advance/registration metadata");
      return {
        category: "AMBIGUOUS_LEGACY",
        reason: "Conflicting metadata: explicit feeType='adhoc' contradicts advance/registration metadata",
        inferredFeeType: null,
        evidence,
      };
    }
    evidence.push("Explicit feeType is 'adhoc'");
    return {
      category: "CONFIRMED_ADHOC",
      reason: "Explicit feeType: adhoc",
      inferredFeeType: "adhoc",
      evidence,
    };
  }

  if (fee.feeType === "registration") {
    if (hasAdvanceMetadata || hasAdhocMetadata) {
      evidence.push("Explicit feeType='registration' contradicts advance/adhoc metadata");
      return {
        category: "AMBIGUOUS_LEGACY",
        reason: "Conflicting metadata: explicit feeType='registration' contradicts advance/adhoc metadata",
        inferredFeeType: null,
        evidence,
      };
    }
    evidence.push("Explicit feeType is 'registration'");
    return {
      category: "CONFIRMED_REGISTRATION",
      reason: "Explicit feeType: registration",
      inferredFeeType: "registration",
      evidence,
    };
  }

  // 2. Explicit isAdvance boolean flag (must NOT be recurring)
  if (fee.isAdvance === true) {
    evidence.push("Document has isAdvance: true");
    return {
      category: "CONFIRMED_ADVANCE",
      reason: "Explicit isAdvance flag is true",
      inferredFeeType: "advance",
      evidence,
    };
  }

  // 3. Advance fee pattern matching
  if (hasAdvanceKeyword) {
    evidence.push(`Advance keyword matched in title ("${title}") or month ("${month}")`);
    return {
      category: "CONFIRMED_ADVANCE",
      reason: "Non-recurring advance fee metadata detected",
      inferredFeeType: "advance",
      evidence,
    };
  }

  // 4. Registration / Admission pattern matching
  if (hasRegistrationMetadata) {
    evidence.push(`Registration/admission keyword matched in title ("${title}") or month ("${month}")`);
    return {
      category: "CONFIRMED_REGISTRATION",
      reason: "Non-recurring registration/admission fee metadata detected",
      inferredFeeType: "registration",
      evidence,
    };
  }

  // 5. Ad-hoc pattern matching
  if (hasAdhocMetadata) {
    evidence.push(`Ad-hoc keyword matched in title ("${title}")`);
    return {
      category: "CONFIRMED_ADHOC",
      reason: "Non-recurring ad-hoc fee metadata detected",
      inferredFeeType: "adhoc",
      evidence,
    };
  }

  // 6. Clear Recurring Evidence
  // Condition 6a: Canonical billingMonth check
  if (fee.billingMonth && /^\d{4}-\d{2}$/.test(fee.billingMonth.trim())) {
    const [yStr, mStr] = fee.billingMonth.trim().split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    if (!isValidOperationalYear(y) || !isValidMonthNumber(m)) {
      evidence.push(`billingMonth '${fee.billingMonth.trim()}' is outside operational range (2020-2035) or has invalid month`);
      return {
        category: "AMBIGUOUS_LEGACY",
        reason: `billingMonth "${fee.billingMonth.trim()}" has year/month outside operational range (2020-2035)`,
        inferredFeeType: null,
        evidence,
      };
    }
    evidence.push(`Canonical billingMonth '${fee.billingMonth.trim()}' is present`);
    return {
      category: "CONFIRMED_RECURRING",
      reason: "Canonical billingMonth present",
      inferredFeeType: "monthly_recurring",
      evidence,
    };
  }

  // Condition 6b: Check if month label has a 4-digit year outside operational range
  const yearMatch = month.match(/\b(\d{4})\b/);
  if (yearMatch) {
    const parsedYear = parseInt(yearMatch[1], 10);
    if (!isValidOperationalYear(parsedYear)) {
      evidence.push(`Year ${parsedYear} is outside operational range (2020-2035)`);
      return {
        category: "AMBIGUOUS_LEGACY",
        reason: `Month label "${month}" has year ${parsedYear} outside operational range (2020-2035)`,
        inferredFeeType: null,
        evidence,
      };
    }
  }

  // Condition 6c: Recognized month label with valid operational year
  const parsed = parseMonthAndYearFromLabel(month);
  if (parsed) {
    evidence.push(`Recognized monthly billing cycle '${parsed.canonicalMonth}' from label "${month}"`);
    return {
      category: "CONFIRMED_RECURRING",
      reason: "Clear monthly recurring cycle recognized in month label",
      inferredFeeType: "monthly_recurring",
      evidence,
    };
  }

  // 7. Insufficient or Ambiguous Evidence -> AMBIGUOUS_LEGACY
  evidence.push(`Cannot determine billing cycle or fee type with certainty from month "${month}" and title "${title}"`);
  return {
    category: "AMBIGUOUS_LEGACY",
    reason: month
      ? `Ambiguous legacy record: month label "${month}" lacks explicit or recognizable month/year combination`
      : "Month label is missing or empty",
    inferredFeeType: null,
    evidence,
  };
}

/**
 * Determines whether a record is an ad-hoc, advance, or non-recurring fee.
 */
export function isNonRecurringFee(fee: RawFeeRecord): boolean {
  const { category } = classifyFeeRecord(fee);
  return (
    category === "CONFIRMED_ADVANCE" ||
    category === "CONFIRMED_ADHOC" ||
    category === "CONFIRMED_REGISTRATION"
  );
}

/**
 * Resolves a canonical YYYY-MM billing month from fee record metadata.
 * Fails safe: Never guesses if the month or year is ambiguous or out of range.
 */
export function resolveBillingMonth(fee: RawFeeRecord): MonthMappingResult {
  const classification = classifyFeeRecord(fee);

  if (
    classification.category === "CONFIRMED_ADVANCE" ||
    classification.category === "CONFIRMED_ADHOC" ||
    classification.category === "CONFIRMED_REGISTRATION"
  ) {
    return {
      canonicalMonth: null,
      confidence: "ineligible",
      source: "ineligible",
      reason: `Identified as non-recurring (${classification.category})`,
    };
  }

  if (classification.category === "AMBIGUOUS_LEGACY") {
    return {
      canonicalMonth: null,
      confidence: "ambiguous",
      source: "ambiguous",
      reason: classification.reason,
    };
  }

  // CONFIRMED_RECURRING
  if (fee.billingMonth && /^\d{4}-\d{2}$/.test(fee.billingMonth.trim())) {
    const [yStr, mStr] = fee.billingMonth.trim().split("-");
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    if (!isValidOperationalYear(year) || !isValidMonthNumber(month)) {
      return {
        canonicalMonth: null,
        confidence: "ambiguous",
        source: "ambiguous",
        reason: `billingMonth "${fee.billingMonth}" has year/month outside operational range (2020-2035)`,
      };
    }
    return {
      canonicalMonth: fee.billingMonth.trim(),
      confidence: "canonical",
      source: "billingMonth",
    };
  }

  const parsed = parseMonthAndYearFromLabel(fee.month);
  if (parsed) {
    return {
      canonicalMonth: parsed.canonicalMonth,
      confidence: "high",
      source: "month_label",
    };
  }

  return {
    canonicalMonth: null,
    confidence: "ambiguous",
    source: "ambiguous",
    reason: classification.reason,
  };
}

/**
 * Audits and reconciles a collection of raw fee records without modifying anything.
 */
export function reconcileFeeDataset(records: RawFeeRecord[]): ReconciliationReport {
  let alreadyCanonicalCount = 0;
  let resolvableLegacyCount = 0;
  let nonRecurringCount = 0;
  let ambiguousCount = 0;
  let missingFeeTypeCount = 0;

  let confirmedRecurringCount = 0;
  let confirmedNonRecurringCount = 0;
  let confirmedAdvanceCount = 0;
  let confirmedAdhocCount = 0;
  let confirmedRegistrationCount = 0;
  let ambiguousLegacyCount = 0;

  const conflictBreakdown: Record<FeeConflictType, number> = {
    NONE: 0,
    DUPLICATE_PAID_AND_PENDING: 0,
    DUPLICATE_MULTIPLE_PAID: 0,
    DUPLICATE_MULTIPLE_PENDING: 0,
    CONFLICT_VERIFICATION_PENDING: 0,
    CONFLICT_PARTIAL_PAID: 0,
    AMBIGUOUS_LABEL: 0,
  };

  const reconciledItems: ReconciledFeeItem[] = [];
  const ambiguousRecords: ReconciledFeeItem[] = [];
  const ineligibleNonRecurring: ReconciledFeeItem[] = [];

  // Group candidate items by centerId:studentId:canonicalMonth:feeType
  const groups = new Map<string, ReconciledFeeItem[]>();

  for (const record of records) {
    const studentIdStr =
      typeof record.studentId === "object" && record.studentId !== null
        ? String(record.studentId._id)
        : String(record.studentId || "unknown_student");

    if (!record.feeType) {
      missingFeeTypeCount++;
    }

    const classification = classifyFeeRecord(record);
    const mapping = resolveBillingMonth(record);
    const notes: string[] = [];

    // Track classification breakdown
    switch (classification.category) {
      case "CONFIRMED_RECURRING":
        confirmedRecurringCount++;
        break;
      case "CONFIRMED_ADVANCE":
        confirmedAdvanceCount++;
        confirmedNonRecurringCount++;
        break;
      case "CONFIRMED_ADHOC":
        confirmedAdhocCount++;
        confirmedNonRecurringCount++;
        break;
      case "CONFIRMED_REGISTRATION":
        confirmedRegistrationCount++;
        confirmedNonRecurringCount++;
        break;
      case "AMBIGUOUS_LEGACY":
        ambiguousLegacyCount++;
        break;
    }

    if (!record.feeType) {
      notes.push("Missing feeType in record schema");
    }

    if (mapping.confidence === "canonical") {
      alreadyCanonicalCount++;
    } else if (mapping.confidence === "high") {
      resolvableLegacyCount++;
      notes.push(`Resolvable from label "${record.month}" -> ${mapping.canonicalMonth}`);
    } else if (mapping.confidence === "ineligible") {
      nonRecurringCount++;
      notes.push(mapping.reason || "Non-recurring fee");
    } else if (mapping.confidence === "ambiguous") {
      ambiguousCount++;
      notes.push(mapping.reason || "Ambiguous billing month");
    }

    const effectiveFeeType =
      record.feeType || classification.inferredFeeType || (classification.category === "CONFIRMED_RECURRING" ? "monthly_recurring" : null);

    const item: ReconciledFeeItem = {
      feeId: String(record._id),
      centerId: String(record.centerId || "unknown_center"),
      studentId: studentIdStr,
      originalMonth: record.month || "",
      originalFeeType: record.feeType,
      classificationCategory: classification.category,
      inferredFeeType: classification.inferredFeeType,
      resolvedBillingMonth: mapping.canonicalMonth,
      confidence: mapping.confidence,
      status: record.status || "Unknown",
      amountDue: Number(record.amountDue) || 0,
      conflictType: "NONE",
      requiresManualReview: classification.category === "AMBIGUOUS_LEGACY" || mapping.confidence === "ambiguous",
      notes,
    };

    reconciledItems.push(item);

    if (
      classification.category === "CONFIRMED_ADVANCE" ||
      classification.category === "CONFIRMED_ADHOC" ||
      classification.category === "CONFIRMED_REGISTRATION" ||
      mapping.confidence === "ineligible"
    ) {
      ineligibleNonRecurring.push(item);
      continue;
    }

    if (classification.category === "AMBIGUOUS_LEGACY" || mapping.confidence === "ambiguous" || !mapping.canonicalMonth) {
      item.conflictType = "AMBIGUOUS_LABEL";
      conflictBreakdown.AMBIGUOUS_LABEL++;
      ambiguousRecords.push(item);
      continue;
    }

    // Requirement 2: Group recurring candidates by centerId + studentId + canonical billingMonth + feeType
    // Only confirmed recurring records enter recurring duplicate groups.
    const key = `${item.centerId}:${item.studentId}:${item.resolvedBillingMonth}:${effectiveFeeType || "monthly_recurring"}`;
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }

  const duplicateGroups: ReconciledGroup[] = [];
  let cleanSingleRecordsCount = 0;
  let totalDuplicateRecordsCount = 0;

  for (const [key, items] of groups.entries()) {
    if (items.length === 1) {
      cleanSingleRecordsCount++;
      conflictBreakdown.NONE++;
      continue;
    }

    // Duplicate detection across the group
    totalDuplicateRecordsCount += items.length;

    const statuses = items.map((i) => i.status);
    const paidCount = statuses.filter((s) => s === "Paid").length;
    const pendingCount = statuses.filter((s) => s === "Pending").length;
    const reviewCount = statuses.filter((s) => s === "Verification Pending").length;
    const partialCount = statuses.filter((s) => s === "Partial Paid").length;

    let groupConflict: FeeConflictType = "NONE";
    let recommendation = "";

    if (reviewCount >= 1) {
      groupConflict = "CONFLICT_VERIFICATION_PENDING";
      recommendation = "Active payment verification pending in group. Settle or reject before canonicalizing cycle.";
    } else if (paidCount > 1) {
      groupConflict = "DUPLICATE_MULTIPLE_PAID";
      recommendation = `CRITICAL: ${paidCount} Paid records exist. Verify official receipts and bank statement before merging/cancelling.`;
    } else if (paidCount === 1 && pendingCount >= 1) {
      groupConflict = "DUPLICATE_PAID_AND_PENDING";
      recommendation = "1 Paid and pending dues exist for same cycle. Candidate for keeping Paid and archiving/cancelling orphaned Pending.";
    } else if (partialCount >= 1) {
      groupConflict = "CONFLICT_PARTIAL_PAID";
      recommendation = `Partial payment record (${partialCount}) exists alongside other records for same cycle. Manual reconciliation with fee ledger required.`;
    } else if (pendingCount > 1) {
      groupConflict = "DUPLICATE_MULTIPLE_PENDING";
      recommendation = `${pendingCount} Pending dues exist. Owner should consolidate or cancel duplicate invoices.`;
    } else {
      groupConflict = "AMBIGUOUS_LABEL";
      recommendation = "Unrecognized status combination in duplicate group. Requires manual audit.";
    }

    conflictBreakdown[groupConflict]++;

    for (const item of items) {
      item.conflictType = groupConflict;
      item.requiresManualReview = true;
      item.notes.push(`Group conflict: ${groupConflict}`);
    }

    duplicateGroups.push({
      groupKey: key,
      centerId: items[0].centerId,
      studentId: items[0].studentId,
      canonicalMonth: items[0].resolvedBillingMonth || "unknown",
      feeType: items[0].originalFeeType || items[0].inferredFeeType || "monthly_recurring",
      records: items,
      conflictType: groupConflict,
      requiresManualReview: true,
      recommendedAction: recommendation,
    });
  }

  // Requirement 3: Unique Index Readiness Evaluation
  let readyRecordsCount = 0;
  let missingExplicitFeeTypeCount = 0;
  let missingCanonicalBillingMonthCount = 0;
  let recordsEligibleForBackfill = 0;

  for (const item of reconciledItems) {
    if (item.classificationCategory === "CONFIRMED_RECURRING") {
      const hasValidCenter = Boolean(item.centerId && item.centerId !== "unknown_center");
      const hasValidStudent = Boolean(item.studentId && item.studentId !== "unknown_student" && item.studentId.length >= 8);
      const hasCanonicalMonth = Boolean(item.resolvedBillingMonth && item.confidence === "canonical");
      const hasExplicitFeeType = item.originalFeeType === "monthly_recurring";

      if (!hasExplicitFeeType) {
        missingExplicitFeeTypeCount++;
      }
      if (!hasCanonicalMonth) {
        missingCanonicalBillingMonthCount++;
      }

      if (hasValidCenter && hasValidStudent && hasCanonicalMonth && hasExplicitFeeType) {
        readyRecordsCount++;
      }

      if (item.resolvedBillingMonth && (!hasExplicitFeeType || !hasCanonicalMonth)) {
        recordsEligibleForBackfill++;
      }
    }
  }

  const totalTargetRecords = confirmedRecurringCount;
  const unreadyRecordsCount = totalTargetRecords - readyRecordsCount;
  const duplicateGroupViolationsCount = duplicateGroups.length;
  const invalidBillingMonthCount = ambiguousRecords.length;

  const blockingIssues: string[] = [];
  if (duplicateGroupViolationsCount > 0) {
    blockingIssues.push(
      `${duplicateGroupViolationsCount} duplicate recurring group(s) exist and will cause MongoDB E11000 duplicate key error on index creation.`
    );
  }
  if (unreadyRecordsCount > 0) {
    blockingIssues.push(
      `${unreadyRecordsCount} recurring record(s) lack explicit feeType='monthly_recurring' and/or canonical billingMonth and require backfill.`
    );
  }
  if (invalidBillingMonthCount > 0) {
    blockingIssues.push(
      `${invalidBillingMonthCount} legacy record(s) have ambiguous or unresolvable labels requiring manual review.`
    );
  }

  const isSafeToCreate =
    duplicateGroupViolationsCount === 0 &&
    unreadyRecordsCount === 0 &&
    invalidBillingMonthCount === 0;

  const indexReadiness: IndexReadinessSummary = {
    isSafeToCreate,
    totalTargetRecords,
    readyRecordsCount,
    unreadyRecordsCount,
    missingExplicitFeeTypeCount,
    missingCanonicalBillingMonthCount,
    duplicateGroupViolationsCount,
    blockingIssues,
  };

  const recordsRequiringManualReview = ambiguousRecords.length + totalDuplicateRecordsCount;

  return {
    summary: {
      totalRecordsAudited: records.length,
      confirmedRecurringCount,
      confirmedNonRecurringCount,
      confirmedAdvanceCount,
      confirmedAdhocCount,
      confirmedRegistrationCount,
      ambiguousLegacyCount,
      alreadyCanonicalCount,
      resolvableLegacyCount,
      nonRecurringCount,
      ambiguousCount,
      missingFeeTypeCount,
      cleanSingleRecordsCount,
      duplicateGroupsCount: duplicateGroups.length,
      totalDuplicateRecordsCount,
      invalidBillingMonthCount,
      recordsEligibleForBackfill,
      recordsRequiringManualReview,
      requiresManualReviewCount: recordsRequiringManualReview,
      conflictBreakdown,
      indexReadiness,
    },
    ambiguousRecords,
    duplicateGroups,
    ineligibleNonRecurring,
    executionMode: "READ_ONLY_DRY_RUN",
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Validates whether the script execution environment is safe to run.
 * Fails closed unless target is explicitly declared as approved read-only audit.
 */
export function validateExecutionSafety(
  env: NodeJS.ProcessEnv,
  args: string[]
): { safe: boolean; reason?: string } {
  // Prohibit any mutation flags
  const forbiddenFlags = ["--apply", "--write", "--migrate", "--force", "--drop", "--create-index"];
  for (const flag of forbiddenFlags) {
    if (args.includes(flag)) {
      return {
        safe: false,
        reason: `Mutation flag "${flag}" is strictly forbidden in Phase 2B.1 read-only preflight.`,
      };
    }
  }

  const targetArg = args.find((a) => a.startsWith("--target="));
  const targetEnv = env.AUDIT_DATABASE_TARGET || (targetArg ? targetArg.split("=")[1] : "");

  if (targetEnv !== "approved_readonly" && env.ALLOW_AUDIT_DATABASE_RUN !== "true") {
    return {
      safe: false,
      reason:
        "Execution safety guard: Refusing to run unless AUDIT_DATABASE_TARGET='approved_readonly' or ALLOW_AUDIT_DATABASE_RUN='true'.",
    };
  }

  return { safe: true };
}
