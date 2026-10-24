import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Center from "@/models/Center";
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

const DEFAULT_WELCOME_TEMPLATE =
  "Welcome to our center! 🎉\n\nDear Parent, your child {{studentName}} has been successfully enrolled.\nTrack their daily attendance, view performance, and pay fees seamlessly using your personalized VIP portal:\n🔗 {{magicLink}}\n\nNo app installation required.";

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

    return NextResponse.json(
      {
        success: true,
        data: {
          centerId: center.centerId,
          name: center.name,
          welcomeMessageTemplate:
            center.welcomeMessageTemplate || DEFAULT_WELCOME_TEMPLATE,
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
    const { centerId, welcomeMessageTemplate, upiId } = body;
    const headerCenterId = request.headers.get("x-center-id");

    const targetCenterId = authCenterId || centerId || headerCenterId;

    if (!targetCenterId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const updateFields: Record<string, unknown> = {};

    if (typeof welcomeMessageTemplate === "string") {
      updateFields.welcomeMessageTemplate = welcomeMessageTemplate.trim();
    }

    if (typeof upiId === "string") {
      updateFields.upiId = upiId.trim();
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "At least one setting (welcomeMessageTemplate or upiId) is required",
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

    return NextResponse.json(
      {
        success: true,
        message: "Settings updated successfully",
        data: {
          centerId: updatedCenter.centerId,
          name: updatedCenter.name,
          welcomeMessageTemplate: updatedCenter.welcomeMessageTemplate,
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
