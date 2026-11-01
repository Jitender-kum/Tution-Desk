import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Center from "@/models/Center";
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

import {
  DEFAULT_ADMISSION_TEMPLATE,
  DEFAULT_FEE_REMINDER_TEMPLATE,
  DEFAULT_PAYMENT_RECEIPT_TEMPLATE,
  IMessagingTemplates,
} from "@/models/Center";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "GET, PUT, OPTIONS");
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const queryCenterId = request.nextUrl.searchParams.get("centerId");
    const headerCenterId = request.headers.get("x-center-id");

    const targetCenterId = authCenterId || queryCenterId || headerCenterId;

    if (!targetCenterId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const center = await Center.findOne({ centerId: String(targetCenterId).trim() });

    if (!center) {
      return NextResponse.json(
        { success: false, error: "Center not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const admissionTemplate =
      center.messagingTemplates?.admission ||
      center.welcomeMessageTemplate ||
      DEFAULT_ADMISSION_TEMPLATE;
    const feeReminderTemplate =
      center.messagingTemplates?.feeReminder ||
      DEFAULT_FEE_REMINDER_TEMPLATE;
    const paymentReceiptTemplate =
      center.messagingTemplates?.paymentReceipt ||
      DEFAULT_PAYMENT_RECEIPT_TEMPLATE;

    return NextResponse.json(
      {
        success: true,
        data: {
          centerId: center.centerId,
          name: center.name,
          welcomeMessageTemplate: admissionTemplate,
          messagingTemplates: {
            admission: admissionTemplate,
            feeReminder: feeReminderTemplate,
            paymentReceipt: paymentReceiptTemplate,
          },
          upiId: center.upiId || "",
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to fetch center settings";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function PUT(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const body = await request.json().catch(() => ({}));
    const { centerId, welcomeMessageTemplate, messagingTemplates, upiId } = body;
    const headerCenterId = request.headers.get("x-center-id");

    let targetCenterId = authCenterId;

    if (!targetCenterId) {
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { success: false, error: "Authentication required to update center settings" },
          { status: 401, headers: corsHeaders }
        );
      }
      targetCenterId = centerId || headerCenterId;
    }

    if (!targetCenterId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId is required" },
        { status: 401, headers: corsHeaders }
      );
    }

    const updateFields: Record<string, unknown> = {};

    // 1. Process messagingTemplates nested object
    if (messagingTemplates && typeof messagingTemplates === "object") {
      const templates = messagingTemplates as IMessagingTemplates;
      if (typeof templates.admission === "string") {
        updateFields["messagingTemplates.admission"] = templates.admission.trim();
        // Keep legacy welcomeMessageTemplate in sync for backward compatibility
        updateFields.welcomeMessageTemplate = templates.admission.trim();
      }
      if (typeof templates.feeReminder === "string") {
        updateFields["messagingTemplates.feeReminder"] = templates.feeReminder.trim();
      }
      if (typeof templates.paymentReceipt === "string") {
        updateFields["messagingTemplates.paymentReceipt"] = templates.paymentReceipt.trim();
      }
    }

    // 2. Process legacy welcomeMessageTemplate if provided independently
    if (typeof welcomeMessageTemplate === "string" && !updateFields["messagingTemplates.admission"]) {
      const trimmedWelcome = welcomeMessageTemplate.trim();
      updateFields.welcomeMessageTemplate = trimmedWelcome;
      updateFields["messagingTemplates.admission"] = trimmedWelcome;
    }

    // 3. Process UPI ID
    if (typeof upiId === "string") {
      updateFields.upiId = upiId.trim();
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "At least one setting (messagingTemplates, welcomeMessageTemplate, or upiId) is required",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const updatedCenter = await Center.findOneAndUpdate(
      { centerId: String(targetCenterId).trim() },
      { $set: updateFields },
      { new: true }
    );

    if (!updatedCenter) {
      return NextResponse.json(
        { success: false, error: "Center not found to update" },
        { status: 404, headers: corsHeaders }
      );
    }

    const resolvedAdmission =
      updatedCenter.messagingTemplates?.admission ||
      updatedCenter.welcomeMessageTemplate ||
      DEFAULT_ADMISSION_TEMPLATE;
    const resolvedFeeReminder =
      updatedCenter.messagingTemplates?.feeReminder ||
      DEFAULT_FEE_REMINDER_TEMPLATE;
    const resolvedPaymentReceipt =
      updatedCenter.messagingTemplates?.paymentReceipt ||
      DEFAULT_PAYMENT_RECEIPT_TEMPLATE;

    return NextResponse.json(
      {
        success: true,
        message: "Settings updated successfully",
        data: {
          centerId: updatedCenter.centerId,
          name: updatedCenter.name,
          welcomeMessageTemplate: resolvedAdmission,
          messagingTemplates: {
            admission: resolvedAdmission,
            feeReminder: resolvedFeeReminder,
            paymentReceipt: resolvedPaymentReceipt,
          },
          upiId: updatedCenter.upiId || "",
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to update center settings";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
