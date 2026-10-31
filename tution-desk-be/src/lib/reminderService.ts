import { Types } from "mongoose";
import connectDB from "./db.ts";
import Fee from "../models/Fee.ts";
import Student from "../models/Student.ts";
import FeeReminderLog, {
  ReminderTriggerType,
  ReminderDispatchStatus,
} from "../models/FeeReminderLog.ts";
import {
  sendFeeReminder,
  SendFeeReminderResult,
} from "./whatsappService.ts";
import {
  isWithin24HourCooldown,
  isEligibleForFollowupReminder,
} from "./dateUtils.ts";

export interface DispatchReminderOptions {
  feeId: string | Types.ObjectId;
  centerId: string;
  triggerType: ReminderTriggerType;
  forceOverride?: boolean;
  overrideReason?: string;
  models?: {
    Fee?: any;
    Student?: any;
    FeeReminderLog?: any;
  };
  /**
   * Optional custom dispatcher for unit/regression tests to avoid real network calls.
   */
  sendFn?: (
    centerId: string,
    phone: string,
    studentName: string,
    amount: number | string,
    dueDate: string,
    magicLink?: string
  ) => Promise<SendFeeReminderResult>;
}

export interface DispatchReminderResult {
  success: boolean;
  status: ReminderDispatchStatus;
  code?: string;
  message?: string;
  providerMessageId?: string;
  simulated?: boolean;
  retryLockUntil?: Date;
  logId?: string;
}

export interface ReminderEligibilityResult {
  eligible: boolean;
  reason?: string;
  code?: string;
  message?: string;
}

/**
 * Checks if a fee is eligible for a reminder based on status, pause state, and student active state.
 */
export function checkReminderEligibility(
  fee: any,
  student: any,
  triggerType: ReminderTriggerType = "auto_followup",
  now: Date = new Date()
): ReminderEligibilityResult {
  if (!fee) {
    return {
      eligible: false,
      reason: "fee_missing",
      code: "NOT_FOUND",
      message: "Fee record not found.",
    };
  }

  if (fee.status === "Paid") {
    return {
      eligible: false,
      reason: "fee_already_paid",
      code: "INVALID_STATUS",
      message: "Cannot send reminder: fee status is 'Paid'.",
    };
  }

  if (fee.status === "Verification Pending") {
    return {
      eligible: false,
      reason: "verification_pending",
      code: "INVALID_STATUS",
      message: "Cannot send reminder: fee status is 'Verification Pending'.",
    };
  }

  if (fee.reminderPaused) {
    return {
      eligible: false,
      reason: "reminders_paused",
      code: "REMINDERS_PAUSED",
      message: "Reminders are paused by the owner for this fee.",
    };
  }

  if (!student) {
    return {
      eligible: false,
      reason: "student_missing",
      code: "STUDENT_MISSING",
      message: "Student record associated with this fee was not found.",
    };
  }

  if (student.isActive === false) {
    return {
      eligible: false,
      reason: "student_inactive",
      code: "INACTIVE_STUDENT",
      message: `Cannot send reminder: student "${student.name || "Student"}" is deactivated.`,
    };
  }

  return { eligible: true };
}

/**
 * Backend Reminder Dispatch Service
 * Handles atomic claiming, 24h manual cooldowns, 7-day automated intervals,
 * auditable logging to FeeReminderLog, and uncertain-dispatch 60-minute lock retention.
 */
