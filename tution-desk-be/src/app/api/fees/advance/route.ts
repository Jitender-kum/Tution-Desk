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

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const body = await request.json().catch(() => ({}));
    const { studentId, centerId, amount, utrNumber } = body;

    // Validate studentId
    if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
      return NextResponse.json(
        { success: false, error: "Valid studentId is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate amount
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: "Advance amount must be greater than 0" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate or default utrNumber for advance payment
    const trimmedUtr =
      String(utrNumber || "").trim() ||
      `ADV_INIT_${Date.now().toString().slice(-6)}`;

    // Determine target centerId
    let targetCenterId = centerId ? String(centerId).trim() : null;
    if (!targetCenterId) {
      const authCenterId = await getAuthenticatedCenterId(request);
      targetCenterId = authCenterId || request.headers.get("x-center-id");
    }

    // Lookup student to get centerId if still missing
    const studentDoc = await Student.findById(studentId);
    if (!studentDoc) {
      return NextResponse.json(
        { success: false, error: "Student record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    if (!targetCenterId) {
      targetCenterId = studentDoc.centerId;
    }

    // Create the new Advance Fee record
    const advanceFee = await Fee.create({
      centerId: targetCenterId,
      studentId: new mongoose.Types.ObjectId(studentId),
      month: "Advance Fee Payment",
      title: "Advance Fee Payment",
      amountDue: parsedAmount,
      dueDate: new Date(),
      status: "Verification Pending",
      paymentMode: "Online/UPI",
      utrNumber: trimmedUtr,
      paymentDate: new Date(),
    });

    const populatedFee = await Fee.findById(advanceFee._id).populate("studentId");

    return NextResponse.json(
      {
        success: true,
        message: "Advance fee submitted successfully for verification",
        data: populatedFee,
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to record advance fee payment";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
