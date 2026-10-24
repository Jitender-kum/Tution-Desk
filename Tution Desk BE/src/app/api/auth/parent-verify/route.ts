import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Student from "@/models/Student";
import { signToken, verifyToken } from "@/lib/jwt";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = request.nextUrl;
    const studentId = searchParams.get("studentId");
    const token = request.cookies.get("parent_token")?.value;

    if (!token || !studentId) {
      return NextResponse.json(
        { success: false, verified: false },
        { status: 200 }
      );
    }

    const payload = await verifyToken<{ studentId: string; role: string }>(token);

    if (
      !payload ||
      payload.role !== "parent" ||
      payload.studentId !== studentId
    ) {
      return NextResponse.json(
        { success: false, verified: false },
        { status: 200 }
      );
    }

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return NextResponse.json(
        { success: false, verified: false },
        { status: 200 }
      );
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return NextResponse.json(
        { success: false, verified: false },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      verified: true,
      student: {
        id: student._id.toString(),
        name: student.name,
        batch: student.batch,
        centerId: student.centerId,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, verified: false },
      { status: 200 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const body = await request.json();
    const { studentId, phone } = body;

    if (!studentId || !phone) {
      return NextResponse.json(
        { success: false, error: "studentId and phone are required." },
        { status: 400 }
      );
    }

    const cleanPhone = String(phone).trim();

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return NextResponse.json(
        { success: false, error: "Invalid student identifier." },
        { status: 400 }
      );
    }

    const student = await Student.findById(studentId);

    if (!student) {
      return NextResponse.json(
        { success: false, error: "Student record not found." },
        { status: 404 }
      );
    }

    // Check if phone matches parentWhatsApp
    if (student.parentWhatsApp.trim() !== cleanPhone) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Phone number does not match the registered WhatsApp number for this student.",
        },
        { status: 401 }
      );
    }

    // Generate JWT
    const token = await signToken({
      studentId: student._id.toString(),
      centerId: student.centerId,
      role: "parent",
    });

    const response = NextResponse.json(
      {
        success: true,
        studentId: student._id.toString(),
        studentName: student.name,
        batch: student.batch,
        centerId: student.centerId,
        token,
      },
      { status: 200 }
    );

    // Set parent_token cookie
    response.cookies.set({
      name: "parent_token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Parent verification error";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
