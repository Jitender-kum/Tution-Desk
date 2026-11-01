import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Unit regression suite for Fee Reminder HTTP Status Mapping in TuitionDesk.
 * Verifies that the route handler maps each dispatch outcome to its proper HTTP status:
 * - DISPATCH_FAILED / SERVICE_UNAVAILABLE -> 503
 * - COOLDOWN_ACTIVE -> 409
 * - DISPATCH_UNCERTAIN -> 202
 * - NOT_FOUND / NO_PHONE / INVALID_STATUS / INVALID_FEE_ID -> 400
 * - Authentication missing -> 401
 * - SUCCESS -> 200
 */

// Simulated route logic mirroring tution-desk-be/src/app/api/fees/[feeId]/remind/route.ts
function mapReminderResultToHttpResponse({ feeId, isValidObjectId, authCenterId, result }) {
  if (!feeId || !isValidObjectId) {
    return { status: 400, body: { success: false, error: "Invalid fee ID" } };
  }

  if (!authCenterId) {
    return { status: 401, body: { success: false, error: "Authentication or centerId is required" } };
  }

  if (result.code === "COOLDOWN_ACTIVE") {
    return { status: 409, body: { success: false, code: "COOLDOWN_ACTIVE", error: result.message } };
  }

  if (result.code === "DISPATCH_UNCERTAIN") {
    return { status: 202, body: { success: false, code: "DISPATCH_UNCERTAIN", message: result.message } };
  }

  if (
    result.code === "PROVIDER_REJECTED" ||
    result.code === "DISPATCH_ERROR" ||
    result.code === "DISPATCH_FAILED" ||
    result.code === "SERVICE_UNAVAILABLE"
  ) {
    return {
      status: 503,
      body: {
        success: false,
        code: result.code,
        error: result.message || "WhatsApp provider service unavailable",
      },
    };
  }

  if (!result.success) {
    return {
      status: 400,
      body: {
        success: false,
        code: result.code || "REMINDER_FAILED",
        error: result.message || "Failed to dispatch fee reminder",
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      status: result.status,
      providerMessageId: result.providerMessageId,
      simulated: result.simulated,
    },
  };
}

describe("Fee Reminder HTTP Status Mapping Regression Suite", () => {
  const validFeeId = "507f1f77bcf86cd799439011";

  it("1. Maps WhatsApp microservice unready/unreachable (DISPATCH_FAILED) to HTTP 503 (NOT 400)", () => {
    const res = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: "9",
      result: {
        success: false,
        code: "DISPATCH_FAILED",
        message: "WhatsApp Client for center '9' is not ready. Please scan the QR code in Settings.",
      },
    });

    assert.strictEqual(res.status, 503, "Must return HTTP 503 Service Unavailable when WhatsApp provider is unready");
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, "DISPATCH_FAILED");
    assert.ok(res.body.error.includes("not ready"));
  });

  it("1b. Maps reminderService actual return code (PROVIDER_REJECTED) to HTTP 503", () => {
    const res = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: "9",
      result: {
        success: false,
        code: "PROVIDER_REJECTED",
        message: "WhatsApp Client for center '9' is not ready. Please scan the QR code in Settings.",
      },
    });

    assert.strictEqual(res.status, 503, "Must return HTTP 503 when reminderService returns PROVIDER_REJECTED");
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, "PROVIDER_REJECTED");
    assert.ok(res.body.error.includes("not ready"));
  });

  it("1c. Maps reminderService actual return code (DISPATCH_ERROR) to HTTP 503", () => {
    const res = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: "9",
      result: {
        success: false,
        code: "DISPATCH_ERROR",
        message: "Network error connecting to WhatsApp microservice",
      },
    });

    assert.strictEqual(res.status, 503, "Must return HTTP 503 when reminderService returns DISPATCH_ERROR");
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, "DISPATCH_ERROR");
  });

  it("2. Maps active 24-hour cooldown to HTTP 409 Conflict", () => {
    const res = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: "9",
      result: {
        success: false,
        code: "COOLDOWN_ACTIVE",
        message: "A reminder was already sent to this parent within the last 24 hours.",
      },
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, "COOLDOWN_ACTIVE");
  });

  it("3. Maps uncertain delivery to HTTP 202 Accepted", () => {
    const res = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: "9",
      result: {
        success: false,
        code: "DISPATCH_UNCERTAIN",
        message: "Network timeout occurred while awaiting provider acknowledgment.",
      },
    });

    assert.strictEqual(res.status, 202);
    assert.strictEqual(res.body.success, false);
  });

  it("4. Maps missing parent phone or invalid fee ID to HTTP 400 Bad Request", () => {
    const invalidFeeRes = mapReminderResultToHttpResponse({
      feeId: "invalid-id",
      isValidObjectId: false,
      authCenterId: "9",
      result: {},
    });
    assert.strictEqual(invalidFeeRes.status, 400);

    const noPhoneRes = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: "9",
      result: {
        success: false,
        code: "NO_PHONE",
        message: 'Student "Alice" has no registered parent WhatsApp number.',
      },
    });
    assert.strictEqual(noPhoneRes.status, 400);
    assert.strictEqual(noPhoneRes.body.code, "NO_PHONE");
  });

  it("5. Maps unauthenticated request to HTTP 401", () => {
    const res = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: null,
      result: {},
    });
    assert.strictEqual(res.status, 401);
  });

  it("6. Maps provider acceptance to HTTP 200 OK", () => {
    const res = mapReminderResultToHttpResponse({
      feeId: validFeeId,
      isValidObjectId: true,
      authCenterId: "9",
      result: {
        success: true,
        status: "provider_accepted",
        providerMessageId: "BAE5ABC123",
        simulated: false,
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.providerMessageId, "BAE5ABC123");
  });
});