export async function dispatchFeeReminder(
  options: DispatchReminderOptions
): Promise<DispatchReminderResult> {
  const FeeModel = options.models?.Fee || Fee;
  const FeeReminderLogModel = options.models?.FeeReminderLog || FeeReminderLog;

  if (!options.models) {
    await connectDB();
  }

  const now = new Date();
  const feeId = options.feeId;
  const centerId = options.centerId;

  // 1. Fetch fee record
  const fee = await FeeModel.findOne({ _id: feeId, centerId }).populate("studentId");
  if (!fee) {
    return {
      success: false,
      status: "failed",
      code: "NOT_FOUND",
      message: "Fee record not found for this center.",
    };
  }

  // 2-4. Check status, pause, and student eligibility
  const student = fee.studentId as any;
  const eligibility = checkReminderEligibility(fee, student, options.triggerType, now);
  if (!eligibility.eligible) {
    return {
      success: false,
      status: "failed",
      code: eligibility.code || "INELIGIBLE",
      message: eligibility.message || "Fee is not eligible for reminder.",
    };
  }

  const parentPhone = student.parentWhatsApp;
  if (!parentPhone) {
    return {
      success: false,
      status: "failed",
      code: "NO_PHONE",
      message: `Student "${student.name}" has no registered parent WhatsApp number.`,
    };
  }

  // 5. Cooldown checks
  const isManual = options.triggerType.startsWith("manual_");

  if (isManual) {
    // 24-hour cooldown for manual sends
    if (isWithin24HourCooldown(fee.lastReminderSentAt, now)) {
      if (!options.forceOverride) {
        return {
          success: false,
          status: "failed",
          code: "COOLDOWN_ACTIVE",
          message:
            "A reminder was already sent to this parent within the last 24 hours. Explicit owner confirmation required to override.",
        };
      }
    }
  } else {
    // 7-day cooldown for automated sends
    if (!isEligibleForFollowupReminder(fee.lastReminderSentAt, now)) {
      return {
        success: false,
        status: "failed",
        code: "FOLLOWUP_NOT_DUE",
        message:
          "Automated follow-up reminder is not due yet (7-day minimum interval required).",
      };
    }
  }

  // 6. Atomic claim lock: Acquire 5-minute processing lease
  const claimedFee = await FeeModel.findOneAndUpdate(
    {
      _id: fee._id,
      status: "Pending",
      reminderPaused: { $ne: true },
      $or: [
        { reminderLockUntil: { $exists: false } },
        { reminderLockUntil: null },
        { reminderLockUntil: { $lte: now } },
      ],
    },
    {
      $set: { reminderLockUntil: new Date(now.getTime() + 5 * 60 * 1000) },
    },
    { new: true }
  );

  if (!claimedFee) {
    return {
      success: false,
      status: "failed",
      code: "LOCKED_CONCURRENT",
      message:
        "Reminder dispatch is currently locked by another operation or active cooldown.",
    };
  }

  // 7. Format message parameters
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";

  const studentName = student.name || "Student";
  const amountDue = fee.amountDue || 0;
  const formattedDueDate = fee.dueDate
    ? new Date(fee.dueDate).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Immediate";
  const magicLink = student._id ? `${appUrl}/p/${student._id}` : "";

  const send = options.sendFn || sendFeeReminder;

  // 8. Execute dispatch with safety outcome handling
  try {
    const res = await send(
      centerId,
      parentPhone,
      studentName,
      amountDue,
      formattedDueDate,
      magicLink
    );

    if (res.success || res.simulated) {
      // Outcome: provider_accepted (or simulated)
      // IMPORTANT: Provider acceptance must NEVER be represented as confirmed delivery.
      const outcomeStatus: ReminderDispatchStatus = "provider_accepted";

      await FeeModel.updateOne(
        { _id: fee._id },
        {
          $set: {
            lastReminderSentAt: now,
            reminderLockUntil: null, // Release claim lock cleanly
          },
          $inc: { reminderCount: 1 },
        }
      );

      const log = await FeeReminderLogModel.create({
        centerId,
        feeId: fee._id,
        studentId: student._id,
        recipientPhone: parentPhone,
        amountDue,
        dueDate: fee.dueDate,
        triggerType: options.triggerType,
        status: outcomeStatus,
        providerMessageId: res.messageId,
        simulated: Boolean(res.simulated),
        isManualOverride: Boolean(options.forceOverride),
        overrideReason: options.overrideReason || (options.forceOverride ? "Explicit owner manual override" : ""),
        attemptedAt: now,
      });

      return {
        success: true,
        status: outcomeStatus,
        providerMessageId: res.messageId,
        simulated: Boolean(res.simulated),
        logId: log?._id ? log._id.toString() : "log_sim",
      };
    } else {
      // Rejection from provider
      await FeeModel.updateOne(
        { _id: fee._id },
        { $set: { reminderLockUntil: null } } // Release lease on hard failure
      );

      const log = await FeeReminderLogModel.create({
        centerId,
        feeId: fee._id,
        studentId: student._id,
        recipientPhone: parentPhone,
        amountDue,
        dueDate: fee.dueDate,
        triggerType: options.triggerType,
        status: "failed",
        failureReason: res.error || "Provider rejected dispatch",
        attemptedAt: now,
      });

      return {
        success: false,
        status: "failed",
        code: "PROVIDER_REJECTED",
        message: res.error || "WhatsApp provider rejected dispatch.",
        logId: log?._id ? log._id.toString() : "log_sim",
      };
    }
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : "Network/dispatch error";

    const isTimeout =
      /timeout/i.test(errorMsg) ||
      /ETIMEDOUT/i.test(errorMsg) ||
      /ECONNRESET/i.test(errorMsg);

    if (isTimeout) {
      // Outcome: dispatch_uncertain
      // CRITICAL: Preserve the 60-minute retry lock! Do not release prematurely!
      const lock60 = new Date(now.getTime() + 60 * 60 * 1000);

      await FeeModel.updateOne(
        { _id: fee._id },
        { $set: { reminderLockUntil: lock60 } }
      );

      const log = await FeeReminderLogModel.create({
        centerId,
        feeId: fee._id,
        studentId: student._id,
        recipientPhone: parentPhone,
        amountDue,
        dueDate: fee.dueDate,
        triggerType: options.triggerType,
        status: "dispatch_uncertain",
        failureReason: `Timeout after dispatch: ${errorMsg}`,
        retryLockUntil: lock60,
        attemptedAt: now,
      });

      return {
        success: false,
        status: "dispatch_uncertain",
        code: "DISPATCH_UNCERTAIN",
        message:
          "Provider connection timed out after dispatch. A 60-minute safety lock has been retained to prevent duplicate messages.",
        retryLockUntil: lock60,
        logId: log?._id ? log._id.toString() : "log_sim",
      };
    }

    // Generic error: release lease so it can be retried
    await FeeModel.updateOne(
      { _id: fee._id },
      { $set: { reminderLockUntil: null } }
    );

    const log = await FeeReminderLogModel.create({
      centerId,
      feeId: fee._id,
      studentId: student._id,
      recipientPhone: parentPhone,
      amountDue,
      dueDate: fee.dueDate,
      triggerType: options.triggerType,
      status: "failed",
      failureReason: errorMsg,
      attemptedAt: now,
    });

    return {
      success: false,
      status: "failed",
      code: "DISPATCH_ERROR",
      message: errorMsg,
      logId: log?._id ? log._id.toString() : "log_sim",
    };
  }
}

export default dispatchFeeReminder;
