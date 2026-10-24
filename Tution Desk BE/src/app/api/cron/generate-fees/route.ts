import { NextRequest, NextResponse } from "next/server";
import { generateMonthlyFees } from "@/lib/feeGenerator.ts";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}

/**
 * Auto-Fee Generator Cron API
 * Triggered by cron job / scheduler daily to generate recurring monthly fees
 * for students whose billingCycleDate matches today's day of the month.
 * Supports manual overrides via query params:
 *   ?day=10
 *   ?centerId=...
 *   ?forceAll=true
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const overrideDay = searchParams.get("day")
      ? Number(searchParams.get("day"))
      : undefined;
    const centerId = searchParams.get("centerId") || undefined;
    const forceAllStudents = searchParams.get("forceAll") === "true";

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
