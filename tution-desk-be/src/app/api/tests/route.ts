import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Test from "@/models/Test";
import { getAuthenticatedCenterId } from "@/lib/auth";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
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
    const batch = searchParams.get("batch");
    if (batch) {
      filter.batch = batch;
    }

    const tests = await Test.find(filter).sort({ date: -1, createdAt: -1 });

    return NextResponse.json(
      { success: true, data: tests },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch tests";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const body = await request.json();
    const { centerId, title, batch, date, maxMarks, results } = body;
    const targetCenterId = authCenterId || centerId;

    if (!targetCenterId || !title || !batch) {
      return NextResponse.json(
        { success: false, error: "centerId, title, and batch are required" },
        { status: 400 }
      );
    }

    const parsedMaxMarks = Number(maxMarks);
    if (isNaN(parsedMaxMarks) || parsedMaxMarks < 1) {
      return NextResponse.json(
        { success: false, error: "maxMarks must be a positive number" },
        { status: 400 }
      );
    }

    const newTest = await Test.create({
      centerId: targetCenterId,
      title: title.trim(),
      batch: batch.trim(),
      date: date ? new Date(date) : new Date(),
      maxMarks: parsedMaxMarks,
      results: Array.isArray(results) ? results : [],
    });

    return NextResponse.json(
      { success: true, data: newTest },
      { status: 201 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create test";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
