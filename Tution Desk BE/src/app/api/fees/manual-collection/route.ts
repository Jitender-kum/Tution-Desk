import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import Student from "@/models/Student";
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "POST, OPTIONS");
}

function generateReceiptNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RCPT-${random}`;
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const body = await request.json().catch(() => ({}));
    const { studentId, centerId, amount, type, notes } = body;

    // 1. Validate studentId
    if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
      return NextResponse.json(
        { success: false, error: "A valid studentId is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. Validate amount
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: "Payment amount must be greater than 0" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 3. Look up student record
    const studentDoc = await Student.findById(studentId);
    if (!studentDoc) {
      return NextResponse.json(
        { success: false, error: "Student record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // 4. Resolve centerId
    let targetCenterId = centerId ? String(centerId).trim() : null;
    if (!targetCenterId) {
      const authCenterId = await getAuthenticatedCenterId(request);
      targetCenterId =
        authCenterId ||
        request.headers.get("x-center-id") ||
        studentDoc.centerId;
    }

    // 5. Determine fee details
    const isAdvance =
      String(type || "").toLowerCase().includes("advance") ||
      String(notes || "").toLowerCase().includes("advance");

    const now = new Date();
    const currentMonthName = now.toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });

    const feeTitle = isAdvance
      ? notes?.trim() || "Advance Fee Payment"
      : notes?.trim() || `Regular Monthly Fee (${currentMonthName})`;

    const monthString = isAdvance
      ? `Advance - ${currentMonthName}`
      : currentMonthName;

    const receiptNumber = generateReceiptNumber();

    // 6. Create the Fee record set to 'Paid' via 'Cash'
    const manualFee = await Fee.create({
      centerId: targetCenterId,
      studentId: new mongoose.Types.ObjectId(studentId),
      month: monthString,
      title: feeTitle,
      amountDue: parsedAmount,
      paidAmount: parsedAmount,
      dueDate: now,
      status: "Paid",
      paymentMode: "Cash",
      isAdvance: isAdvance,
      notes: notes ? String(notes).trim() : "",
      receiptNumber: receiptNumber,
      paidDate: now,
      paidAt: now,
      paymentDate: now,
    });

    const populatedFee = await Fee.findById(manualFee._id).populate("studentId");

    return NextResponse.json(
      {
        success: true,
        message: `Offline cash payment of ₹${parsedAmount} recorded successfully (Receipt: ${receiptNumber})`,
        data: populatedFee,
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to record manual cash payment";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
