import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "tuition-desk-phase2k-secure-launch-jwt-secret-min-32-chars-long";
process.env.YOUPI_WEBHOOK_SECRET = "youpi_pg_secret_phase2k_launch";
process.env.CRON_SECRET = "cron_secret_phase2k_launch_32_chars_long_ok";
process.env.WHATSAPP_INTERNAL_SECRET = "whatsapp_secret_phase2k_launch_32_chars";
process.env.MONGODB_URI = "mongodb://localhost:27017/test_tuitiondesk";
process.env.NODE_ENV = "test";

globalThis.mongooseCache = { conn: {}, promise: Promise.resolve({}) };

// Import models and services
const { validateEnvironment } = await import("../tution-desk-be/src/lib/env.ts");
const { POST: youpiWebhookRoute } = await import("../tution-desk-be/src/app/api/webhooks/youpi/route.ts");
const { POST: manualCollectionRoute } = await import("../tution-desk-be/src/app/api/fees/manual-collection/route.ts");
const { GET: cronGenerateFeesRoute } = await import("../tution-desk-be/src/app/api/cron/generate-fees/route.ts");
const { GET: ownerDashboardRoute } = await import("../tution-desk-be/src/app/api/dashboard/owner/route.ts");
const { PUT: centerSettingsRoute } = await import("../tution-desk-be/src/app/api/centers/settings/route.ts");
const { DELETE: deleteFeeRoute, PUT: updateFeeRoute } = await import("../tution-desk-be/src/app/api/fees/[feeId]/route.ts");
const { POST: advanceFeeRoute } = await import("../tution-desk-be/src/app/api/fees/advance/route.ts");
const { DELETE: deleteStudentRoute } = await import("../tution-desk-be/src/app/api/students/[id]/route.ts");
const { isLiveDispatchEnabled } = await import("../tution-desk-be/src/lib/whatsappService.ts");
const { checkReminderEligibility } = await import("../tution-desk-be/src/lib/reminderService.ts");
const { getAllowedOrigins } = await import("../tution-desk-be/src/lib/cors.ts");
const { signToken } = await import("../tution-desk-be/src/lib/auth.ts");

const StudentModel = (await import("../tution-desk-be/src/models/Student.ts")).default;
const FeeModel = (await import("../tution-desk-be/src/models/Fee.ts")).default;
const CenterModel = (await import("../tution-desk-be/src/models/Center.ts")).default;
const FeeCreationLockModel = (await import("../tution-desk-be/src/models/FeeCreationLock.ts")).default;
const AttendanceModel = (await import("../tution-desk-be/src/models/Attendance.ts")).default;
const TestModel = (await import("../tution-desk-be/src/models/Test.ts")).default;

function createMockRequest({
  method = "GET",
  url = "http://localhost:3000/api",
  headers = {},
  body = null,
} = {}) {
  const headerMap = new Map();
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase(), v);
  }

  return {
    method,
    nextUrl: new URL(url),
    headers: {
      get: (name) => headerMap.get(name.toLowerCase()) || null,
    },
    cookies: {
      get: (name) => undefined,
    },
    json: async () => body || {},
  };
}

