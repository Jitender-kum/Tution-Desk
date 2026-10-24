import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/authOwner";

const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL || "http://localhost:3005";

export async function GET(request: NextRequest) {
  const auth = await verifyOwnerRequest(request);
  if (!auth.authenticated || !auth.owner) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { centerId } = auth.owner;
  const internalSecret = process.env.WHATSAPP_INTERNAL_SECRET;

  if (!internalSecret || !internalSecret.trim()) {
    return NextResponse.json(
      {
        success: false,
        centerId,
        status: "disconnected",
        ready: false,
        error: "Configuration error: Internal WhatsApp secret is not configured",
      },
      { status: 500 }
    );
  }

  try {
    const upstreamUrl = `${WHATSAPP_SERVICE_URL}/status/${encodeURIComponent(
      centerId
    )}`;

    const res = await fetch(upstreamUrl, {
      headers: {
        "x-internal-secret": internalSecret.trim(),
      },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(
      {
        success: false,
        centerId,
        status: "disconnected",
        ready: false,
        error: data?.error || "Failed to retrieve WhatsApp status",
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
        centerId,
        status: "disconnected",
        ready: false,
        error: isTimeout
          ? "WhatsApp service connection timed out"
          : "WhatsApp service is currently unreachable",
      },
      { status: 503 }
    );
  }
}
