const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// 1. Read environment variables from .env
function loadEnv() {
  const envPath = path.resolve(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...vals] = trimmed.split("=");
        if (key && vals.length) {
          process.env[key.trim()] = vals.join("=").trim();
        }
      }
    }
  }
}

loadEnv();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI || !MONGODB_URI.trim()) {
  console.error(
    "Configuration error: MONGODB_URI environment variable is missing or empty."
  );
  process.exit(1);
}

const YOUPI_WEBHOOK_SECRET = process.env.YOUPI_WEBHOOK_SECRET;
if (!YOUPI_WEBHOOK_SECRET || !YOUPI_WEBHOOK_SECRET.trim()) {
  console.error(
    "Configuration error: YOUPI_WEBHOOK_SECRET environment variable is missing or empty."
  );
  process.exit(1);
}

async function main() {
  console.log("=== Step 1: Connecting to Database ===");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB successfully.");

  // Schema for Fee
  const FeeSchema = new mongoose.Schema(
    {
      studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
      centerId: String,
      month: String,
      title: String,
      amountDue: Number,
      paidAmount: Number,
      status: String,
      utrNumber: String,
      upiTransactionId: String,
      paymentDate: Date,
      paidDate: Date,
      paymentMode: String,
    },
    { timestamps: true }
  );

  const Fee =
    mongoose.models.Fee || mongoose.model("Fee", FeeSchema, "fees");

  console.log("\n=== Step 2: Querying Most Recent Pending / Verification Pending Fee ===");
  const fee = await Fee.findOne({
    status: { $in: ["Pending", "Verification Pending"] },
  }).sort({ updatedAt: -1, createdAt: -1 });

  if (!fee) {
    console.error(
      "❌ No Fee found with status 'Pending' or 'Verification Pending' in the database."
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const feeIdStr = fee._id.toString();
  const tn = `FEE-${feeIdStr.slice(-6)}`;

  console.log("Found Active Fee:");
  console.log({
    _id: feeIdStr,
    amountDue: fee.amountDue,
    status: fee.status,
    month: fee.month,
    centerId: fee.centerId,
    transactionNote: tn,
  });

  console.log("\n=== Step 3: Preparing Mock Webhook Payload ===");
  const payload = {
    transactionNote: tn,
    amount: fee.amountDue,
    upiTransactionId: "TEST_MOCK_12345",
    timestamp: new Date().toISOString(),
  };

  const headers = {
    "x-youpi-secret": YOUPI_WEBHOOK_SECRET,
    "Content-Type": "application/json",
  };

  console.log("Headers:", headers);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  console.log("\n=== Step 4: Firing Mock Webhook ===");
  // Port 3000 is requested, but backend dev server may be on 3001 while frontend is on 3000.
  // We'll test 3000 first, and fallback to 3001 if 3000 returns 404 or connection fails.
  const targetUrls = [
    "http://localhost:3000/api/webhooks/youpi",
    "http://localhost:3001/api/webhooks/youpi",
  ];

  let success = false;

  for (const url of targetUrls) {
    console.log(`\nAttempting POST to ${url}...`);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") || "";
      let responseData;
      if (contentType.includes("application/json")) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      console.log(`Response Status from ${url}:`, response.status);
      console.log("Response Body:", responseData);

      if (response.ok && responseData?.success) {
        console.log(`✅ Webhook processed successfully via ${url}!`);
        success = true;
        break;
      } else if (response.status === 404) {
        console.log(`ℹ️ ${url} returned 404 (endpoint not hosted on this port). Trying next target...`);
      } else {
        console.warn(`⚠️ Request returned status ${response.status}:`, responseData);
      }
    } catch (err) {
      console.error(`Failed to reach ${url}: ${err.message}`);
    }
  }

  if (success) {
    console.log("\n=== Step 5: Verifying Fee Status in Database ===");
    const updatedFee = await Fee.findById(fee._id);
    console.log("Updated Fee in Database:");
    console.log({
      _id: updatedFee._id.toString(),
      status: updatedFee.status,
      paidAmount: updatedFee.paidAmount,
      amountDue: updatedFee.amountDue,
      paymentMode: updatedFee.paymentMode,
      upiTransactionId: updatedFee.upiTransactionId,
      paidDate: updatedFee.paidDate,
    });
    console.log("\n🎉 The Fee is now marked as 'Paid'. The UI polling should immediately display the Success Animation!");
  } else {
    console.error("\n❌ Webhook delivery failed across all target endpoints.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
