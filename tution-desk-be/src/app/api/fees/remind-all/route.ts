import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import "@/models/Student"; // Register Student model for population
import { getAuthenticatedCenterId } from "@/lib/auth";
import { sendFeeReminder } from "@/lib/whatsappService";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

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

    // Fetch all fees where status === 'Pending' for this centerId, populate studentId
    const pendingFees = await Fee.find({
      centerId: cleanCenterId,
      status: "Pending",
    }).populate("studentId");

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "http://localhost:3000";

    let sentCount = 0;
    let simulatedCount = 0;
    const dispatchResults = [];

    // Loop through the pending fees and call sendFeeReminder
    for (const fee of pendingFees) {
      const student = fee.studentId as any;
      if (!student) continue;

      const parentPhone = student.parentWhatsApp;
      const studentName = student.name || "Student";
      const amountDue = fee.amountDue || 0;
      const formattedDueDate = fee.dueDate
        ? new Date(fee.dueDate).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "Immediate";
      const magicLink = student._id ? `${appUrl}/p/${student._id}` : "";

      if (parentPhone) {
        try {
          const res = await sendFeeReminder(
            cleanCenterId,
            parentPhone,
            studentName,
            amountDue,
            formattedDueDate,
            magicLink
          );

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
            simulated: res.simulated,
            accepted: res.accepted,
            delivered: res.delivered,
            error: res.error,
          });
        } catch (err) {
          console.error(
            `[REMIND-ALL ERROR] Failed sending to parent of ${studentName}:`,
            err
          );
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
