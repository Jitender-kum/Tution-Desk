import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Student from "@/models/Student";
import Attendance from "@/models/Attendance";
import Fee from "@/models/Fee";
import Test from "@/models/Test";
import Center from "@/models/Center";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "GET, OPTIONS");
}

function calculateDaysLate(dueDate?: Date | string | null): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(0, diffDays);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ studentId: string }> | { studentId: string } }
) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    // 1. Extract studentId from route params (No auth required - magic link)
    const { studentId } = await context.params;

    if (!studentId || !studentId.trim()) {
      return NextResponse.json(
        { success: false, error: "Student ID is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanStudentId = studentId.trim();

    // 2. Fetch the Student document. If not found, return 404.
    if (!mongoose.Types.ObjectId.isValid(cleanStudentId)) {
      return NextResponse.json(
        { success: false, error: "Invalid student ID" },
        { status: 404, headers: corsHeaders }
      );
    }

    const student = await Student.findById(cleanStudentId).lean();

    if (!student) {
      return NextResponse.json(
        { success: false, error: "Student record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // 3. Fetch related data for this student concurrently
    const studentObjectId = student._id;

    const [attendanceRecords, feeRecords, testsList, centerDoc] =
      await Promise.all([
        // All attendance records for this student
        Attendance.find({
          studentId: studentObjectId,
        })
          .sort({ date: -1 })
          .lean(),

        // All fee records to show current due and payment history
        Fee.find({
          studentId: studentObjectId,
        })
          .sort({ dueDate: -1 })
          .lean(),

        // Find all tests in Test model where results.studentId matches
        Test.find({
          centerId: student.centerId,
          "results.studentId": studentObjectId,
        })
          .sort({ date: -1 })
          .lean(),

        // Optional Center profile for contact info & UPI ID
        Center.findOne({ centerId: student.centerId }).lean(),
      ]);

    // Calculate Attendance Statistics
    const totalClasses = attendanceRecords.length;
    const attended = attendanceRecords.filter((a) => a.status === "Present").length;
    const missed = totalClasses - attended;
    const attendancePercentage =
      totalClasses > 0 ? Math.round((attended / totalClasses) * 100) : 100;

    const attendanceStats = {
      percentage: attendancePercentage,
      totalClasses,
      attended,
      missed,
      history: attendanceRecords.map((a) => ({
        id: String(a._id),
        date: a.date ? new Date(a.date).toISOString() : new Date().toISOString(),
        batch: a.batch,
        status: a.status,
      })),
    };

    // Calculate Fees Summary & History
    const pendingFee = feeRecords.find(
      (f) => f.status === "Pending" || f.status === "Verification Pending"
    );
    const pendingAmount = pendingFee ? Number(pendingFee.amountDue) || 0 : 0;
    const dueDate = pendingFee?.dueDate
      ? new Date(pendingFee.dueDate).toISOString()
      : null;
    const daysLate = calculateDaysLate(dueDate);

    const fees = {
      feeId: pendingFee ? String(pendingFee._id) : null,
      amountDue: pendingAmount,
      pendingAmount,
      dueDate,
      daysLate,
      status: pendingFee ? pendingFee.status : "Paid",
      utrNumber: pendingFee?.utrNumber || "",
      month: pendingFee?.month || "Current Cycle",
      history: feeRecords.map((f) => ({
        id: String(f._id),
        month: f.month,
        title: f.title || f.month,
        amountDue: f.amountDue,
        dueDate: f.dueDate ? new Date(f.dueDate).toISOString() : null,
        status: f.status,
        utrNumber: f.utrNumber,
        receiptNumber: f.receiptNumber || "",
        paymentDate: f.paymentDate
          ? new Date(f.paymentDate).toISOString()
          : null,
        paidDate: f.paidDate
          ? new Date(f.paidDate).toISOString()
          : f.paymentDate
          ? new Date(f.paymentDate).toISOString()
          : null,
        paidAt: f.paidAt ? new Date(f.paidAt).toISOString() : null,
        paymentMode: f.paymentMode || "Manual/Cash",
        createdAt: f.createdAt ? new Date(f.createdAt).toISOString() : null,
      })),
    };

    // Extract student's specific test marks and ranking
    const testResults = testsList.map((test) => {
      const resultEntry = (test.results || []).find(
        (r: any) => String(r.studentId) === String(studentObjectId)
      );

      const marksObtained = resultEntry ? Number(resultEntry.marksObtained) || 0 : 0;
      const isAbsent = Boolean(resultEntry?.isAbsent);
      const percentage =
        test.maxMarks > 0
          ? Math.round((marksObtained / test.maxMarks) * 100)
          : 0;

      return {
        id: String(test._id),
        title: test.title,
        batch: test.batch,
        date: test.date ? new Date(test.date).toISOString() : new Date().toISOString(),
        maxMarks: test.maxMarks,
        marksObtained,
        isAbsent,
        percentage,
      };
    });

    // Center details
    const center = centerDoc
      ? {
          name: centerDoc.name,
          ownerName: centerDoc.ownerName,
          phone: centerDoc.phone,
          upiId: centerDoc.upiId || "9876543210@paytm",
        }
      : {
          name: "Tuition Center",
          ownerName: "Center Head",
          phone: "9876543210",
          upiId: "9876543210@paytm",
        };

    // 4. Return consolidated JSON payload
    return NextResponse.json(
      {
        success: true,
        data: {
          student: {
            _id: String(student._id),
            centerId: student.centerId,
            name: student.name,
            batch: student.batch,
            parentWhatsApp: student.parentWhatsApp,
            isActive: student.isActive,
            monthlyFee: student.monthlyFee,
            billingCycleDate: student.billingCycleDate,
            joiningDate: student.joiningDate,
          },
          center,
          attendanceStats,
          fees,
          testResults,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : "Failed to load parent portal data";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
