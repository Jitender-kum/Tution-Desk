import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public access to /login, /api/*, /p/*, _next static files
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/p/") ||
    pathname === "/login" ||
    pathname.startsWith("/_next") ||
    pathname.includes(".") ||
    pathname === "/favicon.ico"
  ) {
    // If logged-in owner visits /login, redirect to dashboard
    if (pathname === "/login") {
      const token = request.cookies.get("auth_token")?.value;
      if (token) {
        const payload = await verifyToken<{ role: string }>(token);
        if (payload && payload.role === "owner") {
          return NextResponse.redirect(new URL("/", request.url));
        }
      }
    }
    return NextResponse.next();
  }

  // 2. Protect Owner Routes (/, /attendance, /fees, /tests)
  const token = request.cookies.get("auth_token")?.value;

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Verify JWT
  const payload = await verifyToken<{ role: string; centerId: string }>(token);
  if (!payload || payload.role !== "owner" || !payload.centerId) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("auth_token");
    response.cookies.delete("center_id");
    return response;
  }

  const response = NextResponse.next();
  response.headers.set("x-center-id", payload.centerId);

  // Synchronize client-readable center_id cookie with verified JWT payload
  if (request.cookies.get("center_id")?.value !== payload.centerId) {
    response.cookies.set({
      name: "center_id",
      value: payload.centerId,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
