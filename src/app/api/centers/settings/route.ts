import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/authOwner";

/**
 * Normalizes backend base URL so that it points to the API root
 * and includes '/api' exactly once, whether the configured value
 * has a trailing slash or already ends in '/api'.
 */
function getBackendApiUrl(): string {
  const raw =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3001/api";
  const cleaned = raw.trim().replace(/\/+$/, "");
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function extractToken(request: NextRequest): string {
  const cookieToken =
    request.cookies.get("auth_token")?.value ||
    request.cookies.get("token")?.value;
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }
  return cookieToken || "";
}

export async function GET(request: NextRequest) {
  const auth = await verifyOwnerRequest(request);
  if (!auth.authenticated || !auth.owner) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { centerId } = auth.owner;
  const token = extractToken(request);
  const baseUrl = getBackendApiUrl();
  const targetUrl = `${baseUrl}/centers/settings?centerId=${encodeURIComponent(
    centerId
  )}`;

  try {
    const forwardHeaders: Record<string, string> = {
      "x-center-id": centerId,
    };
    if (token) {
      forwardHeaders["Authorization"] = `Bearer ${token}`;
      forwardHeaders["cookie"] = `auth_token=${token}`;
    }

    const res = await fetch(targetUrl, {
      headers: forwardHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data?.success) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(
      {
        success: false,
        error:
          data?.error || `Failed to fetch center settings (${res.status})`,
      },
      { status: res.status || 502 }
    );
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? "Center settings request timed out"
          : "Center settings backend service is currently unreachable",
      },
      { status: 503 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await verifyOwnerRequest(request);
  if (!auth.authenticated || !auth.owner) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { centerId } = auth.owner;
  const token = extractToken(request);
  const baseUrl = getBackendApiUrl();
  const targetUrl = `${baseUrl}/centers/settings`;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const { welcomeMessageTemplate, upiId } = body;

  try {
    const forwardHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-center-id": centerId,
    };
    if (token) {
      forwardHeaders["Authorization"] = `Bearer ${token}`;
      forwardHeaders["cookie"] = `auth_token=${token}`;
    }

    const payload: Record<string, unknown> = {
      centerId,
    };
    if (typeof welcomeMessageTemplate === "string") {
      payload.welcomeMessageTemplate = welcomeMessageTemplate;
    }
    if (typeof upiId === "string") {
      payload.upiId = upiId;
    }

    const res = await fetch(targetUrl, {
      method: "PUT",
      headers: forwardHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data?.success) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(
      {
        success: false,
        error:
          data?.error || `Failed to update center settings (${res.status})`,
      },
      { status: res.status || 502 }
    );
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? "Center settings update timed out"
          : "Center settings backend service is currently unreachable",
      },
      { status: 503 }
    );
  }
}
