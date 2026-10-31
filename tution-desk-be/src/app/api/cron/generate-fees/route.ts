import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { generateMonthlyFees } from "@/lib/feeGenerator.ts";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

function isCronSecretValid(provided: string, expected: string): boolean {
  try {
    const provBuf = Buffer.from(provided, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (provBuf.length !== expBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(provBuf, expBuf);
  } catch {
    return false;
  }
}

async function handleGenerateFees(request: NextRequest) {
  try {
    // 1. Security Check: Validate cron secret before any execution or DB operations (fail closed)
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || !expectedSecret.trim()) {
      console.error("FATAL: CRON_SECRET is not configured on server.");
      return NextResponse.json(
        { success: false, error: "Server configuration error: CRON_SECRET is missing" },
        { status: 500 }
      );
    }

    const incomingSecret =
      request.headers.get("x-cron-secret") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!incomingSecret || !isCronSecretValid(incomingSecret.trim(), expectedSecret.trim())) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Invalid or missing cron secret authorization",
        },
        { status: 401 }
      );
    }

    // 2. Parse Trigger Parameters (Query params or optional JSON body)
    const { searchParams } = request.nextUrl;
    const body =
      request.method === "POST" ? await request.json().catch(() => ({})) : {};

    const overrideDayParam = searchParams.get("day") || body.day;
    const overrideDay =
      overrideDayParam !== undefined && overrideDayParam !== null && overrideDayParam !== ""
        ? Number(overrideDayParam)
        : undefined;

    const centerId =
      (searchParams.get("centerId") || body.centerId || "")?.trim() || undefined;

    const forceAllStudents =
      searchParams.get("forceAll") === "true" || body.forceAll === true;

    // 3. Execute Idempotent Monthly Fee Generation
    const result = await generateMonthlyFees({
      overrideDay,
      centerId,
      forceAllStudents,
    });

    return NextResponse.json(
      {
        message: `Auto-fee generation complete (${result.month})`,
        ...result,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate recurring fees";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * Auto-Fee Generator Cron API
 * Triggered by cron job / scheduler daily to generate recurring monthly fees
 * for students whose billingCycleDate matches today's day of the month.
 * Requires Authorization: Bearer <CRON_SECRET> or x-cron-secret header.
 */
export async function GET(request: NextRequest) {
  return handleGenerateFees(request);
}

export async function POST(request: NextRequest) {
  return handleGenerateFees(request);
}
