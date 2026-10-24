import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const studentId = searchParams.get("studentId");
    const token = request.cookies.get("parent_token")?.value;

    if (!token || !studentId) {
      return NextResponse.json(
        { success: false, verified: false },
        { status: 200 }
      );
    }

    const payload = await verifyToken<{
      studentId: string;
      centerId: string;
      role: string;
    }>(token);

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

    return NextResponse.json(
      {
        success: true,
        verified: true,
        studentId: payload.studentId,
        centerId: payload.centerId,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { success: false, verified: false },
      { status: 200 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

    const res = await fetch(`${backendUrl}/auth/parent-verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      return NextResponse.json(
        {
          success: false,
          error: data.error || "Parent verification failed.",
        },
        { status: res.status }
      );
    }

    const response = NextResponse.json(
      {
        success: true,
        studentId: data.studentId,
        studentName: data.studentName,
        batch: data.batch,
        centerId: data.centerId,
        token: data.token,
      },
      { status: 200 }
    );

    // Set parent_token cookie on frontend origin
    if (data.token) {
      response.cookies.set({
        name: "parent_token",
        value: data.token,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return response;
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Verification service failed";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
