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
const isConfirmed = process.argv.includes("--confirm-delete");

async function cleanup() {
  console.log("=== Step 1: Connecting to MongoDB Atlas ===");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected successfully to MongoDB.");

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

  console.log("\n=== Step 2: Searching for Fees with status 'Verification Pending' ===");
  const targetFees = await Fee.find({ status: "Verification Pending" });
  console.log(`Found ${targetFees.length} fee record(s) with status === 'Verification Pending'.`);

  if (targetFees.length === 0) {
    console.log("No ghost verification fees to clean up.");
    await mongoose.disconnect();
    return;
  }

  targetFees.forEach((fee, idx) => {
    console.log(
      ` [${idx + 1}] Fee ID: ${fee._id} | Amount: ₹${fee.amountDue} | UTR: "${fee.utrNumber || "N/A"}" | Month: ${fee.month}`
    );
  });

  if (!isConfirmed) {
    console.log("\n[DRY RUN PREVIEW] Deletion skipped by default.");
    console.log(` -> Target Operation: Fee.deleteMany({ status: "Verification Pending" })`);
    console.log(` -> Records Targeted: ${targetFees.length}`);
    console.log(" ⚠️  No database records were deleted.");
    console.log(" To perform actual deletion, re-run with explicit confirmation:");
    console.log("    node cleanup-test-fees.js --confirm-delete\n");
    await mongoose.disconnect();
    return;
  }

  console.log("\n=== Step 3: Deleting ALL 'Verification Pending' Fees ===");
  const deleteResult = await Fee.deleteMany({ status: "Verification Pending" });
  console.log(`✅ Successfully deleted ${deleteResult.deletedCount} fee record(s) from the database.`);

  console.log("\n=== Step 4: Verification Check ===");
  const remainingCount = await Fee.countDocuments({ status: "Verification Pending" });
  console.log(`Remaining 'Verification Pending' fees: ${remainingCount}`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

cleanup().catch((err) => {
  console.error("Cleanup Error:", err);
  process.exit(1);
});
