const fs = require("fs");
const path = require("path");

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

async function runSimulation() {
  console.log("==================================================================");
  console.log("       TUITION DESK: AUTO FEE GENERATION SIMULATOR");
  console.log("==================================================================");
  console.log(`Execution Time: ${new Date().toISOString()}`);

  let mongooseConnection = null;

  try {
    // 2. Import database connection and existing fee generation engine
    console.log("\n[1/3] Loading database connection & fee generator engine...");
    const { connectDB } = await import("./src/lib/db.ts");
    const { generateMonthlyFees } = await import("./src/lib/feeGenerator.ts");

    mongooseConnection = await connectDB();
    console.log("Connected successfully to MongoDB Atlas.");

    // 3. Force fee generation for all active students (overriding billingCycleDate checks)
    console.log("\n[2/3] Simulating fee generation for ALL active students right now...");
    console.log("-> Date/time cycle check overridden: forceAllStudents = true");

    const result = await generateMonthlyFees({
      forceAllStudents: true, // Overrides the cycle day check and runs for ALL active students right now
      referenceDate: new Date(),
    });

    console.log(`-> Target Billing Month: "${result.month}"`);
    console.log(`-> Total Active Students Processed: ${result.totalEligibleStudents}`);

    // 4. Output results
    console.log("\n[3/3] Simulation Results & Document Inspection:");
    console.log("------------------------------------------------------------------");

    if (result.generatedCount > 0) {
      console.log(`\n Newly Generated Fees (${result.generatedCount}):`);
      result.generatedFeeRecords.forEach((fee, idx) => {
        console.log(
          `  ${idx + 1}. Fee ID: ${fee._id} | Student ID: ${fee.studentId} | Month: ${fee.month} | Amount Due: ₹${fee.amountDue} | Status: ${fee.status} | Due: ${new Date(fee.dueDate).toLocaleDateString("en-IN")}`
        );
      });
    } else {
      console.log("\n Newly Generated Fees: 0 (All eligible students already have records or ₹0 fee)");
    }

    if (result.skippedCount > 0) {
      console.log(`\n Skipped Students (${result.skippedCount}):`);
      result.skippedRecords.forEach((skip, idx) => {
        console.log(
          `  ${idx + 1}. Student: "${skip.studentName}" (${skip.studentId}) -> ${skip.reason}`
        );
      });
    }

    console.log("\n==================================================================");
    console.log("                   SIMULATION SUMMARY");
    console.log("==================================================================");
    console.log(`• Target Month:            ${result.month}`);
    console.log(`• Eligible Students:       ${result.totalEligibleStudents}`);
    console.log(`• Generated Documents:     ${result.generatedCount}`);
    console.log(`• Skipped Documents:       ${result.skippedCount}`);
    console.log(`• Generated Fee Document IDs:`);
    if (result.generatedFeeRecords.length > 0) {
      result.generatedFeeRecords.forEach((f) => console.log(`    - ${f._id}`));
    } else {
      console.log(`    (None generated in this run)`);
    }
    console.log(`• Errors Encountered:      None (Success)`);
    console.log("==================================================================\n");
  } catch (error) {
    console.error("\n❌ Simulation Error Encountered:", error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    if (mongooseConnection && mongooseConnection.disconnect) {
      await mongooseConnection.disconnect();
      console.log("Disconnected cleanly from MongoDB.");
    }
  }
}

runSimulation();
