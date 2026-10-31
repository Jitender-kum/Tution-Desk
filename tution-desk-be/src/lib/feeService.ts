import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import connectDB from "./db.ts";
import Fee, { IFeeDocument } from "../models/Fee.ts";
import Student, { IStudentDocument } from "../models/Student.ts";
import Center from "../models/Center.ts";
import FeeCreationLock, { verifyLockIndexIntegrity } from "../models/FeeCreationLock.ts";
import {
  getISTDateComponents,
  calculateDueDate,
  isStudentEligibleForBilling,
  calculateFirstBillingMonth,
} from "./dateUtils.ts";

export interface GenerateFeeOptions {
  centerId: string;
  studentId: string | Types.ObjectId;
  billingMonth?: string; // Canonical "YYYY-MM"
  amountDue?: number;
  dueDate?: Date;
  referenceDate?: Date;
  isManual?: boolean;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  models?: {
    Fee?: any;
    Student?: any;
    Center?: any;
    FeeCreationLock?: any;
  };
}

export interface FeeServiceResult {
  success: boolean;
  fee?: IFeeDocument | null;
  wasCreated: boolean;
  status:
    | "created"
    | "reused"
    | "reused_legacy"
    | "reconciliation_required"
    | "skipped_ineligible"
    | "lock_timeout"
    | "lock_index_unverified";
  conflictReason?: string;
  error?: string;
}

/**
 * Shared Idempotent Monthly Fee Generation Engine
 * Used uniformly by:
 * 1. Daily auto-generation cron (/api/cron/generate-fees)
 * 2. Owner manual fee generation modal (POST /api/fees)
 */
