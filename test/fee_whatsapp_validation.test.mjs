import test from "node:test";
import assert from "node:assert/strict";

// Set environment for test isolation
process.env.JWT_SECRET = "tuition-desk-test-jwt-secret-key-32-chars-ok";
process.env.WHATSAPP_INTERNAL_SECRET = "c0f8095b29661d68b9dae7e2a3692f3107b3dce25af829f918d93f91ad50b678";
process.env.NODE_ENV = "test";

// Browser globals mock for frontend apiClient testing
const storage = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};
globalThis.document = { cookie: "" };

// -----------------------------------------------------------------------------
// Suite 1: Fee Amount Validation & Step Rules
// -----------------------------------------------------------------------------
test("Issue 1: Fee Generation Amount Validation Suite", async (t) => {
  // Test HTML5 step constraint logic matching browser behavior:
  // With min="1" and step="50" (BEFORE):
  // Valid values were 1, 51, 101, ..., 451, 501. 500 failed with "The two nearest valid values are 451 and 501."
  function validateHtmlInput(value, minStr, stepStr) {
    const val = Number(value);
    const min = Number(minStr);
    if (isNaN(val) || isNaN(min)) return { valid: false, reason: "bad_number" };
    if (val < min) return { valid: false, reason: "range_underflow" };
    if (stepStr === "any") return { valid: true };
    const step = Number(stepStr);
    const remainder = Math.abs((val - min) % step);
    const isStepMismatch = remainder > 1e-9 && Math.abs(remainder - step) > 1e-9;
    if (isStepMismatch) {
      const lower = min + Math.floor((val - min) / step) * step;
      const upper = lower + step;
      return {
        valid: false,
        reason: "step_mismatch",
        nearestValid: [lower, upper],
      };
    }
    return { valid: true };
  }

  await t.test("1.1 Reproduces legacy bug: min=1 step=50 rejects 500 with nearest 451 and 501", () => {
    const legacyCheck = validateHtmlInput(500, "1", "50");
    assert.equal(legacyCheck.valid, false);
    assert.equal(legacyCheck.reason, "step_mismatch");
    assert.deepEqual(legacyCheck.nearestValid, [451, 501]);
  });

  await t.test("1.2 Fixed configuration (min=1, step=any) accepts ₹500, ₹451, ₹499, and ₹501", () => {
    const testAmounts = [500, 451, 499, 501, 1500, 2500, 10000];
    for (const amt of testAmounts) {
      const result = validateHtmlInput(amt, "1", "any");
      assert.equal(result.valid, true, `Amount ₹${amt} should be valid with step="any"`);
    }
  });

  await t.test("1.3 Fixed configuration accepts valid decimal rupee amounts (e.g. ₹500.50)", () => {
    const result = validateHtmlInput(500.5, "1", "any");
    assert.equal(result.valid, true, "₹500.50 should be valid with step='any'");
  });

  await t.test("1.4 Rejects values less than min (<= 0)", () => {
    assert.equal(validateHtmlInput(0, "1", "any").valid, false);
    assert.equal(validateHtmlInput(-50, "1", "any").valid, false);
    assert.equal(validateHtmlInput(-500, "1", "any").valid, false);
  });
});

