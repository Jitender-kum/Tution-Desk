import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/authOwner";

const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL || "http://localhost:3005";

export async function POST(request: NextRequest) {
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
        error: "Configuration error: Internal WhatsApp secret is not configured",
      },
      { status: 500 }
    );
  }

  try {
    const baseUrl = (
      process.env.WHATSAPP_SERVICE_URL || "http://localhost:3005"
    ).replace(/\/+$/, "");
    const upstreamUrl = `${baseUrl}/init/${encodeURIComponent(
      centerId
    )}`;

    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "x-internal-secret": internalSecret.trim(),
      },
      signal: AbortSignal.timeout(8000),
    });

    const contentType = res.headers.get("content-type") || "";
    let data: any = null;
    if (contentType.includes("application/json")) {
      data = await res.json().catch(() => null);
    } else {
      // Safely consume non-JSON body (e.g. Render HTML 502)
      await res.text().catch(() => "");
    }

    if (res.ok && data) {
      return NextResponse.json(data, { status: res.status });
    }

    const errorMessage =
      data?.error ||
      (res.status === 502
        ? "WhatsApp service is temporarily unavailable or restarting (502 Bad Gateway)"
        : res.status === 503
        ? "WhatsApp service is currently unavailable (503 Service Unavailable)"
        : res.status === 504
        ? "WhatsApp service initialization timed out (504 Gateway Timeout)"
        : `Failed to initialize WhatsApp client (HTTP ${res.status})`);

    return NextResponse.json(
      {
        success: false,
        centerId,
        error: errorMessage,
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
        error: isTimeout
          ? "WhatsApp initialization timed out"
          : "WhatsApp service is currently unreachable",
      },
      { status: 503 }
    );
  }
}
