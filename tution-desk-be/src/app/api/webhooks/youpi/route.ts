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

    // 2. Parse Webhook Body
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

    if (!transactionNote) {
      return NextResponse.json(
        { success: false, error: "Missing transactionNote in webhook payload" },
        { status: 400 }
      );
    }

    if (isNaN(receivedAmount) || receivedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid payment amount in webhook payload" },
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

    // 4. Find the matching Fee document
    let fee = null;

    // A) If exact 24-character ObjectId was passed
    if (
      feeIdSuffix.length === 24 &&
      mongoose.Types.ObjectId.isValid(feeIdSuffix)
    ) {
      fee = await Fee.findById(feeIdSuffix);
    }

    // B) Search in active pending & verification pending candidate fees
    if (!fee && feeIdSuffix) {
      const suffix6 = feeIdSuffix.slice(-6);

      const candidateFees = await Fee.find({
        status: { $in: ["Pending", "Verification Pending", "Partial Paid"] },
      })
        .sort({ createdAt: -1 })
        .limit(100);

      fee = candidateFees.find((f) =>
        f._id.toString().toLowerCase().endsWith(suffix6)
      );

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
        }).limit(1);

        if (regexMatched.length > 0) {
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

    // 5. Edge Case: Verify Received Amount vs Fee Amount Due
    const isLesser = receivedAmount < fee.amountDue;

    if (isLesser) {
      // Parent manually edited and paid less in their UPI app
      fee.status = "Partial Paid";
      fee.paidAmount = (fee.paidAmount || 0) + receivedAmount;
      fee.amountDue = Math.max(0, fee.amountDue - receivedAmount);
      fee.paymentMode = "Online/UPI";
      fee.paymentDate = paymentTimestamp;
      if (upiTransactionId) {
        fee.upiTransactionId = upiTransactionId;
        fee.utrNumber = upiTransactionId;
      }
      await fee.save();

      return NextResponse.json(
        {
          success: true,
          message: "Partial payment recorded. Fee status set to Partial Paid.",
          data: {
            feeId: fee._id,
            status: fee.status,
            amountPaid: receivedAmount,
            remainingDue: fee.amountDue,
            upiTransactionId,
          },
        },
        { status: 200 }
      );
    }

    // Exact or greater payment: Mark as Paid
    fee.status = "Paid";
    fee.paidAmount = receivedAmount;
    fee.paymentMode = "Online/UPI";
    fee.paymentDate = paymentTimestamp;
    fee.paidDate = paymentTimestamp;
    if (upiTransactionId) {
      fee.upiTransactionId = upiTransactionId;
      fee.utrNumber = upiTransactionId;
    }
    await fee.save();

    return NextResponse.json(
      {
        success: true,
        message: "Fee marked as Paid via YouPI-PG webhook verification",
        data: {
          feeId: fee._id,
          status: fee.status,
          amountPaid: receivedAmount,
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
