import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Test from "@/models/Test";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const { id } = resolvedParams;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Test ID is required" },
        { status: 400 }
      );
    }

    const test = await Test.findById(id);
    if (!test) {
      return NextResponse.json(
        { success: false, error: "Test not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, data: test },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch test";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const { id } = resolvedParams;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Test ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.results !== undefined && Array.isArray(body.results)) {
      updateData.results = body.results;
    }
    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.batch !== undefined) updateData.batch = body.batch.trim();
    if (body.date !== undefined) updateData.date = new Date(body.date);
    if (body.maxMarks !== undefined) updateData.maxMarks = Number(body.maxMarks);

    const updatedTest = await Test.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedTest) {
      return NextResponse.json(
        { success: false, error: "Test not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, data: updatedTest },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to update test";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
