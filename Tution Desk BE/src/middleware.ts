import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";

/**
 * Universal CORS and Preflight middleware for Backend API routes.
 * Dynamically validates incoming Origin against ALLOWED_ORIGINS (including dev and staging).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to /api/ routes
  if (pathname.startsWith("/api")) {
    // Exempt webhooks (e.g. payment gateway) from strict origin validation
    if (pathname.startsWith("/api/webhooks")) {
      return NextResponse.next();
    }

    // Handle CORS preflight OPTIONS requests dynamically
    if (request.method === "OPTIONS") {
      return handleCorsPreflight(
        request,
        "GET, POST, PUT, DELETE, PATCH, OPTIONS"
      );
    }

    // Process downstream route and attach dynamic CORS response headers
    const response = NextResponse.next();
    const corsHeaders = getCorsHeaders(request);
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
