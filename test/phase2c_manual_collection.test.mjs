process.env.JWT_SECRET = "tuition-desk-test-jwt-secret-key-32-chars-ok";
globalThis.mongooseCache = { conn: {}, promise: Promise.resolve({}) };

import test from "node:test";
import assert from "node:assert/strict";

const { signToken } = await import("../tution-desk-be/src/lib/auth.ts");
const StudentModel = (await import("../tution-desk-be/src/models/Student.ts")).default;
const FeeModel = (await import("../tution-desk-be/src/models/Fee.ts")).default;
const { POST: manualCollectionRoute } = await import(
  "../tution-desk-be/src/app/api/fees/manual-collection/route.ts"
);

function createMockRequest({
  method = "POST",
  token,
  body,
  headers = {},
}) {
  const reqHeaders = new Headers(headers);
  if (token) {
    reqHeaders.set("authorization", `Bearer ${token}`);
  }
  return {
    method,
    headers: reqHeaders,
    cookies: {
      get: () => undefined,
    },
    nextUrl: new URL("http://localhost:3000/api/fees/manual-collection"),
    json: async () => body || {},
  };
}

test("TuitionDesk P0: Cash Collection Deduplication & Settlement Suite", async (t) => {
  const centerId = "center_alpha";
  const studentId = "507f191e810c19729de860ea";
  const token = await signToken({ centerId, role: "owner" });

  const mockStudent = {
    _id: studentId,
    centerId,
    name: "Rohan Gupta",
    monthlyFee: 2000,
    isActive: true,
  };

  // =========================================================================
  // 1. SETTLE EXISTING PENDING MONTHLY FEE
  // =========================================================================
  await t.test("1. Settles existing Pending monthly fee instead of creating a second invoice", async () => {
    const existingPendingFee = {
      _id: "fee_pending_oct_101",
      centerId,
      studentId,
      billingMonth: "2026-10",
      month: "October 2026",
      status: "Pending",
      amountDue: 2000,
      paidAmount: 0,
      feeType: "monthly_recurring",
      notes: "Auto-generated invoice",
    };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [existingPendingFee];

    let updatedDoc = null;
    FeeModel.findOneAndUpdate = (query, update) => {
      assert.equal(query._id, "fee_pending_oct_101");
      assert.deepEqual(query.status, { $in: ["Pending", "Partial Paid"] });
      updatedDoc = {
        ...existingPendingFee,
        ...update.$set,
      };
      return {
        populate: async () => updatedDoc,
      };
    };

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 2000,
        billingMonth: "2026-10",
        notes: "Paid in full at front desk",
      },
    });

    const res = await manualCollectionRoute(req);
    const json = await res.json();
    assert.equal(res.status, 200);

    assert.equal(json.success, true);
    assert.equal(json.settledExisting, true);
    assert.equal(json.data._id, "fee_pending_oct_101", "Must preserve existing fee ID");
    assert.equal(json.data.status, "Paid");
    assert.equal(json.data.paidAmount, 2000);
    assert.equal(json.data.amountDue, 0, "amountDue must be 0 after full settlement");
    assert.equal(json.data.paymentMode, "Cash");
    assert.ok(json.data.receiptNumber.startsWith("RCPT-"));
    assert.ok(json.data.notes.includes("Cash collected: ₹2000"));
  });

  // =========================================================================
  // 2. SETTLE EXISTING PARTIAL PAID MONTHLY FEE (FINAL CLEARANCE)
  // =========================================================================
  await t.test("2. Clears remaining balance on an existing Partial Paid monthly fee", async () => {
    const existingPartialFee = {
      _id: "fee_partial_oct_102",
      centerId,
      studentId,
      billingMonth: "2026-10",
      month: "October 2026",
      status: "Partial Paid",
      amountDue: 800,       // remaining due
      paidAmount: 1200,     // already collected
      feeType: "monthly_recurring",
      notes: "Initial partial payment of 1200",
    };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [existingPartialFee];

    let updatedDoc = null;
    FeeModel.findOneAndUpdate = (query, update) => {
      updatedDoc = {
        ...existingPartialFee,
        ...update.$set,
      };
      return {
        populate: async () => updatedDoc,
      };
    };

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 800,
        billingMonth: "2026-10",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.settledExisting, true);
    assert.equal(json.data.status, "Paid");
    assert.equal(json.data.paidAmount, 2000, "1200 + 800 = 2000 total settled");
    assert.equal(json.data.amountDue, 0, "amountDue must be 0 after full settlement");
  });

  // =========================================================================
  // 3. PARTIAL CASH PAYMENT ON PENDING FEE
  // =========================================================================
  await t.test("3. Partial cash payment updates remaining due and sets status to Partial Paid", async () => {
    const existingPendingFee = {
      _id: "fee_pending_oct_103",
      centerId,
      studentId,
      billingMonth: "2026-10",
      month: "October 2026",
      status: "Pending",
      amountDue: 2000,
      paidAmount: 0,
      feeType: "monthly_recurring",
    };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [existingPendingFee];

    let updatedDoc = null;
    FeeModel.findOneAndUpdate = (query, update) => {
      updatedDoc = {
        ...existingPendingFee,
        ...update.$set,
      };
      return {
        populate: async () => updatedDoc,
      };
    };

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 500, // Partial cash payment
        billingMonth: "2026-10",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.settledExisting, true);
    assert.equal(json.data.status, "Partial Paid");
    assert.equal(json.data.paidAmount, 500);
    assert.equal(json.data.amountDue, 1500, "Remaining due is 2000 - 500 = 1500");
  });

  // =========================================================================
  // 4. NO EXISTING FEE -> PRESERVES STANDALONE CREATION
  // =========================================================================
  await t.test("4. Creates new Paid record when zero candidate fees exist", async () => {
    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => []; // No candidates

    let createdRecord = null;
    FeeModel.create = async (doc) => {
      createdRecord = { _id: "new_cash_fee_999", ...doc };
      return createdRecord;
    };
    FeeModel.findById = () => ({
      populate: async () => createdRecord,
    });

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 2500,
        billingMonth: "2026-11",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 201);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.settledExisting, false);
    assert.equal(json.data._id, "new_cash_fee_999");
    assert.equal(json.data.status, "Paid");
    assert.equal(json.data.amountDue, 2500);
    assert.equal(json.data.paidAmount, 2500);
  });

  // =========================================================================
  // 5. ALREADY PAID FEE -> BLOCKS DUPLICATE COLLECTION
  // =========================================================================
  await t.test("5. Rejects duplicate collection if candidate is already Paid (409 Conflict)", async () => {
    const existingPaidFee = {
      _id: "fee_already_paid",
      centerId,
      studentId,
      billingMonth: "2026-10",
      status: "Paid",
      receiptNumber: "RCPT-ORIG-01",
      feeType: "monthly_recurring",
    };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [existingPaidFee];

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 2000,
        billingMonth: "2026-10",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 409);
    const json = await res.json();

    assert.equal(json.success, false);
    assert.equal(json.code, "FEE_ALREADY_PAID");
    assert.ok(json.error.includes("already Paid in full"));
  });

  // =========================================================================
  // 6. MULTIPLE CANDIDATE FEES -> REQUIRES MANUAL REVIEW
  // =========================================================================
  await t.test("6. Multiple matching candidate records halts and returns 409 MULTIPLE_CANDIDATE_FEES", async () => {
    const candidate1 = { _id: "c1", status: "Pending", billingMonth: "2026-10" };
    const candidate2 = { _id: "c2", status: "Pending", billingMonth: "2026-10" };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [candidate1, candidate2];

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 2000,
        billingMonth: "2026-10",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 409);
    const json = await res.json();

    assert.equal(json.success, false);
    assert.equal(json.code, "MULTIPLE_CANDIDATE_FEES");
    assert.ok(json.error.includes("Multiple candidate fee records"));
  });

  // =========================================================================
  // 7. VERIFICATION PENDING CONFLICT -> REQUIRES GATEWAY RESOLUTION
  // =========================================================================
  await t.test("7. Verification Pending candidate returns 409 VERIFICATION_PENDING_CONFLICT", async () => {
    const candidateVerif = {
      _id: "c_verif",
      status: "Verification Pending",
      billingMonth: "2026-10",
      utrNumber: "UPI123456789",
    };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [candidateVerif];

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 2000,
        billingMonth: "2026-10",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 409);
    const json = await res.json();

    assert.equal(json.success, false);
    assert.equal(json.code, "VERIFICATION_PENDING_CONFLICT");
    assert.ok(json.error.includes("online payment verification is currently pending"));
  });

  // =========================================================================
  // 8. NON-RECURRING FEE (ADVANCE / REGISTRATION / ADHOC)
  // =========================================================================
  await t.test("8. Non-recurring fee types (advance, registration) retain standalone creation behavior", async () => {
    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);

    let createdNonRecurring = null;
    FeeModel.create = async (doc) => {
      createdNonRecurring = { _id: "adv_fee_101", ...doc };
      return createdNonRecurring;
    };
    FeeModel.findById = () => ({
      populate: async () => createdNonRecurring,
    });

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 5000,
        type: "advance",
        notes: "Advance tuition deposit",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 201);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.settledExisting, false);
    assert.equal(createdNonRecurring.feeType, "advance");
    assert.equal(createdNonRecurring.isAdvance, true);
    assert.equal(createdNonRecurring.billingMonth, undefined);
  });

  // =========================================================================
  // 9. EXCESSIVE COLLECTION AMOUNT
  // =========================================================================
  await t.test("9. Excessive collection amount (> outstanding balance) returns 400 Bad Request", async () => {
    const existingFee = {
      _id: "fee_pending_1000",
      centerId,
      studentId,
      billingMonth: "2026-10",
      status: "Pending",
      amountDue: 1500, // Outstanding balance is 1500
      paidAmount: 0,
      feeType: "monthly_recurring",
    };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [existingFee];

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 2000, // 2000 > 1500 -> Invalid
        billingMonth: "2026-10",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 400);
    const json = await res.json();

    assert.equal(json.success, false);
    assert.equal(json.code, "EXCESSIVE_PAYMENT_AMOUNT");
    assert.ok(json.error.includes("exceeds the remaining balance"));
  });

  // =========================================================================
  // 10. CONCURRENT MODIFICATION CONFLICT / ATOMIC GUARD
  // =========================================================================
  await t.test("10. Concurrent race where status changes before update returns 409 Conflict", async () => {
    const existingFee = {
      _id: "fee_race_101",
      centerId,
      studentId,
      billingMonth: "2026-10",
      status: "Pending",
      amountDue: 2000,
      paidAmount: 0,
      feeType: "monthly_recurring",
    };

    StudentModel.findById = async (id) => (id === studentId ? mockStudent : null);
    FeeModel.find = async () => [existingFee];

    // Simulate concurrent transition: findOneAndUpdate returns null because status is no longer Pending/Partial Paid
    FeeModel.findOneAndUpdate = () => ({
      populate: async () => null,
    });

    const req = createMockRequest({
      token,
      body: {
        studentId,
        centerId,
        amount: 2000,
        billingMonth: "2026-10",
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 409);
    const json = await res.json();

    assert.equal(json.success, false);
    assert.equal(json.code, "CONCURRENT_MODIFICATION_CONFLICT");
  });

  // =========================================================================
  // 11. CROSS-CENTER AUTHORIZATION GUARD
  // =========================================================================
  await t.test("11. Student outside authenticated center returns 403 Forbidden", async () => {
    const foreignStudent = {
      _id: studentId,
      centerId: "center_foreign", // Does not match token's center_alpha
      name: "Foreign Student",
    };

    StudentModel.findById = async () => foreignStudent;

    const req = createMockRequest({
      token,
      body: {
        studentId,
        amount: 1000,
      },
    });

    const res = await manualCollectionRoute(req);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.ok(json.error.includes("Unauthorized access"));
  });
});
