import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import "@/models/Student"; // Register Student model for population
import { getAuthenticatedCenterId } from "@/lib/auth";
import { generateOrGetMonthlyFee } from "@/lib/feeService";

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const body = await request.json();
    const targetCenterId = authCenterId || body.centerId;

    if (!targetCenterId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId is required" },
        { status: 400 }
      );
    }

    // Explicit feeType validation and resolution
    let feeType = body.feeType;

    if (!feeType) {
      if (body.isAdvance || /advance/i.test(body.title || "") || /advance/i.test(body.month || "")) {
        feeType = "advance";
      } else if (body.billingMonth) {
        feeType = "monthly_recurring";
      } else if (body.type === "registration" || /registration|admission/i.test(body.title || "")) {
        feeType = "registration";
      } else if (body.type === "adhoc" || /adhoc|material|exam|book/i.test(body.title || "")) {
        feeType = "adhoc";
      } else if (body.studentId && body.month && !body.title) {
        // Standard manual monthly billing creation
        feeType = "monthly_recurring";
      } else {
        return NextResponse.json(
          {
            success: false,
            error:
              "Ambiguous fee creation request: 'feeType' is required. Supported types: 'monthly_recurring', 'advance', 'adhoc', 'registration'.",
          },
          { status: 400 }
        );
      }
    }

    const validFeeTypes = ["monthly_recurring", "advance", "adhoc", "registration"];
    if (!validFeeTypes.includes(feeType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid feeType: '${feeType}'. Supported types: ${validFeeTypes.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    // If recurring monthly fee, route through idempotent feeService
    if (feeType === "monthly_recurring") {
      if (!body.studentId) {
        return NextResponse.json(
          { success: false, error: "studentId is required for monthly recurring fees" },
          { status: 400 }
        );
      }

      let targetBillingMonth = body.billingMonth;
      if (!targetBillingMonth && body.month && /^\d{4}-\d{2}$/.test(String(body.month).trim())) {
        targetBillingMonth = String(body.month).trim();
      }

      const res = await generateOrGetMonthlyFee({
        centerId: targetCenterId,
        studentId: body.studentId,
        billingMonth: targetBillingMonth,
        amountDue:
          body.amountDue !== undefined ? Number(body.amountDue) : undefined,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        isManual: true,
      });

      if (!res.success) {
        return NextResponse.json(
          {
            success: false,
            error:
              res.conflictReason ||
              res.error ||
              "Failed to process monthly fee request",
            status: res.status,
          },
          { status: res.status === "reconciliation_required" ? 409 : 400 }
        );
      }

      return NextResponse.json(
        {
          success: true,
          data: res.fee,
          wasCreated: res.wasCreated,
          status: res.status,
        },
        { status: res.wasCreated ? 201 : 200 }
      );
    }

    // For non-recurring fee types (adhoc, registration, advance),
    // ensure billingMonth is NOT set so it cannot suppress legitimate monthly recurring billing
    const { billingMonth: _omittedMonth, ...cleanBody } = body;
    const newFee = await Fee.create({
      ...cleanBody,
      feeType,
      isAdvance: feeType === "advance" ? true : Boolean(body.isAdvance),
      centerId: targetCenterId,
    });

    return NextResponse.json(
      { success: true, data: newFee, wasCreated: true },
      { status: 201 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create fee record";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = request.nextUrl;
    const authCenterId = await getAuthenticatedCenterId(request);
    const centerId = authCenterId || searchParams.get("centerId");

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId query parameter is required" },
        { status: 400 }
      );
    }

    const filter: Record<string, unknown> = { centerId };
    const studentId = searchParams.get("studentId");
    const month = searchParams.get("month");
    const status = searchParams.get("status");

    if (studentId) filter.studentId = studentId;
    if (month) filter.month = month;
    if (status) {
      if (status.includes(",")) {
        filter.status = { $in: status.split(",").map((s) => s.trim()) };
      } else {
        filter.status = status;
      }
    }

    const fees = await Fee.find(filter)
      .populate("studentId")
      .sort({ createdAt: -1 });

    return NextResponse.json(
      { success: true, data: fees },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch fee records";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
