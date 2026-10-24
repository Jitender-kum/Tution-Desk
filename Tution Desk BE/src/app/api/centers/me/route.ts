import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Center from "@/models/Center";
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "GET, OPTIONS");
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const centerId = await getAuthenticatedCenterId(request);

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401, headers: corsHeaders }
      );
    }

    const center = await Center.findOne({ centerId: String(centerId).trim() });

    if (!center) {
      return NextResponse.json(
        { success: false, error: "Center not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        center: {
          name: center.name,
          ownerName: center.ownerName,
          centerId: center.centerId,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : "Failed to fetch center profile";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
