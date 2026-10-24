import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function GET(request: NextRequest) {
  try {
    const token =
      request.cookies.get("auth_token")?.value ||
      request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const payload = await verifyToken<{ role: string; centerId: string }>(token);

    if (!payload || !payload.centerId) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Fetch center document from backend
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

    try {
      const beRes = await fetch(`${backendUrl}/centers/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-center-id": payload.centerId,
          cookie: request.headers.get("cookie") || `auth_token=${token}`,
        },
        cache: "no-store",
      });

      if (beRes.ok) {
        const beData = await beRes.json();
        if (beData?.success && beData?.center) {
          return NextResponse.json({
            success: true,
            center: beData.center,
            role: payload.role,
          });
        }
      }
    } catch {
      // Backend unreachable fallback
    }

    return NextResponse.json({
      success: true,
      center: {
        centerId: payload.centerId,
        name: payload.centerId,
        ownerName: "Owner",
      },
      role: payload.role,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Authentication error",
      },
      { status: 500 }
    );
  }
}
