import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

    const res = await fetch(`${backendUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      return NextResponse.json(
        { success: false, error: data.error || "Login failed" },
        { status: res.status }
      );
    }

    const response = NextResponse.json(
      {
        success: true,
        center: data.center,
        token: data.token,
      },
      { status: 200 }
    );

    if (data.token) {
      response.cookies.set({
        name: "auth_token",
        value: data.token,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });

      if (data.center?.centerId) {
        response.cookies.set({
          name: "center_id",
          value: data.center.centerId,
          httpOnly: false,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
        });
      }
    }

    return response;
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Authentication service failed";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
