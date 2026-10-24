import connectDB from "./db.ts";
import Student from "../models/Student.ts";
import type { IStudentDocument } from "../models/Student.ts";
import Fee from "../models/Fee.ts";
import type { IFeeDocument } from "../models/Fee.ts";

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
 * Ensures strict idempotency: skips students who already have a Fee record for the target month.
 */
export async function generateMonthlyFees(
  options: FeeGenerationOptions = {}
): Promise<FeeGenerationResult> {
  await connectDB();

  const now = options.referenceDate || new Date();

  // Target month and year string, e.g., "Oct 2026"
  const currentMonthString = now.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });

  // Calculate default due date: reference date + 5 days
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 5);

  const cycleDay = options.overrideDay !== undefined ? options.overrideDay : now.getDate();

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
    // 1. Idempotency Check: Check if fee already exists for this student for the target month
    const existingFee = await Fee.findOne({
      centerId: student.centerId,
      studentId: student._id,
      month: currentMonthString,
    });

    if (existingFee) {
      skippedCount++;
      skippedRecords.push({
        studentId: student._id.toString(),
        studentName: student.name,
        reason: `Fee already exists for ${currentMonthString} (Fee ID: ${existingFee._id}, Status: ${existingFee.status})`,
      });
      continue;
    }

    // 2. Fee Amount Validation
    const feeAmount = student.monthlyFee !== undefined ? student.monthlyFee : 0;
    if (feeAmount <= 0) {
      skippedCount++;
      skippedRecords.push({
        studentId: student._id.toString(),
        studentName: student.name,
        reason: `Monthly fee rate is 0 or unassigned (Fee: ₹${feeAmount})`,
      });
      continue;
    }

    // 3. Create new recurring pending fee record
    const newFee = (await Fee.create({
      centerId: student.centerId,
      studentId: student._id,
      month: currentMonthString,
      title: `${currentMonthString} Tuition Fee`,
      amountDue: feeAmount,
      dueDate,
      status: "Pending",
    })) as IFeeDocument;

    generatedFeeRecords.push(newFee);
    generatedCount++;
  }

  return {
    success: true,
    month: currentMonthString,
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
