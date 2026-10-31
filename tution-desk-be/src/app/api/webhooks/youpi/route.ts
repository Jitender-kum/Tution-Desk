import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Fee from "@/models/Fee";
import "@/models/Student"; // Register student model

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function isSecretValid(provided: string, expected: string): boolean {
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

function generateReceiptNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RCPT-${random}`;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Security Check: Validate webhook secret against environment (fail closed before DB connection)
    const expectedSecret = process.env.YOUPI_WEBHOOK_SECRET;
    if (!expectedSecret || !expectedSecret.trim()) {
      console.error("FATAL: YOUPI_WEBHOOK_SECRET is not configured on server.");
      return NextResponse.json(
        { success: false, error: "Server configuration error" },
        { status: 500 }
      );
    }

    const incomingSecret =
      request.headers.get("x-youpi-secret") ||
      request.headers.get("authorization")?.replace("Bearer ", "");

    if (!incomingSecret || !isSecretValid(incomingSecret.trim(), expectedSecret.trim())) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Invalid or missing x-youpi-secret webhook header",
        },
        { status: 401 }
      );
    }

    await connectDB();

    // 2. Parse and Validate Webhook Body
    const body = await request.json().catch(() => ({}));
    const transactionNote = String(
      body.transactionNote || body.tn || body.note || ""
    ).trim();
    const receivedAmount = Number(body.amount);
    const upiTransactionId = String(
      body.upiTransactionId || body.txnId || body.utrNumber || ""
    ).trim();
    const paymentTimestamp = body.timestamp
      ? new Date(body.timestamp)
      : new Date();
    const eventStatus = String(
      body.status || body.paymentStatus || body.event || ""
    )
      .trim()
      .toUpperCase();

    if (!transactionNote) {
      return NextResponse.json(
        { success: false, error: "Missing transactionNote in webhook payload" },
        { status: 400 }
      );
    }

    // Amount validation: Must be finite, positive number
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid payment amount in webhook payload (must be a positive finite number)",
        },
        { status: 400 }
      );
    }

    if (!upiTransactionId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required transaction identifier (upiTransactionId/txnId/utrNumber)",
        },
        { status: 400 }
      );
    }

    // Provider status verification: reject failed/cancelled events
    if (
      ["FAILED", "FAILURE", "CANCELLED", "REJECTED", "DECLINED"].includes(
        eventStatus
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Payment event indicates non-successful status: ${eventStatus}`,
        },
        { status: 400 }
      );
    }

    // 3. Extract the 6-character fee ID suffix from transactionNote (e.g. "FEE-a1b2c3")
    let feeIdSuffix = "";
    const match = transactionNote.match(/FEE-([a-fA-F0-9]+)/i);
    if (match) {
      feeIdSuffix = match[1].toLowerCase();
    } else {
      feeIdSuffix = transactionNote.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase();
    }

    // 4. Find the matching Fee document with Strict Ambiguity Handling
    let fee = null;

    // A) If exact 24-character ObjectId was passed
    if (
      feeIdSuffix.length === 24 &&
      mongoose.Types.ObjectId.isValid(feeIdSuffix)
    ) {
      fee = await Fee.findById(feeIdSuffix);
    }

    // B) Search in active candidate fees
    if (!fee && feeIdSuffix) {
      const suffix6 = feeIdSuffix.slice(-6);

      const candidateFees = await Fee.find({
        status: { $in: ["Pending", "Verification Pending", "Partial Paid"] },
      })
        .sort({ createdAt: -1 })
        .limit(100);

      const matchingActive = candidateFees.filter((f) =>
        f._id.toString().toLowerCase().endsWith(suffix6)
      );

      // Ambiguity check in active fees: Fail closed if multiple match
      if (matchingActive.length > 1) {
        return NextResponse.json(
          {
            success: false,
            error: `Ambiguous fee suffix "${suffix6}": matches ${matchingActive.length} active fee records`,
            code: "AMBIGUOUS_FEE_SUFFIX",
          },
          { status: 409 }
        );
      }

      if (matchingActive.length === 1) {
        fee = matchingActive[0];
      }

      // If not found in active fees, search Paid fees (to handle idempotent retries of fully settled fees)
      if (!fee) {
        const paidCandidateFees = await Fee.find({
          status: "Paid",
        })
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(100);

        const matchingPaid = paidCandidateFees.filter((f) =>
          f._id.toString().toLowerCase().endsWith(suffix6)
        );

        if (matchingPaid.length > 1) {
          return NextResponse.json(
            {
              success: false,
              error: `Ambiguous fee suffix "${suffix6}": matches ${matchingPaid.length} settled fee records`,
              code: "AMBIGUOUS_FEE_SUFFIX",
            },
            { status: 409 }
          );
        }

        if (matchingPaid.length === 1) {
          fee = matchingPaid[0];
        }
      }

      // C) Fallback regex search on stringified _id
      if (!fee) {
        const regexMatched = await Fee.find({
          $expr: {
            $regexMatch: {
              input: { $toString: "$_id" },
              regex: `${suffix6}$`,
              options: "i",
            },
          },
        }).limit(2);

        if (regexMatched.length > 1) {
          return NextResponse.json(
            {
              success: false,
              error: `Ambiguous fee suffix "${suffix6}": multiple database records matched`,
              code: "AMBIGUOUS_FEE_SUFFIX",
            },
            { status: 409 }
          );
        } else if (regexMatched.length === 1) {
          fee = regexMatched[0];
        }
      }
    }

    if (!fee) {
      return NextResponse.json(
        {
          success: false,
          error: `No matching fee record found for transaction note: "${transactionNote}"`,
        },
        { status: 404 }
      );
    }

    // 5. Atomic State Transition with Optimistic Concurrency Loop (up to 3 attempts)
    let updatedFee: any = null;
    let isFullSettlement = false;
    let currentFee: any = fee;

    for (let attempt = 0; attempt < 3; attempt++) {
      // 5a. Idempotency Check: Ignore duplicate delivery of already processed transaction
      const alreadyProcessed = Boolean(
        (Array.isArray(currentFee.processedTxnIds) &&
          currentFee.processedTxnIds.includes(upiTransactionId)) ||
          currentFee.upiTransactionId === upiTransactionId ||
          currentFee.utrNumber === upiTransactionId ||
          (Array.isArray(currentFee.paymentTransactions) &&
            currentFee.paymentTransactions.some(
              (t: any) => t && t.txnId === upiTransactionId
            ))
      );

      if (alreadyProcessed) {
        return NextResponse.json(
          {
            success: true,
            duplicate: true,
            message: "Duplicate webhook delivery ignored: transaction already processed",
            data: {
              feeId: currentFee._id,
              status: currentFee.status,
              amountPaid: currentFee.paidAmount || 0,
              totalPaid: currentFee.paidAmount || 0,
              remainingDue: currentFee.amountDue || 0,
              upiTransactionId,
            },
          },
          { status: 200 }
        );
      }

      // 5b. Conflict Check: Fee is already fully settled with status Paid
      if (currentFee.status === "Paid" && (Number(currentFee.amountDue) || 0) <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Fee is already fully settled with status Paid",
            data: {
              feeId: currentFee._id,
              status: currentFee.status,
              totalPaid: currentFee.paidAmount || 0,
              remainingDue: 0,
              upiTransactionId,
            },
          },
          { status: 409 }
        );
      }

      // 5c. Overpayment Check: Amount must not exceed current outstanding balance
      const outstandingDue = Number(currentFee.amountDue) || 0;
      if (receivedAmount > outstandingDue) {
        return NextResponse.json(
          {
            success: false,
            error: `Payment amount ₹${receivedAmount} exceeds outstanding balance of ₹${outstandingDue}`,
            data: {
              feeId: currentFee._id,
              status: currentFee.status,
              amountDue: outstandingDue,
              receivedAmount,
            },
          },
          { status: 400 }
        );
      }

      // 5d. Atomic Update Execution via findOneAndUpdate with state predicate
      isFullSettlement = receivedAmount === outstandingDue;

      if (isFullSettlement) {
        // Full settlement: amountDue becomes 0, status becomes Paid
        const filter: Record<string, unknown> = {
          _id: currentFee._id,
          status: { $ne: "Paid" },
          amountDue: receivedAmount,
          processedTxnIds: { $ne: upiTransactionId },
        };

        const update: Record<string, unknown> = {
          $set: {
            status: "Paid",
            amountDue: 0,
            paidDate: paymentTimestamp,
            paidAt: paymentTimestamp,
            paymentDate: paymentTimestamp,
            paymentMode: "Online/UPI",
            upiTransactionId,
            utrNumber: upiTransactionId,
            receiptNumber: currentFee.receiptNumber || generateReceiptNumber(),
          },
          $inc: {
            paidAmount: receivedAmount,
          },
          $push: {
            processedTxnIds: upiTransactionId,
            paymentTransactions: {
              txnId: upiTransactionId,
              amount: receivedAmount,
              date: paymentTimestamp,
              mode: "Online/UPI",
              status: "SUCCESS",
            },
          },
        };

        updatedFee = await Fee.findOneAndUpdate(filter, update, { new: true });
      } else {
        // Partial payment: amountDue decremented, status becomes Partial Paid
        const filter: Record<string, unknown> = {
          _id: currentFee._id,
          status: { $in: ["Pending", "Verification Pending", "Partial Paid"] },
          amountDue: { $gt: receivedAmount },
          processedTxnIds: { $ne: upiTransactionId },
        };

        const update: Record<string, unknown> = {
          $set: {
            status: "Partial Paid",
            paymentDate: paymentTimestamp,
            paymentMode: "Online/UPI",
            upiTransactionId,
            utrNumber: upiTransactionId,
          },
          $inc: {
            amountDue: -receivedAmount,
            paidAmount: receivedAmount,
          },
          $push: {
            processedTxnIds: upiTransactionId,
            paymentTransactions: {
              txnId: upiTransactionId,
              amount: receivedAmount,
              date: paymentTimestamp,
              mode: "Online/UPI",
              status: "SUCCESS",
            },
          },
        };

        updatedFee = await Fee.findOneAndUpdate(filter, update, { new: true });
      }

      if (updatedFee) {
        // Atomic update succeeded!
        break;
      }

      // If findOneAndUpdate returned null, another concurrent request modified the document.
      // Re-fetch fresh state from MongoDB to determine if it was a duplicate or state change.
      const freshDoc = await Fee.findById(currentFee._id);
      if (!freshDoc) {
        break;
      }
      currentFee = freshDoc;
    }

    if (!updatedFee) {
      // Final conflict check after retries
      const freshDoc = await Fee.findById(fee._id);
      if (freshDoc) {
        const isDuplicate = Boolean(
          (Array.isArray(freshDoc.processedTxnIds) &&
            freshDoc.processedTxnIds.includes(upiTransactionId)) ||
            freshDoc.upiTransactionId === upiTransactionId
        );
        if (isDuplicate) {
          return NextResponse.json(
            {
              success: true,
              duplicate: true,
              message: "Duplicate webhook delivery ignored: transaction already processed",
              data: {
                feeId: freshDoc._id,
                status: freshDoc.status,
                totalPaid: freshDoc.paidAmount || 0,
                remainingDue: freshDoc.amountDue || 0,
                upiTransactionId,
              },
            },
            { status: 200 }
          );
        }
      }

      return NextResponse.json(
        {
          success: false,
          error: "Concurrent transaction conflict: fee state changed during processing",
        },
        { status: 409 }
      );
    }

    // 6. Return Structured Success Response
    if (isFullSettlement) {
      return NextResponse.json(
        {
          success: true,
          message: "Fee marked as Paid via YouPI-PG webhook verification",
          data: {
            feeId: updatedFee._id,
            status: updatedFee.status,
            amountPaid: receivedAmount,
            totalPaid: updatedFee.paidAmount,
            remainingDue: 0,
            receiptNumber: updatedFee.receiptNumber,
            upiTransactionId,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Partial payment recorded. Fee status set to Partial Paid.",
        data: {
          feeId: updatedFee._id,
          status: updatedFee.status,
          amountPaid: receivedAmount,
          totalPaid: updatedFee.paidAmount,
          remainingDue: updatedFee.amountDue,
          upiTransactionId,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to process YouPI-PG webhook";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
