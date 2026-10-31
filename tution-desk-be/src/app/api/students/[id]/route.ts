import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Student from "@/models/Student";
import Fee from "@/models/Fee";
import Attendance from "@/models/Attendance";
import Test from "@/models/Test";
import { getAuthenticatedCenterId } from "@/lib/auth";

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
        { success: false, error: "Student ID is required" },
        { status: 400 }
      );
    }

    const student = await Student.findById(id);

    if (!student) {
      return NextResponse.json(
        { success: false, error: "Student not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, data: student },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch student";

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
        { success: false, error: "Student ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.batch !== undefined) updateData.batch = body.batch.trim();
    if (body.parentWhatsApp !== undefined)
      updateData.parentWhatsApp = body.parentWhatsApp.trim();
    if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);
    if (body.joiningDate !== undefined)
      updateData.joiningDate = new Date(body.joiningDate);
    if (body.monthlyFee !== undefined)
      updateData.monthlyFee = Number(body.monthlyFee);
    if (body.billingCycleDate !== undefined)
      updateData.billingCycleDate = Number(body.billingCycleDate);

    const updatedStudent = await Student.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedStudent) {
      return NextResponse.json(
        { success: false, error: "Student not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, data: updatedStudent },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to update student";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const { id } = resolvedParams;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Student ID is required" },
        { status: 400 }
      );
    }

    const student = await Student.findById(id);

    if (!student) {
      return NextResponse.json(
        { success: false, error: "Student not found" },
        { status: 404 }
      );
    }

    const authCenterId = await getAuthenticatedCenterId(request);

    if (!authCenterId) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    if (student.centerId !== authCenterId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: student belongs to another center" },
        { status: 403 }
      );
    }

    // 1. Guard against removing students with unresolved Pending, Verification Pending, or Partial Paid dues
    const unresolvedDuesCount = await Fee.countDocuments({
      studentId: student._id,
      centerId: student.centerId,
      status: { $in: ["Pending", "Verification Pending", "Partial Paid"] },
    });

    if (unresolvedDuesCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot remove student: ${unresolvedDuesCount} active fee obligation(s) exist. Settle or cancel pending dues before removing.`,
          code: "UNRESOLVED_FEES_EXIST",
          unresolvedCount: unresolvedDuesCount,
        },
        { status: 409 }
      );
    }

    // 2. Check if historical fee, attendance, or test records exist
    const [hasFees, hasAttendance, hasTests] = await Promise.all([
      Fee.exists({ studentId: student._id, centerId: student.centerId }),
      Attendance.exists({ studentId: student._id, centerId: student.centerId }),
      Test.exists({ centerId: student.centerId, "results.studentId": student._id }),
    ]);

    const hasHistoricalRecords = Boolean(hasFees || hasAttendance || hasTests);

    if (hasHistoricalRecords) {
      // Soft-deactivate student to preserve receipts, attendance, and academic history
      student.isActive = false;
      await student.save();

      return NextResponse.json(
        {
          success: true,
          action: "deactivated",
          message:
            "Student deactivated and archived. Historical fee receipts, attendance, and test records preserved.",
          data: student,
        },
        { status: 200 }
      );
    }

    // 3. Clean hard-delete if zero historical dependencies exist
    await Student.findByIdAndDelete(id);

    return NextResponse.json(
      {
        success: true,
        action: "deleted",
        message: "Student deleted successfully",
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete student";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
