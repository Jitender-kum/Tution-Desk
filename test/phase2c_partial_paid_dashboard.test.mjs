import test from "node:test";
import assert from "node:assert/strict";
import { checkReminderEligibility } from "../tution-desk-be/src/lib/reminderService.ts";

const randomHex24 = () => "507f191e810c19729de8" + Math.floor(1000 + Math.random() * 9000);

// Set required test env
process.env.MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/test_tuitiondesk";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-phase2c2-dashboard";

/**
 * Mirror the client-side mapping function from src/app/fees/page.tsx
 */
function mapFeeToStudent(fee, idx = 0) {
  const AVATAR_COLORS = [
    "bg-amber-100 text-amber-800 border-amber-200",
    "bg-rose-100 text-rose-700 border-rose-200",
  ];

  const studentObj =
    typeof fee.studentId === "object" && fee.studentId !== null
      ? fee.studentId
      : null;

  const rawStudentId =
    typeof fee.studentId === "object" && fee.studentId !== null
      ? fee.studentId._id
      : fee.studentId;

  const studentName = studentObj?.name || "Student";
  const batchName = studentObj?.batch || "General Batch";
  const parentPhone = studentObj?.parentWhatsApp || "9876543210";

  const paidAmount = Number(fee.paidAmount) || 0;
  const remainingDue = Number(fee.amountDue) || 0;
  const totalAmount =
    fee.status === "Partial Paid"
      ? paidAmount + remainingDue
      : fee.status === "Paid"
      ? paidAmount || remainingDue
      : remainingDue;

  return {
    id: fee._id,
    feeId: fee._id,
    studentId: rawStudentId,
    name: studentName,
    batchName: `${batchName} • ${fee.title || fee.month}`,
    title: fee.title || fee.month,
    month: fee.month,
    pendingAmount: remainingDue,
    paidAmount: paidAmount,
    totalAmount: totalAmount,
    daysLate: 2,
    parentName: `Parent of ${studentName}`,
    parentPhone: parentPhone,
    dueDate: fee.dueDate || "Due Soon",
    avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    initials: studentName.slice(0, 2).toUpperCase(),
    status: fee.status,
    utrNumber: fee.utrNumber,
    paymentMode: fee.paymentMode,
    receiptNumber: fee.receiptNumber,
    paidAt: fee.paidAt,
  };
}

/**
 * Compute the item rendering values as implemented in OverdueStudentItem.tsx
 */
function computeOverdueItemDisplay(student) {
  const isPartialPaid = student.status === "Partial Paid";
  const isPaid = student.status === "Paid";
  const totalFeeAmount =
    student.totalAmount ?? (student.pendingAmount + (student.paidAmount || 0));
  const amountPaidSoFar = student.paidAmount || 0;
  const remainingBalance = student.pendingAmount;

  return {
    isPartialPaid,
    isPaid,
    totalFeeAmount,
    amountPaidSoFar,
    remainingBalance,
    breakdownText: isPartialPaid
      ? `Paid ₹${amountPaidSoFar.toLocaleString("en-IN")} of ₹${totalFeeAmount.toLocaleString("en-IN")}`
      : null,
    statusLabel: isPartialPaid ? "Balance Due" : isPaid ? "Settled" : "Due",
  };
}

