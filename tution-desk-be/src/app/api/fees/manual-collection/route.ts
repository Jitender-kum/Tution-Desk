import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Fee, { IFeeDocument } from "@/models/Fee";
import Student from "@/models/Student";
import { getAuthenticatedCenterId } from "@/lib/auth";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { getISTDateComponents } from "@/lib/dateUtils";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "POST, OPTIONS");
}

function generateReceiptNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RCPT-${random}`;
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    await connectDB();

    const body = await request.json().catch(() => ({}));
    const { studentId, centerId, amount, type, notes } = body;

    // 1. Validate studentId
    if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
      return NextResponse.json(
        { success: false, error: "A valid studentId is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. Validate amount
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: "Payment amount must be greater than 0" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 3. Look up student record
    const studentDoc = await Student.findById(studentId);
    if (!studentDoc) {
      return NextResponse.json(
        { success: false, error: "Student record not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // 4. Resolve and verify centerId authorization
    const authCenterId = await getAuthenticatedCenterId(request);
    let targetCenterId =
      authCenterId ||
      (centerId ? String(centerId).trim() : null) ||
      request.headers.get("x-center-id") ||
      studentDoc.centerId;

    if (authCenterId && studentDoc.centerId !== authCenterId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized access to student outside authenticated center" },
        { status: 403, headers: corsHeaders }
      );
    }

    const now = new Date();
    const dateComp = getISTDateComponents(now);

    // 5. Determine fee category: Non-recurring vs Monthly Recurring
    const isAdvance =
      String(type || "").toLowerCase().includes("advance") ||
      String(notes || "").toLowerCase().includes("advance") ||
      body.isAdvance === true ||
      body.feeType === "advance";

    const resolvedFeeType =
      isAdvance
        ? "advance"
        : body.feeType === "adhoc" || String(type || "").toLowerCase().includes("adhoc")
        ? "adhoc"
        : body.feeType === "registration" || String(type || "").toLowerCase().includes("registration")
        ? "registration"
        : "monthly_recurring";

    const receiptNumber = generateReceiptNumber();

    // -------------------------------------------------------------------------
    // Branch A: Non-Recurring Fees (advance, registration, adhoc)
    // Preserve existing standalone creation behavior
    // -------------------------------------------------------------------------
    if (resolvedFeeType !== "monthly_recurring") {
      const currentMonthName = now.toLocaleString("en-IN", {
        month: "long",
        year: "numeric",
      });

      const feeTitle = isAdvance
        ? notes?.trim() || "Advance Fee Payment"
        : notes?.trim() || `${resolvedFeeType === "registration" ? "Registration Fee" : "Ad-hoc Fee"} (${currentMonthName})`;

      const monthString = isAdvance
        ? `Advance - ${currentMonthName}`
        : currentMonthName;

      const manualNonRecurringFee = await Fee.create({
        centerId: targetCenterId,
        studentId: new mongoose.Types.ObjectId(studentId),
        month: monthString,
        title: feeTitle,
        amountDue: parsedAmount,
        paidAmount: parsedAmount,
        dueDate: now,
        status: "Paid",
        paymentMode: "Cash",
        feeType: resolvedFeeType,
        isAdvance: isAdvance,
        notes: notes ? String(notes).trim() : "",
        receiptNumber: receiptNumber,
        paidDate: now,
        paidAt: now,
        paymentDate: now,
      });

      const populatedFee = await Fee.findById(manualNonRecurringFee._id).populate("studentId");

      return NextResponse.json(
        {
          success: true,
          settledExisting: false,
          message: `Offline cash payment of ₹${parsedAmount} recorded successfully (Receipt: ${receiptNumber})`,
          data: populatedFee,
        },
        { status: 201, headers: corsHeaders }
      );
    }

    // -------------------------------------------------------------------------
    // Branch B: Monthly Recurring Fee Deduplication & Settlement
    // -------------------------------------------------------------------------
    // Determine canonical billing cycle (YYYY-MM)
    let targetBillingMonth = body.billingMonth;
    if (!targetBillingMonth && body.month && /^\d{4}-\d{2}$/.test(String(body.month).trim())) {
      targetBillingMonth = String(body.month).trim();
    }
    if (!targetBillingMonth) {
      targetBillingMonth = dateComp.billingMonth;
    }

    if (!/^\d{4}-\d{2}$/.test(targetBillingMonth)) {
      return NextResponse.json(
        { success: false, error: `Invalid billingMonth format: "${targetBillingMonth}". Expected YYYY-MM.` },
        { status: 400, headers: corsHeaders }
      );
    }

    // Query candidate fees for this student, center, and billing cycle
    const candidateQuery: Record<string, unknown> = {
      centerId: targetCenterId,
      studentId: new mongoose.Types.ObjectId(studentId),
      feeType: { $ne: "advance" },
      isAdvance: { $ne: true },
      $or: [
        { billingMonth: targetBillingMonth },
        {
          month: {
            $in: [
              targetBillingMonth,
              dateComp.monthLabel,
              dateComp.shortMonthLabel,
            ],
          },
        },
      ],
    };

    const candidates = (await Fee.find(candidateQuery)) as unknown as IFeeDocument[];

    // Filter out any explicit advance, adhoc, or registration records
    const eligibleCandidates: IFeeDocument[] = candidates.filter(
      (c) =>
        c.feeType !== "advance" &&
        c.feeType !== "adhoc" &&
        c.feeType !== "registration" &&
        !c.isAdvance
    );

    // Conflict Rule 1: Multiple candidate fees exist
    if (eligibleCandidates.length > 1) {
      const statuses = eligibleCandidates.map((c) => c.status).join(", ");
      return NextResponse.json(
        {
          success: false,
          code: "MULTIPLE_CANDIDATE_FEES",
          error: `Multiple candidate fee records (${eligibleCandidates.length}) exist for billing cycle ${targetBillingMonth} (${statuses}). Safe reconciliation is required before collecting payment.`,
        },
        { status: 409, headers: corsHeaders }
      );
    }

    // Conflict Rule 2: Online Verification Pending conflict
    if (eligibleCandidates.length === 1 && eligibleCandidates[0].status === "Verification Pending") {
      const candidate = eligibleCandidates[0];
      return NextResponse.json(
        {
          success: false,
          code: "VERIFICATION_PENDING_CONFLICT",
          error: `An online payment verification is currently pending for billing cycle ${targetBillingMonth} (Fee ID: ${candidate._id}, UTR: ${candidate.utrNumber || "N/A"}). Please verify or reject the online payment before collecting cash.`,
        },
        { status: 409, headers: corsHeaders }
      );
    }

    // Conflict Rule 3: Already Paid in Full
    if (eligibleCandidates.length === 1 && eligibleCandidates[0].status === "Paid") {
      const candidate = eligibleCandidates[0];
      return NextResponse.json(
        {
          success: false,
          code: "FEE_ALREADY_PAID",
          error: `Monthly fee for billing cycle ${targetBillingMonth} is already Paid in full (Fee ID: ${candidate._id}, Receipt: ${candidate.receiptNumber || "N/A"}). Duplicate collection is blocked.`,
        },
        { status: 409, headers: corsHeaders }
      );
    }

    // Eligible Candidate Exists with Status 'Pending' or 'Partial Paid' -> Settle / Update
    if (eligibleCandidates.length === 1) {
      const candidate = eligibleCandidates[0];

      // Calculate outstanding balance
      const currentRemainingDue = Number(candidate.amountDue) || 0;
      const priorPaidAmount = Number(candidate.paidAmount) || 0;

      // Validate payment amount against outstanding balance
      if (parsedAmount > currentRemainingDue) {
        return NextResponse.json(
          {
            success: false,
            code: "EXCESSIVE_PAYMENT_AMOUNT",
            error: `Payment amount of ₹${parsedAmount} exceeds the remaining balance of ₹${currentRemainingDue} for billing cycle ${targetBillingMonth}.`,
          },
          { status: 400, headers: corsHeaders }
        );
      }

      const isFullPayment = parsedAmount === currentRemainingDue;
      const totalPaidSoFar = priorPaidAmount + parsedAmount;
      const newRemainingDue = Math.max(0, currentRemainingDue - parsedAmount);

      const noteText = notes ? String(notes).trim() : "";
      const auditEntry = `[${now.toISOString()}] Cash collected: ₹${parsedAmount} (Receipt: ${receiptNumber})${noteText ? ` - ${noteText}` : ""}`;
      const updatedNotes = candidate.notes ? `${candidate.notes}\n${auditEntry}` : auditEntry;

      // Atomic update protecting against concurrent double-collection
      const updatedFee = await Fee.findOneAndUpdate(
        {
          _id: candidate._id,
          status: { $in: ["Pending", "Partial Paid"] }, // Concurrency guard
        },
        {
          $set: {
            status: isFullPayment ? "Paid" : "Partial Paid",
            amountDue: isFullPayment ? 0 : newRemainingDue,
            paidAmount: totalPaidSoFar,
            receiptNumber: receiptNumber,
            paymentMode: "Cash",
            paidDate: now,
            paidAt: now,
            paymentDate: now,
            billingMonth: targetBillingMonth,
            feeType: "monthly_recurring",
            notes: updatedNotes,
          },
        },
        { new: true }
      ).populate("studentId");

      if (!updatedFee) {
        return NextResponse.json(
          {
            success: false,
            code: "CONCURRENT_MODIFICATION_CONFLICT",
            error: "Concurrent payment conflict: Fee record was already updated or settled by another transaction.",
          },
          { status: 409, headers: corsHeaders }
        );
      }

      return NextResponse.json(
        {
          success: true,
          settledExisting: true,
          message: isFullPayment
            ? `Offline cash payment of ₹${parsedAmount} recorded successfully. Fee marked as Paid (Receipt: ${receiptNumber})`
            : `Partial cash payment of ₹${parsedAmount} recorded successfully. Remaining balance: ₹${newRemainingDue} (Receipt: ${receiptNumber})`,
          data: updatedFee,
        },
        { status: 200, headers: corsHeaders }
      );
    }

    // -------------------------------------------------------------------------
    // No eligible candidate fee exists -> Create new Fee record set to 'Paid'
    // -------------------------------------------------------------------------
    const feeTitle = notes?.trim() || `Regular Monthly Fee (${dateComp.monthLabel})`;

    const newFee = await Fee.create({
      centerId: targetCenterId,
      studentId: new mongoose.Types.ObjectId(studentId),
      billingMonth: targetBillingMonth,
      month: dateComp.monthLabel,
      title: feeTitle,
      amountDue: parsedAmount,
      paidAmount: parsedAmount,
      dueDate: now,
      status: "Paid",
      paymentMode: "Cash",
      feeType: "monthly_recurring",
      isAdvance: false,
      notes: notes ? String(notes).trim() : "",
      receiptNumber: receiptNumber,
      paidDate: now,
      paidAt: now,
      paymentDate: now,
    });

    const populatedFee = await Fee.findById(newFee._id).populate("studentId");

    return NextResponse.json(
      {
        success: true,
        settledExisting: false,
        message: `Offline cash payment of ₹${parsedAmount} recorded successfully (Receipt: ${receiptNumber})`,
        data: populatedFee,
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to record manual cash payment";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500, headers: corsHeaders }
    );
  }
}
