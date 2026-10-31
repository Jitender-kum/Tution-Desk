import connectDB from "./db.ts";
import Student from "../models/Student.ts";
import type { IStudentDocument } from "../models/Student.ts";
import type { IFeeDocument } from "../models/Fee.ts";
import { generateOrGetMonthlyFee } from "./feeService.ts";
import { getISTDateComponents } from "./dateUtils.ts";

export interface FeeGenerationOptions {
  overrideDay?: number;
  centerId?: string;
  forceAllStudents?: boolean;
  referenceDate?: Date;
}

export interface SkippedFeeRecord {
  studentId: string;
  studentName: string;
  reason: string;
}

export interface FeeGenerationResult {
  success: boolean;
  month: string;
  cycleDay: number | string;
  totalEligibleStudents: number;
  generatedCount: number;
  skippedCount: number;
  generatedFeeRecords: IFeeDocument[];
  skippedRecords: SkippedFeeRecord[];
  timestamp: string;
}

/**
 * Auto-Fee Generator Engine
 * Generates recurring monthly fees for active students based on billingCycleDate
 * or forces generation for all active students when forceAllStudents is true.
 * Uses shared idempotent feeService for canonical YYYY-MM keying, mid-month joiner protection,
 * and center due-date offsets.
 */
export async function generateMonthlyFees(
  options: FeeGenerationOptions = {}
): Promise<FeeGenerationResult> {
  await connectDB();

  const now = options.referenceDate || new Date();
  const dateComp = getISTDateComponents(now);

  const cycleDay =
    options.overrideDay !== undefined ? options.overrideDay : dateComp.day;

  // Build query for eligible students
  const studentQuery: Record<string, unknown> = {
    isActive: { $ne: false },
  };

  // If not forcing all students, filter by billingCycleDate matching cycleDay
  if (!options.forceAllStudents) {
    if (isNaN(cycleDay) || cycleDay < 1 || cycleDay > 31) {
      throw new Error(`Invalid cycle day: ${cycleDay}. Must be between 1 and 31.`);
    }
    studentQuery.billingCycleDate = cycleDay;
  }

  if (options.centerId) {
    studentQuery.centerId = options.centerId;
  }

  const eligibleStudents = (await Student.find(studentQuery)) as IStudentDocument[];

  let generatedCount = 0;
  let skippedCount = 0;
  const generatedFeeRecords: IFeeDocument[] = [];
  const skippedRecords: SkippedFeeRecord[] = [];

  for (const student of eligibleStudents) {
    const res = await generateOrGetMonthlyFee({
      centerId: student.centerId,
      studentId: student._id,
      referenceDate: now,
      isManual: false,
    });

    if (res.wasCreated && res.fee) {
      generatedFeeRecords.push(res.fee);
      generatedCount++;
    } else {
      skippedCount++;
      const reason =
        res.conflictReason ||
        (res.fee
          ? `Fee already exists for ${dateComp.shortMonthLabel} (Fee ID: ${res.fee._id}, Status: ${res.fee.status})`
          : res.error || "Ineligible for monthly billing");

      skippedRecords.push({
        studentId: student._id.toString(),
        studentName: student.name,
        reason,
      });
    }
  }

  return {
    success: true,
    month: dateComp.shortMonthLabel,
    cycleDay: options.forceAllStudents ? "FORCED_ALL" : cycleDay,
    totalEligibleStudents: eligibleStudents.length,
    generatedCount,
    skippedCount,
    generatedFeeRecords,
    skippedRecords,
    timestamp: now.toISOString(),
  };
}

export default generateMonthlyFees;