test("TuitionDesk Phase 2K: Production Launch Readiness Suite", async (t) => {
  // ---------------------------------------------------------------------------
  // 1. PAYMENT SYSTEM VERIFICATION
  // ---------------------------------------------------------------------------
  await t.test("1.1 Payment System: YouPi webhook signature timing-safe validation", async () => {
    // Missing secret header -> 401
    const reqNoHeader = createMockRequest({
      method: "POST",
      url: "http://localhost:3000/api/webhooks/youpi",
      headers: {},
      body: {},
    });
    const resNoHeader = await youpiWebhookRoute(reqNoHeader);
    assert.equal(resNoHeader.status, 401);

    // Invalid secret header -> 401
    const reqBadHeader = createMockRequest({
      method: "POST",
      url: "http://localhost:3000/api/webhooks/youpi",
      headers: { "x-youpi-secret": "wrong_secret_key" },
      body: {},
    });
    const resBadHeader = await youpiWebhookRoute(reqBadHeader);
    assert.equal(resBadHeader.status, 401);

    // Timing-safe comparison handles mismatched buffer length safely without throwing
    const reqDiffLen = createMockRequest({
      method: "POST",
      url: "http://localhost:3000/api/webhooks/youpi",
      headers: { "x-youpi-secret": "short" },
      body: {},
    });
    const resDiffLen = await youpiWebhookRoute(reqDiffLen);
    assert.equal(resDiffLen.status, 401);
  });

  await t.test("1.2 Payment System: Webhook duplicate delivery idempotency", async () => {
    const feeId = "507f191e810c19729de860e1";
    const txnId = "UPI_TXN_DUP_001";

    const mockFee = {
      _id: feeId,
      centerId: "center_alpha",
      studentId: "student_01",
      status: "Partial Paid",
      amountDue: 500,
      paidAmount: 1000,
      processedTxnIds: [txnId],
      paymentTransactions: [{ txnId, amount: 1000, status: "SUCCESS" }],
    };

    FeeModel.findById = async () => mockFee;

    const reqDuplicate = createMockRequest({
      method: "POST",
      headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
      body: {
        transactionNote: `FEE-${feeId}`,
        amount: 1000,
        upiTransactionId: txnId,
        status: "SUCCESS",
      },
    });

    const res = await youpiWebhookRoute(reqDuplicate);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.duplicate, true);
    assert.match(data.message, /duplicate webhook delivery ignored/i);
  });

  await t.test("1.3 Payment System: Partial and Full settlement with receipt generation", async () => {
    const feeId = "507f191e810c19729de860e2";
    let currentAmountDue = 2000;
    let currentPaidAmount = 0;
    let currentStatus = "Pending";
    let assignedReceipt = null;

    FeeModel.findById = async () => ({
      _id: feeId,
      amountDue: currentAmountDue,
      paidAmount: currentPaidAmount,
      status: currentStatus,
      processedTxnIds: [],
    });

    FeeModel.findOneAndUpdate = async (filter, update) => {
      if (filter.amountDue && filter.amountDue < 800) return null;
      if (update.$inc) {
        if (update.$inc.amountDue) currentAmountDue += update.$inc.amountDue;
        if (update.$inc.paidAmount) currentPaidAmount += update.$inc.paidAmount;
      }
      if (update.$set) {
        if (update.$set.status) currentStatus = update.$set.status;
        if (update.$set.receiptNumber) assignedReceipt = update.$set.receiptNumber;
        if (update.$set.amountDue !== undefined) currentAmountDue = update.$set.amountDue;
      }
      return {
        _id: feeId,
        status: currentStatus,
        amountDue: currentAmountDue,
        paidAmount: currentPaidAmount,
        receiptNumber: assignedReceipt,
      };
    };

    // Step A: Partial payment of 800
    const reqPartial = createMockRequest({
      method: "POST",
      headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
      body: {
        transactionNote: `FEE-${feeId}`,
        amount: 800,
        upiTransactionId: "UPI_TXN_PARTIAL_101",
        status: "SUCCESS",
      },
    });
    const resPartial = await youpiWebhookRoute(reqPartial);
    assert.equal(resPartial.status, 200);
    const partialData = await resPartial.json();
    assert.equal(partialData.data.status, "Partial Paid");
    assert.equal(partialData.data.remainingDue, 1200);

    // Step B: Full settlement of remaining 1200
    const reqFull = createMockRequest({
      method: "POST",
      headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
      body: {
        transactionNote: `FEE-${feeId}`,
        amount: 1200,
        upiTransactionId: "UPI_TXN_FULL_102",
        status: "SUCCESS",
      },
    });
    const resFull = await youpiWebhookRoute(reqFull);
    assert.equal(resFull.status, 200);
    const fullData = await resFull.json();
    assert.equal(fullData.data.status, "Paid");
    assert.equal(fullData.data.remainingDue, 0);
    assert.ok(fullData.data.receiptNumber.startsWith("RCPT-"), "Receipt number must be generated with RCPT- prefix");
  });

  await t.test("1.4 Payment System: Rejection of non-successful events and overpayment", async () => {
    const feeId = "507f191e810c19729de860e3";
    FeeModel.findById = async () => ({
      _id: feeId,
      amountDue: 1500,
      status: "Pending",
      processedTxnIds: [],
    });

    // Rejection of FAILED event
    const reqFailed = createMockRequest({
      method: "POST",
      headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
      body: {
        transactionNote: `FEE-${feeId}`,
        amount: 1500,
        upiTransactionId: "UPI_FAIL_01",
        status: "FAILED",
      },
    });
    const resFailed = await youpiWebhookRoute(reqFailed);
    assert.equal(resFailed.status, 400);

    // Rejection of overpayment (> outstanding balance)
    const reqOverpay = createMockRequest({
      method: "POST",
      headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
      body: {
        transactionNote: `FEE-${feeId}`,
        amount: 2500, // exceeds 1500
        upiTransactionId: "UPI_OVERPAY_01",
        status: "SUCCESS",
      },
    });
    const resOverpay = await youpiWebhookRoute(reqOverpay);
    assert.equal(resOverpay.status, 400);
    const overpayData = await resOverpay.json();
    assert.match(overpayData.error, /exceeds outstanding balance/i);
  });

  // ---------------------------------------------------------------------------
  // 2. FEE SYSTEM VERIFICATION
  // ---------------------------------------------------------------------------
  await t.test("2.1 Fee System: Cron fee generation requires CRON_SECRET & distributed lock coordination", async () => {
    // Unauthenticated cron fails with 401
    const reqUnauth = createMockRequest({
      url: "http://localhost:3000/api/cron/generate-fees",
      headers: {},
    });
    const resUnauth = await cronGenerateFeesRoute(reqUnauth);
    assert.equal(resUnauth.status, 401);

    // Mock student and models for authorized cron run
    StudentModel.find = async () => [
      {
        _id: "student_cron_01",
        centerId: "center_alpha",
        name: "Pooja Sharma",
        monthlyFee: 1800,
        billingCycleDate: 1,
        isActive: true,
      },
    ];
    StudentModel.findById = async () => ({
      _id: "student_cron_01",
      centerId: "center_alpha",
      name: "Pooja Sharma",
      monthlyFee: 1800,
      billingCycleDate: 1,
      isActive: true,
    });
    CenterModel.findOne = async () => ({ dueDateOffsetDays: 5 });
    FeeModel.findOne = async () => null;
    FeeModel.find = async () => [];

    let lockCreated = false;
    FeeCreationLockModel.collection = {
      indexes: async () => [
        { key: { lockKey: 1 }, unique: true, name: "lockKey_1" },
        { key: { expiresAt: 1 }, expireAfterSeconds: 600, name: "expiresAt_1" },
      ],
    };
    FeeCreationLockModel.create = async (doc) => {
      lockCreated = true;
      return doc;
    };
    FeeCreationLockModel.deleteOne = async () => ({ deletedCount: 1 });

    let feeCreated = null;
    FeeModel.create = async (doc) => {
      feeCreated = { _id: "fee_created_cron", ...doc };
      return feeCreated;
    };

    const reqAuth = createMockRequest({
      url: "http://localhost:3000/api/cron/generate-fees?day=1&centerId=center_alpha",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const resAuth = await cronGenerateFeesRoute(reqAuth);
    assert.equal(resAuth.status, 200);
    const cronData = await resAuth.json();
    assert.equal(cronData.generatedCount, 1);
    assert.ok(lockCreated, "Must coordinate recurring fee generation through FeeCreationLock");
    assert.ok(feeCreated !== null);
    assert.match(feeCreated.billingMonth, /^\d{4}-\d{2}$/);
  });

  await t.test("2.2 Fee System: Student deletion protection with active fee obligations", async () => {
    const studentId = "507f191e810c19729de860e4";
    const centerId = "center_alpha";
    const token = await signToken({ centerId, role: "owner" });

    StudentModel.findById = async () => ({
      _id: studentId,
      centerId,
      name: "Kabir",
      isActive: true,
    });

    // Case A: Unresolved fee exists -> 409 Conflict
    FeeModel.countDocuments = async () => 1;
    const reqBlocked = createMockRequest({
      method: "DELETE",
      url: `http://localhost:3000/api/students/${studentId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const resBlocked = await deleteStudentRoute(reqBlocked, { params: Promise.resolve({ id: studentId }) });
    assert.equal(resBlocked.status, 409);
    const blockedData = await resBlocked.json();
    assert.equal(blockedData.code, "UNRESOLVED_FEES_EXIST");

    // Case B: Zero unresolved fees but historical records exist -> Soft-deactivate (isActive = false)
    FeeModel.countDocuments = async () => 0;
    FeeModel.exists = async () => true;
    AttendanceModel.exists = async () => false;
    TestModel.exists = async () => false;

    let savedStudent = null;
    StudentModel.findById = async () => ({
      _id: studentId,
      centerId,
      name: "Kabir",
      isActive: true,
      save: async function () {
        savedStudent = this;
      },
    });

    const resSoftDeact = await deleteStudentRoute(reqBlocked, { params: Promise.resolve({ id: studentId }) });
    assert.equal(resSoftDeact.status, 200);
    const deactData = await resSoftDeact.json();
    assert.equal(deactData.action, "deactivated");
    assert.equal(savedStudent.isActive, false);
  });

  // ---------------------------------------------------------------------------
  // 3. REMINDER SYSTEM VERIFICATION
  // ---------------------------------------------------------------------------
  await t.test("3.1 Reminder System: Eligibility filters (Paid, inactive, Verification Pending)", async () => {
    const studentActive = { name: "Aarav", isActive: true };
    const studentInactive = { name: "Inactive Student", isActive: false };

    // Paid fee -> ineligible
    assert.equal(checkReminderEligibility({ status: "Paid" }, studentActive).eligible, false);

    // Verification Pending fee -> ineligible
    assert.equal(checkReminderEligibility({ status: "Verification Pending" }, studentActive).eligible, false);

    // Reminders paused -> ineligible
    assert.equal(checkReminderEligibility({ status: "Pending", reminderPaused: true }, studentActive).eligible, false);

    // Inactive student -> ineligible
    assert.equal(checkReminderEligibility({ status: "Pending" }, studentInactive).eligible, false);

    // Active Pending fee -> eligible
    assert.equal(checkReminderEligibility({ status: "Pending" }, studentActive).eligible, true);

    // Active Partial Paid fee -> eligible
    assert.equal(checkReminderEligibility({ status: "Partial Paid" }, studentActive).eligible, true);
  });

  await t.test("3.2 Reminder System: WhatsApp live dispatch fail-closed simulation guard", async () => {
    // Default mode: simulation
    const originalMode = process.env.WHATSAPP_MODE;
    const originalOptIn = process.env.ENABLE_LIVE_WHATSAPP;

    try {
      delete process.env.WHATSAPP_MODE;
      delete process.env.ENABLE_LIVE_WHATSAPP;
      assert.equal(isLiveDispatchEnabled(), false);

      process.env.WHATSAPP_MODE = "live";
      delete process.env.ENABLE_LIVE_WHATSAPP;
      assert.equal(isLiveDispatchEnabled(), false, "Missing opt-in must fail closed");

      process.env.WHATSAPP_MODE = "live";
      process.env.ENABLE_LIVE_WHATSAPP = "false";
      assert.equal(isLiveDispatchEnabled(), false, "False opt-in must fail closed");

      process.env.WHATSAPP_MODE = "live";
      process.env.ENABLE_LIVE_WHATSAPP = "true";
      assert.equal(isLiveDispatchEnabled(), true, "Dual opt-in enables live dispatch");
    } finally {
      process.env.WHATSAPP_MODE = originalMode;
      process.env.ENABLE_LIVE_WHATSAPP = originalOptIn;
    }
  });

  // ---------------------------------------------------------------------------
  // 4. SECURITY & DATA ISOLATION VERIFICATION
  // ---------------------------------------------------------------------------
  await t.test("4.1 Security: Multi-tenant center data isolation on advance fees and fee updates", async () => {
    const studentInCenterA = {
      _id: "507f191e810c19729de860e5",
      centerId: "center_alpha",
    };
    StudentModel.findById = async () => studentInCenterA;

    // Caller authenticated to Center B attempts to create advance fee for student in Center A
    const tokenCenterB = await signToken({ centerId: "center_beta", role: "owner" });
    const reqCrossCenter = createMockRequest({
      method: "POST",
      headers: { authorization: `Bearer ${tokenCenterB}` },
      body: {
        studentId: studentInCenterA._id,
        amount: 2000,
      },
    });

    const resAdvance = await advanceFeeRoute(reqCrossCenter);
    assert.equal(resAdvance.status, 403);
    const advanceData = await resAdvance.json();
    assert.match(advanceData.error, /outside authenticated center/i);
  });

  await t.test("4.2 Security: Unauthenticated access rejected in production mode", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      // Owner Dashboard unauthenticated access blocked with 401
      const reqDash = createMockRequest({
        url: "http://localhost:3000/api/dashboard/owner?centerId=center_alpha",
        headers: { "x-center-id": "center_alpha" },
      });
      const resDash = await ownerDashboardRoute(reqDash);
      assert.equal(resDash.status, 401);

      // Center Settings PUT unauthenticated access blocked with 401
      const reqSettings = createMockRequest({
        method: "PUT",
        headers: { "x-center-id": "center_alpha" },
        body: { centerId: "center_alpha", upiId: "malicious@upi" },
      });
      const resSettings = await centerSettingsRoute(reqSettings);
      assert.equal(resSettings.status, 401);

      // Fee DELETE unauthenticated access blocked with 401
      const reqDelete = createMockRequest({
        method: "DELETE",
        headers: {},
      });
      const resDelete = await deleteFeeRoute(reqDelete, { params: Promise.resolve({ feeId: "507f191e810c19729de860e6" }) });
      assert.equal(resDelete.status, 401);

      // CORS excludes localhost by default in production
      const origins = getAllowedOrigins();
      assert.equal(origins.has("http://localhost:3000"), false);
      assert.equal(origins.has("http://127.0.0.1:3000"), false);
      assert.ok(origins.has("https://tuition-desk-one.vercel.app"));
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  // ---------------------------------------------------------------------------
  // 5. PRODUCTION ENVIRONMENT & CONFIGURATION VALIDATION
  // ---------------------------------------------------------------------------
  await t.test("5.1 Configuration: Environment validator detects missing secrets and localhost leaks", async () => {
    // Incomplete environment
    const testEnvIncomplete = {
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://localhost:27017/test",
      JWT_SECRET: "short_secret", // < 32 chars
    };

    const resIncomplete = validateEnvironment(testEnvIncomplete);
    assert.equal(resIncomplete.valid, false);
    assert.ok(resIncomplete.criticalCount > 0);

    const missingVars = resIncomplete.issues.map((i) => i.variable);
    assert.ok(missingVars.includes("CRON_SECRET"));
    assert.ok(missingVars.includes("YOUPI_WEBHOOK_SECRET"));
    assert.ok(missingVars.includes("WHATSAPP_INTERNAL_SECRET"));
    assert.ok(missingVars.includes("APP_URL"));

    // Complete valid environment
    const testEnvComplete = {
      NODE_ENV: "production",
      MONGODB_URI: "mongodb+srv://mock_app_user:mock_password_123@cluster0.generic-mock.mongodb.net/test",
      JWT_SECRET: "strong_production_jwt_secret_min_32_characters_long",
      YOUPI_WEBHOOK_SECRET: "youpi_pg_prod_webhook_secret_2026",
      CRON_SECRET: "cron_scheduler_production_secret_key_32_chars",
      WHATSAPP_INTERNAL_SECRET: "whatsapp_internal_secret_production_32_chars",
      APP_URL: "https://tuition-desk-one.vercel.app",
      WHATSAPP_MODE: "simulation",
      ENABLE_LIVE_WHATSAPP: "false",
    };

    const resComplete = validateEnvironment(testEnvComplete);
    assert.equal(resComplete.valid, true);
    assert.equal(resComplete.criticalCount, 0);
    assert.ok(resComplete.configSummary.JWT_SECRET.includes("...")); // masked
    assert.equal(resComplete.configSummary.APP_URL, "https://tuition-desk-one.vercel.app");
  });
});
