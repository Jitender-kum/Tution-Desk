import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/authOwner";
import { isLiveDispatchEnabled } from "@/lib/whatsappService";

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

  let body: { phone?: unknown; message?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const rawPhone =
    typeof body?.phone === "string" || typeof body?.phone === "number"
      ? String(body.phone).trim()
      : "";

  const cleanDigits = rawPhone.replace(/\D/g, "");

  if (cleanDigits.length < 10 || cleanDigits.length > 15) {
    return NextResponse.json(
      {
        success: false,
        error: "Please enter a valid 10-digit WhatsApp phone number.",
      },
      { status: 400 }
    );
  }

  const customMessage =
    typeof body?.message === "string" && body.message.trim().length > 0
      ? body.message.trim().slice(0, 1000)
      : `👋 Hello from our center WhatsApp Automation!\n\nYour center's dedicated WhatsApp engine (Center: ${centerId}) is configured and running smoothly. System timestamp: ${new Date().toLocaleTimeString(
          "en-IN"
        )}`;

  // Fail-closed simulation guard: zero network requests unless explicitly opted into live mode
  if (!isLiveDispatchEnabled()) {
    const maskedPhone =
      cleanDigits.length >= 4 ? `***${cleanDigits.slice(-4)}` : "****";
    console.log(
      `[WHATSAPP SIMULATION] Event: test_ping | Center: ${centerId} | Recipient: ${maskedPhone} | Length: ${customMessage.length} chars`
    );
    return NextResponse.json({
      success: true,
      simulated: true,
      centerId,
      messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      message:
        "Simulation mode active: WhatsApp test ping simulated successfully (zero outbound network requests).",
    });
  }

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
    const upstreamUrl = `${WHATSAPP_SERVICE_URL}/send-message`;

    // Note: centerId is strictly derived from the verified session, ignoring any client input
    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret.trim(),
      },
      body: JSON.stringify({
        centerId,
        phone: cleanDigits,
        message: customMessage,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(
      {
        success: false,
        centerId,
        error: data?.error || "Failed to dispatch test message",
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
          ? "WhatsApp message request timed out"
          : "WhatsApp service is currently unreachable",
      },
      { status: 503 }
    );
  }
}