export async function generateOrGetMonthlyFee(
  options: GenerateFeeOptions
): Promise<FeeServiceResult> {
  const FeeModel = options.models?.Fee || Fee;
  const StudentModel = options.models?.Student || Student;
  const CenterModel = options.models?.Center || Center;

  if (!options.models) {
    await connectDB();
  }

  const referenceDate = options.referenceDate || new Date();
  const dateComp = getISTDateComponents(referenceDate);
  const targetBillingMonth = options.billingMonth || dateComp.billingMonth;

  if (!/^\d{4}-\d{2}$/.test(targetBillingMonth)) {
    return {
      success: false,
      wasCreated: false,
      status: "skipped_ineligible",
      error: `Invalid billing month format: "${targetBillingMonth}". Expected YYYY-MM.`,
    };
  }

  // 1. Validate student
  const student = (await StudentModel.findById(options.studentId)) as IStudentDocument | null;
  if (!student) {
    return {
      success: false,
      wasCreated: false,
      status: "skipped_ineligible",
      error: `Student not found with ID: ${options.studentId}`,
    };
  }

  if (student.centerId !== options.centerId) {
    return {
      success: false,
      wasCreated: false,
      status: "skipped_ineligible",
      error: `Student ${options.studentId} does not belong to center ${options.centerId}.`,
    };
  }

  // Active student check (for automated generation)
  if (!options.isManual && student.isActive === false) {
    return {
      success: false,
      wasCreated: false,
      status: "skipped_ineligible",
      conflictReason: `Student "${student.name}" is deactivated.`,
    };
  }

  // Mid-month joiner check (for automated generation)
  const cycleDay = student.billingCycleDate || 5;
  if (!options.isManual) {
    const isEligible = isStudentEligibleForBilling(
      student.joiningDate,
      cycleDay,
      targetBillingMonth
    );
    if (!isEligible) {
      const firstEligible = calculateFirstBillingMonth(
        student.joiningDate || new Date(),
        cycleDay
      );
      return {
        success: false,
        wasCreated: false,
        status: "skipped_ineligible",
        conflictReason: `Student joined on ${student.joiningDate?.toISOString().slice(0, 10)} on or after billing cycle day ${cycleDay}. First eligible automated billing month is ${firstEligible}.`,
      };
    }
  }

  // 2. Step A: Check for existing canonical recurring fee
  const canonicalExisting = (await FeeModel.findOne({
    centerId: options.centerId,
    studentId: student._id,
    billingMonth: targetBillingMonth,
    feeType: "monthly_recurring",
  })) as IFeeDocument | null;

  if (canonicalExisting) {
    return {
      success: true,
      fee: canonicalExisting,
      wasCreated: false,
      status: "reused",
    };
  }

  // 3. Step B: Inspect legacy candidate records for this student and center
  // Avoid re-billing if student already has a record with matching month label
  const legacyCandidates = (await FeeModel.find({
    centerId: options.centerId,
    studentId: student._id,
    feeType: { $ne: "advance" },
    isAdvance: { $ne: true },
    month: {
      $in: [
        dateComp.monthLabel, // e.g. "October 2026"
        dateComp.shortMonthLabel, // e.g. "Oct 2026"
        targetBillingMonth,
      ],
    },
  })) as IFeeDocument[];

  // Ambiguous legacy records safety check
  if (legacyCandidates.length > 1) {
    const statuses = legacyCandidates.map((c: any) => c.status).join(", ");
    return {
      success: false,
      fee: null,
      wasCreated: false,
      status: "reconciliation_required",
      conflictReason: `Multiple (${legacyCandidates.length}) legacy candidate records exist for ${targetBillingMonth} (${statuses}). Safe reconciliation required before creating new invoice.`,
    };
  }

  if (legacyCandidates.length === 1) {
    const candidate = legacyCandidates[0];
    // Advance fee records must never be matched as recurring monthly fees
    const isAdv =
      candidate.isAdvance ||
      candidate.feeType === "advance" ||
      /advance/i.test(candidate.title || "") ||
      /advance/i.test(candidate.month || "");

    if (!isAdv) {
      return {
        success: true,
        fee: candidate,
        wasCreated: false,
        status: "reused_legacy",
      };
    }
  }

  const hasInjectedModels = Boolean(options.models);
  const FeeCreationLockModel = options.models?.FeeCreationLock || (hasInjectedModels ? null : FeeCreationLock);

  // 5. Atomic Lock Coordination Setup
  const lockKey = `${options.centerId}:${student._id}:${targetBillingMonth}:monthly_recurring`;
  const lockToken = crypto.randomUUID(); // Safe, explicit ownership token (CRITICAL CHECK 3)
  const lockTtlMs = 15000; // 15 second lock TTL
  const pollIntervalMs = options.pollIntervalMs !== undefined ? options.pollIntervalMs : 100;
  const maxAttempts = options.maxPollAttempts !== undefined ? options.maxPollAttempts : 30;

  let acquiredLock = false;

  if (FeeCreationLockModel) {
    // 4. Step C: Verify Lock Index Integrity (CRITICAL CHECK 1, 2, 10)
    // When autoIndex=false, lockKey uniqueness is not guaranteed without explicit index creation.
    // Lock acquisition must NEVER proceed without verified uniqueness enforcement.
    const isIndexVerified = await verifyLockIndexIntegrity(FeeCreationLockModel);
    if (!isIndexVerified) {
      return {
        success: false,
        fee: null,
        wasCreated: false,
        status: "lock_index_unverified",
        error: "FeeCreationLock unique index on 'lockKey' is missing or unverified. Lock acquisition cannot proceed without effective uniqueness enforcement.",
      };
    }

    // Attempt 1: Insert new lock
    try {
      const now = new Date();
      const lockExpiresAt = new Date(now.getTime() + lockTtlMs);

      await FeeCreationLockModel.create({
        lockKey,
        centerId: options.centerId,
        studentId: String(student._id),
        billingMonth: targetBillingMonth,
        feeType: "monthly_recurring",
        lockedAt: now,
        expiresAt: lockExpiresAt,
        holderId: lockToken,
        status: "LOCKED",
      });
      acquiredLock = true;
    } catch (lockErr: any) {
      if (!lockErr || lockErr.code !== 11000) {
        throw lockErr;
      }
    }

    // Attempt 2: Takeover of expired lock (CRITICAL CHECK 6, 9)
    // Atomically claim lock if previous holder crashed or expired (expiresAt <= now)
    if (!acquiredLock) {
      const now = new Date();
      const newExpiresAt = new Date(now.getTime() + lockTtlMs);

      const claimedDoc = await FeeCreationLockModel.findOneAndUpdate(
        {
          lockKey,
          expiresAt: { $lte: now },
        },
        {
          $set: {
            holderId: lockToken,
            lockedAt: now,
            expiresAt: newExpiresAt,
            status: "LOCKED",
            feeId: null,
          },
        },
        { new: true }
      );

      if (claimedDoc) {
        acquiredLock = true;
      }
    }

    // Attempt 3: Polling for actively running holder to finish (CRITICAL CHECK 8)
    if (!acquiredLock) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        // Check if fee was created
        const existingFee = (await FeeModel.findOne({
          centerId: options.centerId,
          studentId: student._id,
          billingMonth: targetBillingMonth,
          feeType: "monthly_recurring",
        })) as IFeeDocument | null;

        if (existingFee) {
          return {
            success: true,
            fee: existingFee,
            wasCreated: false,
            status: "reused",
          };
        }

        // Check if lock expired while waiting
        const nowPolling = new Date();
        const newPollExpiresAt = new Date(nowPolling.getTime() + lockTtlMs);

        const claimedExpired = await FeeCreationLockModel.findOneAndUpdate(
          {
            lockKey,
            expiresAt: { $lte: nowPolling },
          },
          {
            $set: {
              holderId: lockToken,
              lockedAt: nowPolling,
              expiresAt: newPollExpiresAt,
              status: "LOCKED",
              feeId: null,
            },
          },
          { new: true }
        );

        if (claimedExpired) {
          acquiredLock = true;
          break;
        }

        // Check if lock was deleted/released without fee creation
        const currentLock = await FeeCreationLockModel.findOne({ lockKey });
        if (!currentLock) {
          try {
            await FeeCreationLockModel.create({
              lockKey,
              centerId: options.centerId,
              studentId: String(student._id),
              billingMonth: targetBillingMonth,
              feeType: "monthly_recurring",
              lockedAt: nowPolling,
              expiresAt: newPollExpiresAt,
              holderId: lockToken,
              status: "LOCKED",
            });
            acquiredLock = true;
            break;
          } catch (err: any) {
            if (err && err.code === 11000) {
              continue;
            }
            throw err;
          }
        }
      }
    }

    // If polling timed out and lock could not be acquired, NEVER create fee! (CRITICAL CHECK 8)
    if (!acquiredLock) {
      const finalFeeCheck = (await FeeModel.findOne({
        centerId: options.centerId,
        studentId: student._id,
        billingMonth: targetBillingMonth,
        feeType: "monthly_recurring",
      })) as IFeeDocument | null;

      if (finalFeeCheck) {
        return {
          success: true,
          fee: finalFeeCheck,
          wasCreated: false,
          status: "reused",
        };
      }

      return {
        success: false,
        fee: null,
        wasCreated: false,
        status: "lock_timeout",
        error: "Timed out waiting for concurrent fee creation lock to be released. Request is retryable.",
      };
    }
  }

  // 6. Execution under Lock with Guaranteed Cleanup in finally (CRITICAL CHECK 4, 5, 7)
  try {
    // Post-lock double-check: ensure canonical invoice was not inserted right before lock acquisition
    const postLockCheck = (await FeeModel.findOne({
      centerId: options.centerId,
      studentId: student._id,
      billingMonth: targetBillingMonth,
      feeType: "monthly_recurring",
    })) as IFeeDocument | null;

    if (postLockCheck) {
      return {
        success: true,
        fee: postLockCheck,
        wasCreated: false,
        status: "reused",
      };
    }

    // Create new recurring fee record
    const feeAmount =
      options.amountDue !== undefined ? options.amountDue : student.monthlyFee || 0;

    if (feeAmount <= 0) {
      return {
        success: false,
        fee: null,
        wasCreated: false,
        status: "skipped_ineligible",
        conflictReason: `Monthly fee rate is 0 or unassigned (Fee: ₹${feeAmount})`,
      };
    }

    let offsetDays = 5;
    try {
      const center = await CenterModel.findOne({ centerId: options.centerId });
      if (center && typeof center.dueDateOffsetDays === "number") {
        offsetDays = Math.max(0, center.dueDateOffsetDays);
      }
    } catch {
      offsetDays = 5;
    }

    const dueDate = options.dueDate || calculateDueDate(referenceDate, offsetDays);
    const displayMonth = dateComp.shortMonthLabel;

    try {
      const newFee = (await FeeModel.create({
        centerId: options.centerId,
        studentId: student._id,
        billingMonth: targetBillingMonth,
        month: displayMonth,
        title: `${displayMonth} Tuition Fee`,
        amountDue: feeAmount,
        paidAmount: 0,
        dueDate,
        status: "Pending",
        feeType: "monthly_recurring",
        reminderCount: 0,
        reminderPaused: false,
      })) as IFeeDocument;

      return {
        success: true,
        fee: newFee,
        wasCreated: true,
        status: "created",
      };
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: number }).code === 11000
      ) {
        const existing = (await FeeModel.findOne({
          centerId: options.centerId,
          studentId: student._id,
          billingMonth: targetBillingMonth,
          feeType: "monthly_recurring",
        })) as IFeeDocument | null;

        if (existing) {
          return {
            success: true,
            fee: existing,
            wasCreated: false,
            status: "reused",
          };
        }
      }

      const errorMsg =
        err instanceof Error ? err.message : "Failed to create fee record";
      return {
        success: false,
        wasCreated: false,
        status: "skipped_ineligible",
        error: errorMsg,
      };
    }
  } finally {
    // Release the lock ONLY if the current process still owns it (CRITICAL CHECK 4, 7)
    // If the lock expired and was acquired by another process, holderId will not match,
    // protecting the newer owner's lock.
    if (acquiredLock && FeeCreationLockModel) {
      await FeeCreationLockModel.deleteOne({
        lockKey,
        holderId: lockToken,
      }).catch(() => {});
    }
  }
}


export default generateOrGetMonthlyFee;
