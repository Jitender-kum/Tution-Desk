import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import Attendance from "@/models/Attendance";
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "GET, OPTIONS");
}

export interface SmartAlert {
  id: string;
  type: "warning" | "error" | "info" | "success";
  title: string;
  message: string;
  link?: string;
  time: string;
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const centerId =
      authCenterId ||
      request.headers.get("x-center-id") ||
      request.nextUrl.searchParams.get("centerId");

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId is required" },
        { status: 401, headers: corsHeaders }
      );
    }

    const cleanCenterId = String(centerId).trim();
    const alerts: SmartAlert[] = [];

    // 1. Alert for Overdue Fees
    const overdueCount = await Fee.countDocuments({
      centerId: cleanCenterId,
      status: "Pending",
    });

    if (overdueCount > 0) {
      alerts.push({
        id: "alert-overdue-fees",
        type: "warning",
        title: "Overdue Fees Pending",
        message: `You have ${overdueCount} overdue fee${
          overdueCount > 1 ? "s" : ""
        } pending collection.`,
        link: "/fees",
        time: "Action Required",
      });
    }

    // 2. Alert for WhatsApp Microservice Status
    let isWhatsappConnected = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const waRes = await fetch(
        `http://localhost:3005/status/${cleanCenterId}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      const waData = await waRes.json().catch(() => null);
      isWhatsappConnected = waData?.status === "connected";
    } catch {
      isWhatsappConnected = false;
    }

    if (!isWhatsappConnected) {
      alerts.push({
        id: "alert-whatsapp-disconnected",
        type: "error",
        title: "WhatsApp Offline",
        message: "WhatsApp Engine is disconnected. Scan QR to reconnect.",
        link: "/settings",
        time: "Engine Alert",
      });
    } else {
      alerts.push({
        id: "alert-whatsapp-online",
        type: "success",
        title: "WhatsApp Active",
        message: "Engine is linked and actively sending automated messages.",
        link: "/settings",
        time: "Connected",
      });
    }

    // 3. Alert for Today's Attendance
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todayAttendanceCount = await Attendance.countDocuments({
      centerId: cleanCenterId,
      date: { $gte: startOfDay, $lte: endOfDay },
    });

    if (todayAttendanceCount === 0) {
      alerts.push({
        id: "alert-daily-attendance",
        type: "info",
        title: "Mark Daily Attendance",
        message: "Today's batch attendance has not been recorded yet.",
        link: "/attendance",
        time: "Today",
      });
    }

    const unreadCount = alerts.filter(
      (a) => a.type === "warning" || a.type === "error"
    ).length;

    return NextResponse.json(
      {
        success: true,
        alerts,
        unreadCount,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate alerts";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}
