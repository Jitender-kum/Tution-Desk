import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import "@/models/Student"; // Register Student model for population
import { getAuthenticatedCenterId } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const body = await request.json();
    const targetCenterId = authCenterId || body.centerId;

    if (!targetCenterId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId is required" },
        { status: 400 }
      );
    }

    const newFee = await Fee.create({
      ...body,
      centerId: targetCenterId,
    });

    return NextResponse.json(
      { success: true, data: newFee },
      { status: 201 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create fee record";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = request.nextUrl;
    const authCenterId = await getAuthenticatedCenterId(request);
    const centerId = authCenterId || searchParams.get("centerId");

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId query parameter is required" },
        { status: 400 }
      );
    }

    const filter: Record<string, unknown> = { centerId };
    const studentId = searchParams.get("studentId");
    const month = searchParams.get("month");
    const status = searchParams.get("status");

    if (studentId) filter.studentId = studentId;
    if (month) filter.month = month;
    if (status) {
      if (status.includes(",")) {
        filter.status = { $in: status.split(",").map((s) => s.trim()) };
      } else {
        filter.status = status;
      }
    }

    const fees = await Fee.find(filter)
      .populate("studentId")
      .sort({ createdAt: -1 });

    return NextResponse.json(
      { success: true, data: fees },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch fee records";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
