import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { getAuthenticatedCenterId } from "@/lib/auth";
import Student from "@/models/Student";
import Batch from "@/models/Batch";
import Fee from "@/models/Fee";
import Attendance from "@/models/Attendance";
import Test from "@/models/Test";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "GET, OPTIONS");
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    // 1. Extract centerId from verified session (cookie, bearer token, or headers/params fallback)
    const verifiedCenterId = await getAuthenticatedCenterId(request);
    const centerId =
      verifiedCenterId ||
      request.nextUrl.searchParams.get("centerId") ||
      request.headers.get("x-center-id");

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "Authentication required to access dashboard" },
        { status: 401, headers: corsHeaders }
      );
    }

    const trimmedCenterId = String(centerId).trim();

    // Today's date boundary
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 2. Run concurrent MongoDB queries using Promise.all
    const [
      totalStudents,
      totalBatches,
      pendingFeeAgg,
      overdueCount,
      todayAttendance,
      todayPresentCount,
      collectedFeeAgg,
      pendingTestsCount,
      batchesList,
      recentFees,
      recentStudents,
    ] = await Promise.all([
      // Count of active students in this center
      Student.countDocuments({
        centerId: trimmedCenterId,
        isActive: { $ne: false },
      }),

      // Count of active batches
      Batch.countDocuments({
        centerId: trimmedCenterId,
        isActive: { $ne: false },
      }),

      // Sum of amountDue from Fee model where status is 'Pending'
      Fee.aggregate<{ _id: null; total: number }>([
        { $match: { centerId: trimmedCenterId, status: "Pending" } },
        { $group: { _id: null, total: { $sum: "$amountDue" } } },
      ]),

      // Count of 'Pending' fee records
      Fee.countDocuments({
        centerId: trimmedCenterId,
        status: "Pending",
      }),

      // Count of attendance records marked for today
      Attendance.countDocuments({
        centerId: trimmedCenterId,
        date: { $gte: startOfDay, $lte: endOfDay },
      }),

      // Count of present attendance records today
      Attendance.countDocuments({
        centerId: trimmedCenterId,
        date: { $gte: startOfDay, $lte: endOfDay },
        status: "Present",
      }),

      // Sum of collected fees
      Fee.aggregate<{ _id: null; total: number }>([
        { $match: { centerId: trimmedCenterId, status: "Paid" } },
        { $group: { _id: null, total: { $sum: "$amountDue" } } },
      ]),

      // Total tests in center
      Test.countDocuments({
        centerId: trimmedCenterId,
      }),

      // Active batches list for schedule
      Batch.find({
        centerId: trimmedCenterId,
        isActive: { $ne: false },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // Recent fees for activity timeline
      Fee.find({ centerId: trimmedCenterId })
        .sort({ createdAt: -1 })
        .limit(6)
        .populate("studentId", "name batch")
        .lean(),

      // Recent students for activity timeline
      Student.find({ centerId: trimmedCenterId })
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

    const pendingFeesTotal = pendingFeeAgg[0]?.total || 0;
    const collectedFeesTotal = collectedFeeAgg[0]?.total || 0;
    const attendanceTodayPercentage =
      todayAttendance > 0
        ? Math.round((todayPresentCount / todayAttendance) * 100)
        : 100;

    // Student counts per batch
    const studentBatchCounts = await Student.aggregate<{
      _id: string;
      count: number;
    }>([
      {
        $match: {
          centerId: trimmedCenterId,
          isActive: { $ne: false },
        },
      },
      {
        $group: {
          _id: "$batch",
          count: { $sum: 1 },
        },
      },
    ]);

    const batchCountMap = new Map<string, number>();
    studentBatchCounts.forEach((b) => {
      if (b._id) batchCountMap.set(b._id, b.count);
    });

    const formattedBatches = batchesList.map((b, idx) => ({
      id: String(b._id),
      batchName: b.name,
      timing: b.timing || "05:00 PM - 06:15 PM",
      subject: b.subject || "Regular Session",
      totalStudents: batchCountMap.get(b.name) || 0,
      markedStudents: 0,
      status: "pending",
      timelineStatus: idx === 0 ? "ongoing" : "upcoming",
    }));

    // Format recent activities
    const feeActivities = recentFees.map((f: any) => ({
      id: `fee_${f._id}`,
      title:
        f.status === "Paid"
          ? `Fee Received: ${f.studentId?.name || "Student"}`
          : `Fee Due: ${f.studentId?.name || "Student"}`,
      subtitle: `${f.month} • ${f.status}`,
      time: f.createdAt ? new Date(f.createdAt).toISOString() : new Date().toISOString(),
      type: "fee",
      amount: f.amountDue,
    }));

    const studentActivities = recentStudents.map((s: any) => ({
      id: `student_${s._id}`,
      title: `Student Enrolled: ${s.name}`,
      subtitle: `${s.batch} • Parent: ${s.parentWhatsApp}`,
      time: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
      type: "enquiry",
    }));

    const recentActivities = [...feeActivities, ...studentActivities]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);

    // 3. Return the aggregated data as JSON
    return NextResponse.json(
      {
        success: true,
        data: {
          totalStudents,
          totalBatches,
          pendingFeesTotal,
          overdueCount,
          todayAttendance,
          todayPresentCount,
          collectedFeesThisMonth: collectedFeesTotal,
          pendingTestsCount,
          attendanceTodayPercentage,
          batches: formattedBatches,
          recentActivities,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : "Failed to load owner dashboard data";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
