import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Attendance from "@/models/Attendance";
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

    const newAttendance = await Attendance.create({
      ...body,
      centerId: targetCenterId,
    });

    return NextResponse.json(
      { success: true, data: newAttendance },
      { status: 201 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create attendance record";

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
    const batch = searchParams.get("batch");
    const studentId = searchParams.get("studentId");
    const date = searchParams.get("date");

    if (batch) filter.batch = batch;
    if (studentId) filter.studentId = studentId;
    if (date) filter.date = new Date(date);

    const attendanceRecords = await Attendance.find(filter)
      .populate("studentId")
      .sort({ date: -1, createdAt: -1 });

    return NextResponse.json(
      { success: true, data: attendanceRecords },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch attendance records";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