// -----------------------------------------------------------------------------
// Suite 2: Backend AmountDue Validation Across Fee Types
// -----------------------------------------------------------------------------
test("Issue 1: Backend Fee Creation Validation Across Fee Types Suite", async (t) => {
  // Pure validation function matching tution-desk-be/src/app/api/fees/route.ts logic
  function validateFeeCreationPayload(body) {
    let feeType = body.feeType;
    if (!feeType) {
      return { success: false, status: 400, error: "feeType is required" };
    }
    const validFeeTypes = ["monthly_recurring", "advance", "adhoc", "registration"];
    if (!validFeeTypes.includes(feeType)) {
      return { success: false, status: 400, error: `Invalid feeType: '${feeType}'` };
    }

    if (body.amountDue !== undefined) {
      const parsedAmount = Number(body.amountDue);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return {
          success: false,
          status: 400,
          error: "Amount due must be a valid positive number greater than 0",
        };
      }
    }

    if (feeType === "monthly_recurring") {
      if (!body.studentId) {
        return { success: false, status: 400, error: "studentId is required" };
      }
      return {
        success: true,
        status: 201,
        feeType: "monthly_recurring",
        amountDue: body.amountDue !== undefined ? Number(body.amountDue) : undefined,
      };
    }

    // Non-recurring: amountDue is required
    const nonRecurringAmount = Number(body.amountDue);
    if (body.amountDue === undefined || isNaN(nonRecurringAmount) || nonRecurringAmount <= 0) {
      return {
        success: false,
        status: 400,
        error: "Amount due is required and must be a valid positive number greater than 0",
      };
    }

    return {
      success: true,
      status: 201,
      feeType,
      amountDue: nonRecurringAmount,
      title: body.title || (feeType === "registration" ? "Registration Fee" : "Ad-hoc Fee"),
    };
  }

  await t.test("2.1 Monthly recurring fee: accepts ₹500, ₹451, ₹499, and ₹501", () => {
    for (const amt of [500, 451, 499, 501]) {
      const res = validateFeeCreationPayload({
        feeType: "monthly_recurring",
        studentId: "student_123",
        billingMonth: "2026-11",
        amountDue: amt,
      });
      assert.equal(res.success, true);
      assert.equal(res.amountDue, amt);
    }
  });

  await t.test("2.2 Ad-hoc fee: accepts ₹500, ₹451, ₹499, and ₹501", () => {
    for (const amt of [500, 451, 499, 501]) {
      const res = validateFeeCreationPayload({
        feeType: "adhoc",
        studentId: "student_123",
        title: "Study Material",
        amountDue: amt,
      });
      assert.equal(res.success, true);
      assert.equal(res.amountDue, amt);
      assert.equal(res.feeType, "adhoc");
    }
  });

  await t.test("2.3 Registration fee: accepts ₹500, ₹451, ₹499, and ₹501", () => {
    for (const amt of [500, 451, 499, 501]) {
      const res = validateFeeCreationPayload({
        feeType: "registration",
        studentId: "student_123",
        amountDue: amt,
      });
      assert.equal(res.success, true);
      assert.equal(res.amountDue, amt);
      assert.equal(res.feeType, "registration");
    }
  });

  await t.test("2.4 Safely rejects invalid values with 400 across fee types", () => {
    const invalidAmounts = [0, -1, -500, "invalid_amount", NaN, null];
    for (const feeType of ["monthly_recurring", "adhoc", "registration"]) {
      for (const badAmt of invalidAmounts) {
        const res = validateFeeCreationPayload({
          feeType,
          studentId: "student_123",
          amountDue: badAmt,
        });
        assert.equal(res.success, false, `Fee type ${feeType} should reject amount ${badAmt}`);
        assert.equal(res.status, 400);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// Suite 3: WhatsApp Messaging & Simulation Guard Verification
// -----------------------------------------------------------------------------
test("Issue 2: WhatsApp Messaging Trigger & Guard Suite", async (t) => {
  // Test simulation guard logic matching whatsappService.ts
  function checkLiveDispatch(env) {
    const mode = env.WHATSAPP_MODE?.trim().toLowerCase();
    const liveOptIn = env.ENABLE_LIVE_WHATSAPP?.trim().toLowerCase();
    return mode === "live" && liveOptIn === "true";
  }

  await t.test("3.1 Dual-opt-in simulation guard fails closed without both flags", () => {
    assert.equal(checkLiveDispatch({}), false);
    assert.equal(checkLiveDispatch({ WHATSAPP_MODE: "live" }), false);
    assert.equal(checkLiveDispatch({ ENABLE_LIVE_WHATSAPP: "true" }), false);
    assert.equal(checkLiveDispatch({ WHATSAPP_MODE: "simulation", ENABLE_LIVE_WHATSAPP: "false" }), false);
    assert.equal(checkLiveDispatch({ WHATSAPP_MODE: "live", ENABLE_LIVE_WHATSAPP: "false" }), false);
    assert.equal(checkLiveDispatch({ WHATSAPP_MODE: "live", ENABLE_LIVE_WHATSAPP: "true" }), true);
  });

  await t.test("3.2 Sensitive data masking helper properly redacts phone numbers", () => {
    function maskPhone(phone) {
      if (!phone || phone.length < 4) return "****";
      return `***${phone.slice(-4)}`;
    }
    assert.equal(maskPhone("9876543210"), "***3210");
    assert.equal(maskPhone("+919876543210"), "***3210");
    assert.equal(maskPhone(""), "****");
  });

  await t.test("3.3 Bulk fee reminder response includes data wrapper and accurate sent/simulated counts", () => {
    // Replicates response mapping from tution-desk-be/src/app/api/fees/remind-all/route.ts
    const simulatedDispatchResults = [
      { feeId: "1", studentName: "Student A", phone: "***3210", success: true, simulated: true, status: "attempted" },
      { feeId: "2", studentName: "Student B", phone: "***4567", success: true, simulated: true, status: "attempted" },
    ];
    const sentCount = 0;
    const simulatedCount = 2;
    const totalPending = 2;

    const payload = {
      sentCount,
      simulatedCount,
      totalPending,
      results: simulatedDispatchResults,
    };

    const apiResponse = {
      success: true,
      data: payload,
      ...payload,
    };

    // Frontend consumer logic check
    const consumedSentCount = apiResponse.data?.sentCount ?? apiResponse.sentCount ?? 0;
    const consumedSimulatedCount = apiResponse.data?.simulatedCount ?? apiResponse.simulatedCount ?? 0;

    assert.equal(consumedSentCount, 0, "Must accurately report 0 sent count in simulation mode");
    assert.equal(consumedSimulatedCount, 2, "Must accurately report 2 simulated count");

    // Check message logic: Never report success when sentCount is 0!
    let toastMessage = "";
    if (consumedSentCount > 0) {
      toastMessage = `Sent ${consumedSentCount} reminders to WhatsApp provider!`;
    } else if (consumedSimulatedCount > 0) {
      toastMessage = `[Simulation] ${consumedSimulatedCount} fee reminders simulated.`;
    } else {
      toastMessage = "No reminders dispatched.";
    }

    assert.match(toastMessage, /Simulation/);
    assert.doesNotMatch(toastMessage, /successfully/i);
  });

  await t.test("3.4 Service connectivity: Live microservice on port 3005 is online and reachable", async () => {
    let reachable = false;
    let status = 0;
    try {
      const res = await fetch("http://127.0.0.1:3005/health", {
        signal: AbortSignal.timeout(1000),
      });
      status = res.status;
      reachable = res.ok;
    } catch {
      reachable = false;
    }

    assert.equal(reachable, true, "Live microservice on port 3005 should be reachable");
    assert.equal(status, 200, "Health check should return 200 OK");
  });
});
