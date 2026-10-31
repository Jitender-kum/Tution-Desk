import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import "@/models/Student"; // Register Student model for population
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { dispatchFeeReminder } from "@/lib/reminderService";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "POST, OPTIONS");
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

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

    // Fetch all fees where status is 'Pending' or 'Partial Paid' with remaining due for this centerId, populate studentId
    const pendingFees = await Fee.find({
      centerId: cleanCenterId,
      status: { $in: ["Pending", "Partial Paid"] },
      amountDue: { $gt: 0 },
    }).populate("studentId");

    let sentCount = 0;
    let simulatedCount = 0;
    const dispatchResults = [];

    // Loop through the pending fees and call dispatchFeeReminder
    for (const fee of pendingFees) {
      const student = fee.studentId as any;
      if (!student) continue;

      // Inactive students are strictly excluded from automated bulk reminders
      if (student.isActive === false) continue;
      if (fee.reminderPaused) continue;

      const parentPhone = student.parentWhatsApp;
      const studentName = student.name || "Student";

      if (parentPhone) {
        try {
          const res = await dispatchFeeReminder({
            feeId: fee._id,
            centerId: cleanCenterId,
            triggerType: "manual_owner_bulk",
            forceOverride: Boolean(body.forceOverride),
            overrideReason: body.overrideReason,
          });

          if (res.success && !res.simulated) {
            sentCount++;
          } else if (res.simulated) {
            simulatedCount++;
          }

          dispatchResults.push({
            feeId: String(fee._id),
            studentName,
            phone: parentPhone,
            success: res.success,
            simulated: Boolean(res.simulated),
            status: res.status,
            accepted: res.status === "provider_accepted",
            delivered: false, // Never falsely report provider acceptance as confirmed delivery
            error: res.message,
            code: res.code,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : "Dispatch error";
          console.error(
            `[REMIND-ALL ERROR] Failed sending to parent of ${studentName}:`,
            err
          );
          dispatchResults.push({
            feeId: String(fee._id),
            studentName,
            phone: parentPhone,
            success: false,
            simulated: false,
            accepted: false,
            delivered: false,
            error: errMsg,
          });
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        sentCount,
        simulatedCount,
        totalPending: pendingFees.length,
        results: dispatchResults,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to dispatch bulk fee reminders";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}
