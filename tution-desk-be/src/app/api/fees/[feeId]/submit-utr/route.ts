import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import "@/models/Student"; // Register Student model for population
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "PUT, OPTIONS");
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

    const body = await request.json().catch(() => ({}));
    const { utrNumber, fallbackClaim } = body;

    const isFallback = Boolean(fallbackClaim || body.isDelayedFallback);
    let cleanUtr = typeof utrNumber === "string" ? utrNumber.trim() : "";

    if (!cleanUtr && isFallback) {
      cleanUtr = `CLAIM_DELAYED_${Date.now().toString().slice(-6)}`;
    } else if (!cleanUtr) {
      return NextResponse.json(
        {
          success: false,
          error: "Please enter a valid 12-digit UTR / Reference number or submit fallback claim",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Update Fee document: set status = 'Verification Pending', store utrNumber, and set paymentDate = new Date()
    const updatedFee = await Fee.findByIdAndUpdate(
      feeId,
      {
        $set: {
          status: "Verification Pending",
          utrNumber: cleanUtr,
          paymentDate: new Date(),
          paidDate: new Date(),
          paymentMode: "Online/UPI",
        },
      },
      { new: true }
    ).populate("studentId");

    if (!updatedFee) {
      return NextResponse.json(
        { success: false, error: "Fee record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "UTR submitted successfully. Verification pending with center admin.",
        data: updatedFee,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to submit UTR reference";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}
