import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { dispatchFeeReminder } from "@/lib/reminderService";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "POST, OPTIONS");
}

export async function POST(
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
    const centerId =
      authCenterId ||
      body.centerId ||
      request.headers.get("x-center-id") ||
      request.nextUrl.searchParams.get("centerId");

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId is required" },
        { status: 401, headers: corsHeaders }
      );
    }

    const cleanCenterId = String(centerId).trim();

    const result = await dispatchFeeReminder({
      feeId,
      centerId: cleanCenterId,
      triggerType: "manual_owner_single",
      forceOverride: Boolean(body.forceOverride),
      overrideReason: body.overrideReason,
    });

    if (result.code === "COOLDOWN_ACTIVE") {
      return NextResponse.json(
        {
          success: false,
          code: "COOLDOWN_ACTIVE",
          error: result.message,
        },
        { status: 409, headers: corsHeaders }
      );
    }

    if (result.code === "DISPATCH_UNCERTAIN") {
      return NextResponse.json(
        {
          success: false,
          code: "DISPATCH_UNCERTAIN",
          message: result.message,
          retryLockUntil: result.retryLockUntil,
        },
        { status: 202, headers: corsHeaders }
      );
    }

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          code: result.code || "REMINDER_FAILED",
          error: result.message || "Failed to dispatch fee reminder",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        status: result.status,
        providerMessageId: result.providerMessageId,
        simulated: result.simulated,
        message: result.simulated
          ? "Simulated fee reminder dispatched (simulation mode)"
          : "Fee reminder dispatched to WhatsApp provider successfully",
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to process reminder request";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
