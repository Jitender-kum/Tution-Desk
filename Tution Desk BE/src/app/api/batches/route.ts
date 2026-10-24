import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Batch from "@/models/Batch";
import { getAuthenticatedCenterId } from "@/lib/auth";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const body = await request.json();
    const { centerId, name, timing, subject } = body;

    const targetCenterId = authCenterId || centerId;

    if (!targetCenterId || !name) {
      return NextResponse.json(
        { success: false, error: "centerId and batch name are required" },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();

    // Check if batch already exists for this center
    const existing = await Batch.findOne({ centerId: targetCenterId, name: trimmedName });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "A batch with this name already exists" },
        { status: 409 }
      );
    }

    const newBatch = await Batch.create({
      centerId: targetCenterId,
      name: trimmedName,
      timing: timing ? timing.trim() : undefined,
      subject: subject ? subject.trim() : undefined,
      isActive: true,
    });

    return NextResponse.json(
      { success: true, data: newBatch },
      { status: 201 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create batch";

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

    const batches = await Batch.find({ centerId, isActive: { $ne: false } }).sort({
      createdAt: -1,
    });

    return NextResponse.json(
      { success: true, data: batches },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch batches";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
