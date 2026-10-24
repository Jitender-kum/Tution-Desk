import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import "@/models/Student"; // Register Student model for population
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "PUT, GET, DELETE, OPTIONS");
}

function generateReceiptNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RCPT-${random}`;
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ feeId: string }> | { feeId: string } }
) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const { feeId } = await context.params;

    if (!feeId || !mongoose.Types.ObjectId.isValid(feeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid fee ID" },
        { status: 400, headers: corsHeaders }
      );
    }

    const authCenterId = await getAuthenticatedCenterId(request);
    const body = await request.json().catch(() => ({}));
    const targetCenterId =
      authCenterId ||
      body.centerId ||
      request.headers.get("x-center-id") ||
      request.nextUrl.searchParams.get("centerId");

    const query: Record<string, unknown> = { _id: feeId };
    if (targetCenterId) {
      query.centerId = String(targetCenterId).trim();
    }

    // Find the fee record
    const existingFee = await Fee.findOne(query);

    if (!existingFee) {
      return NextResponse.json(
        { success: false, error: "Fee record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const now = new Date();
    const paymentMode = body.paymentMode || "Cash";
    const isCash = String(paymentMode).toLowerCase().includes("cash");

    // Generate receipt number for cash or when missing
    const receiptNumber =
      existingFee.receiptNumber ||
      body.receiptNumber ||
      generateReceiptNumber();

    existingFee.status = (body.status as any) || "Paid";
    existingFee.paymentMode = paymentMode;
    existingFee.paidDate = now;
    existingFee.paidAt = now;
    existingFee.paymentDate = now;
    existingFee.receiptNumber = receiptNumber;

    if (body.paidAmount !== undefined) {
      existingFee.paidAmount = Number(body.paidAmount);
    } else if (!existingFee.paidAmount || existingFee.paidAmount === 0) {
      existingFee.paidAmount = existingFee.amountDue;
    }

    await existingFee.save();
    await existingFee.populate("studentId");

    return NextResponse.json(
      {
        success: true,
        message: `Fee marked as ${existingFee.status} via ${paymentMode}`,
        data: existingFee,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to update fee record";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ feeId: string }> | { feeId: string } }
) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const { feeId } = await context.params;

    if (!feeId || !mongoose.Types.ObjectId.isValid(feeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid fee ID" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Lightweight query: project all payment & receipt fields
    const fee = await Fee.findById(feeId)
      .select("status amountDue paidAmount upiTransactionId paymentMode receiptNumber paidAt paidDate")
      .lean();

    if (!fee) {
      return NextResponse.json(
        { success: false, error: "Fee record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          _id: fee._id,
          status: fee.status,
          amountDue: fee.amountDue,
          paidAmount: fee.paidAmount,
          upiTransactionId: fee.upiTransactionId,
          paymentMode: fee.paymentMode,
          receiptNumber: fee.receiptNumber,
          paidAt: fee.paidAt,
          paidDate: fee.paidDate,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch fee status";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ feeId: string }> | { feeId: string } }
) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const { feeId } = await context.params;

    if (!feeId || !mongoose.Types.ObjectId.isValid(feeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid fee ID" },
        { status: 400, headers: corsHeaders }
      );
    }

    const authCenterId = await getAuthenticatedCenterId(request);
    const targetCenterId =
      authCenterId ||
      request.headers.get("x-center-id") ||
      request.nextUrl.searchParams.get("centerId");

    const query: Record<string, unknown> = { _id: feeId };
    if (targetCenterId) {
      query.centerId = String(targetCenterId).trim();
    }

    const deletedFee = await Fee.findOneAndDelete(query);

    if (!deletedFee) {
      return NextResponse.json(
        { success: false, error: "Fee record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Fee record deleted successfully",
        data: { feeId: deletedFee._id },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete fee record";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}

