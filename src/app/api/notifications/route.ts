import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function GET(request: NextRequest) {
  try {
    const token =
      request.cookies.get("auth_token")?.value ||
      request.headers.get("authorization")?.replace("Bearer ", "");

    let centerId = request.headers.get("x-center-id");

    if (token) {
      const payload = await verifyToken<{ role: string; centerId: string }>(
        token
      );
      if (payload?.centerId) {
        centerId = payload.centerId;
      }
    }

    if (!centerId) {
      centerId = request.cookies.get("center_id")?.value || "aroven-001";
    }

    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

    const res = await fetch(
      `${backendUrl}/notifications?centerId=${encodeURIComponent(centerId)}`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "x-center-id": centerId,
          cookie: request.headers.get("cookie") || (token ? `auth_token=${token}` : ""),
        },
        cache: "no-store",
      }
    );

    const data = await res.json().catch(() => null);

    if (res.ok && data) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(
      {
        success: true,
        alerts: [
          {
            id: "default-status",
            type: "info",
            title: "System Ready",
            message: "Tuition Desk is ready for classroom management.",
            time: "Now",
          },
        ],
        unreadCount: 0,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to fetch notifications";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