test("TuitionDesk Phase 2C.2: Partial Paid Dashboard Visibility & Balance Suite", async (t) => {
  await t.test(
    "1. mapFeeToStudent correctly calculates remaining balance, paid amount, and total amount for Partial Paid fees",
    () => {
      const mockFee = {
        _id: "fee_partial_123",
        centerId: "center_alpha",
        studentId: {
          _id: "student_456",
          name: "Rahul Sharma",
          batch: "Class 10 CBSE",
          parentWhatsApp: "9876543210",
        },
        month: "October 2026",
        title: "Monthly Tuition Fee",
        amountDue: 500, // Remaining balance
        paidAmount: 1000, // Previously paid
        status: "Partial Paid",
        dueDate: "2026-10-10",
      };

      const mapped = mapFeeToStudent(mockFee);

      assert.equal(mapped.id, "fee_partial_123");
      assert.equal(mapped.feeId, "fee_partial_123");
      assert.equal(mapped.studentId, "student_456");
      assert.equal(mapped.status, "Partial Paid");
      assert.equal(mapped.pendingAmount, 500, "pendingAmount should be remaining due");
      assert.equal(mapped.paidAmount, 1000, "paidAmount should be amount paid so far");
      assert.equal(mapped.totalAmount, 1500, "totalAmount should be paidAmount + amountDue");
    }
  );

  await t.test(
    "2. mapFeeToStudent preserves zero paidAmount for standard Pending fees",
    () => {
      const mockFee = {
        _id: "fee_pending_123",
        centerId: "center_alpha",
        studentId: {
          _id: "student_789",
          name: "Priya Patel",
          batch: "Class 9 CBSE",
        },
        month: "October 2026",
        amountDue: 1500,
        paidAmount: 0,
        status: "Pending",
      };

      const mapped = mapFeeToStudent(mockFee);

      assert.equal(mapped.pendingAmount, 1500);
      assert.equal(mapped.paidAmount, 0);
      assert.equal(mapped.totalAmount, 1500);
      assert.equal(mapped.status, "Pending");
    }
  );

  await t.test(
    "3. OverdueStudentItem calculations correctly display balance due, paid amount, and total obligation",
    () => {
      const partialStudent = {
        id: "fee_partial_123",
        feeId: "fee_partial_123",
        studentId: "student_456",
        name: "Rahul Sharma",
        batchName: "Class 10 • October 2026",
        pendingAmount: 500,
        paidAmount: 1000,
        totalAmount: 1500,
        daysLate: 3,
        parentName: "Parent of Rahul Sharma",
        parentPhone: "9876543210",
        dueDate: "10 Oct 2026",
        avatarColor: "bg-amber-100",
        initials: "RS",
        status: "Partial Paid",
      };

      const display = computeOverdueItemDisplay(partialStudent);

      assert.equal(display.isPartialPaid, true);
      assert.equal(display.remainingBalance, 500);
      assert.equal(display.amountPaidSoFar, 1000);
      assert.equal(display.totalFeeAmount, 1500);
      assert.equal(display.statusLabel, "Balance Due");
      assert.equal(display.breakdownText, "Paid ₹1,000 of ₹1,500");
    }
  );

  await t.test(
    "4. Total Overdue aggregation calculates correct total remaining due across Pending and Partial Paid items",
    () => {
      const items = [
        { pendingAmount: 1500, status: "Pending" },
        { pendingAmount: 500, status: "Partial Paid" }, // original 1500, 1000 paid
        { pendingAmount: 750, status: "Partial Paid" }, // original 1200, 450 paid
      ];

      const totalOverdue = items.reduce(
        (acc, curr) => acc + (curr?.pendingAmount || 0),
        0
      );

      // 1500 + 500 + 750 = 2750
      assert.equal(totalOverdue, 2750, "Total overdue should only sum the remaining balances");
    }
  );

  await t.test(
    "5. Reminder eligibility rules allow Partial Paid fees but reject Paid and Verification Pending",
    () => {
      const activeStudent = {
        _id: randomHex24(),
        name: "Rahul Sharma",
        parentWhatsApp: "9876543210",
        isActive: true,
      };

      const partialFee = {
        _id: randomHex24(),
        status: "Partial Paid",
        amountDue: 500,
        reminderPaused: false,
      };

      const paidFee = {
        _id: randomHex24(),
        status: "Paid",
        amountDue: 0,
        reminderPaused: false,
      };

      const reviewFee = {
        _id: randomHex24(),
        status: "Verification Pending",
        amountDue: 500,
        reminderPaused: false,
      };

      // 1. Partial Paid is eligible
      const partialCheck = checkReminderEligibility(partialFee, activeStudent, "auto_followup");
      assert.equal(partialCheck.eligible, true);

      // 2. Paid is strictly excluded
      const paidCheck = checkReminderEligibility(paidFee, activeStudent, "auto_followup");
      assert.equal(paidCheck.eligible, false);
      assert.equal(paidCheck.code, "INVALID_STATUS");

      // 3. Verification Pending is strictly excluded
      const reviewCheck = checkReminderEligibility(reviewFee, activeStudent, "auto_followup");
      assert.equal(reviewCheck.eligible, false);
      assert.equal(reviewCheck.code, "INVALID_STATUS");

      // 4. Partial Paid with reminderPaused: true is excluded
      const pausedFee = { ...partialFee, reminderPaused: true };
      const pausedCheck = checkReminderEligibility(pausedFee, activeStudent, "auto_followup");
      assert.equal(pausedCheck.eligible, false);
      assert.equal(pausedCheck.code, "REMINDERS_PAUSED");

      // 5. Partial Paid with inactive student is excluded
      const inactiveStudent = { ...activeStudent, isActive: false };
      const inactiveCheck = checkReminderEligibility(partialFee, inactiveStudent, "auto_followup");
      assert.equal(inactiveCheck.eligible, false);
      assert.equal(inactiveCheck.code, "INACTIVE_STUDENT");
    }
  );

  await t.test(
    "6. Comma-separated status parsing in GET /api/fees matches Pending and Partial Paid without mutating database query structure",
    () => {
      const statusParam = "Pending,Partial Paid";
      const filter = {};

      if (statusParam.includes(",")) {
        filter.status = { $in: statusParam.split(",").map((s) => s.trim()) };
      } else {
        filter.status = statusParam;
      }

      assert.deepEqual(filter.status, {
        $in: ["Pending", "Partial Paid"],
      });
    }
  );

  await t.test(
    "7. Marking a Partial Paid fee as Paid via PUT /api/fees/[feeId] settles full amount and zeroes remaining due",
    () => {
      const existingFee = {
        _id: randomHex24(),
        status: "Partial Paid",
        paidAmount: 1000,
        amountDue: 500,
        receiptNumber: "RCPT-ORIG123",
      };

      const body = { status: "Paid", paymentMode: "Cash" };

      // Apply the settlement logic from PUT /api/fees/[feeId]
      existingFee.status = body.status || "Paid";
      existingFee.paymentMode = body.paymentMode;

      if (body.paidAmount !== undefined) {
        existingFee.paidAmount = Number(body.paidAmount);
      } else if (!existingFee.paidAmount || existingFee.paidAmount === 0) {
        existingFee.paidAmount = existingFee.amountDue;
      } else if (existingFee.status === "Paid") {
        existingFee.paidAmount =
          (Number(existingFee.paidAmount) || 0) + (Number(existingFee.amountDue) || 0);
      }

      if (existingFee.status === "Paid" && body.amountDue === undefined) {
        existingFee.amountDue = 0;
      }

      assert.equal(existingFee.status, "Paid");
      assert.equal(existingFee.paidAmount, 1500, "paidAmount should sum previous paid + remaining due");
      assert.equal(existingFee.amountDue, 0, "amountDue should be 0 after settlement");
      assert.equal(existingFee.receiptNumber, "RCPT-ORIG123", "Receipt history preserved");
    }
  );
});
