process.env.JWT_SECRET = "tuition-desk-test-jwt-secret-key-32-chars-ok";
globalThis.mongooseCache = { conn: {}, promise: Promise.resolve({}) };

import test from "node:test";
import assert from "node:assert/strict";

// Import date utilities
const {
  getISTDateComponents,
  formatBillingMonth,
  calculateFirstBillingMonth,
  isStudentEligibleForBilling,
  calculateDueDate,
  isEligibleForFollowupReminder,
  isWithin24HourCooldown,
} = await import("../tution-desk-be/src/lib/dateUtils.ts");

// Import feeService utilities
const {
  generateOrGetMonthlyFee,
} = await import("../tution-desk-be/src/lib/feeService.ts");

// Import reminderService utilities
const {
  dispatchFeeReminder,
  checkReminderEligibility,
} = await import("../tution-desk-be/src/lib/reminderService.ts");

// Import authentication and route handlers for direct route testing
const { signToken } = await import("../tution-desk-be/src/lib/auth.ts");
const StudentModel = (await import("../tution-desk-be/src/models/Student.ts")).default;
const FeeModel = (await import("../tution-desk-be/src/models/Fee.ts")).default;
const AttendanceModel = (await import("../tution-desk-be/src/models/Attendance.ts")).default;
const TestModel = (await import("../tution-desk-be/src/models/Test.ts")).default;
const FeeReminderLogModel = (await import("../tution-desk-be/src/models/FeeReminderLog.ts")).default;
const CenterModel = (await import("../tution-desk-be/src/models/Center.ts")).default;
const FeeCreationLockModel = (await import("../tution-desk-be/src/models/FeeCreationLock.ts")).default;
const { DELETE: deleteStudentRoute } = await import("../tution-desk-be/src/app/api/students/[id]/route.ts");
const { POST: postFeeRoute } = await import("../tution-desk-be/src/app/api/fees/route.ts");
const { POST: remindFeeRoute } = await import("../tution-desk-be/src/app/api/fees/[feeId]/remind/route.ts");

function createMockRequest({
  method = "DELETE",
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
      get: (name) => undefined,
    },
    nextUrl: new URL("http://localhost:3000/api/mock"),
    json: async () => body || {},
  };
}

test("TuitionDesk Phase 2A: Comprehensive Fee & Reminder Test Suite", async (t) => {
  // =========================================================================
  // 1. DATE & TIMEZONE UTILITIES (Asia/Kolkata boundaries)
  // =========================================================================
  await t.test("1. IST Timezone boundary calculations", () => {
    // 2026-10-31 20:00:00 UTC is 2026-11-01 01:30:00 IST
    const lateUtc = new Date("2026-10-31T20:00:00.000Z");
    const ist = getISTDateComponents(lateUtc);

    assert.equal(ist.year, 2026);
    assert.equal(ist.month, 11);
    assert.equal(ist.day, 1);
    assert.equal(ist.billingMonth, "2026-11");
    assert.equal(formatBillingMonth(lateUtc), "2026-11");
  });

  await t.test("2. Mid-month joiner rule (joinDay >= billingCycleDay)", () => {
    // Billing cycle day is 5th of the month
    // Student joins on Oct 3rd (joinDay 3 < 5) -> eligible for Oct 2026
    const earlyJoiner = new Date("2026-10-03T10:00:00+05:30");
    assert.equal(calculateFirstBillingMonth(earlyJoiner, 5), "2026-10");
    assert.equal(isStudentEligibleForBilling(earlyJoiner, 5, "2026-10"), true);

    // Student joins on Oct 5th (joinDay 5 >= 5) -> deferred to Nov 2026
    const sameDayJoiner = new Date("2026-10-05T10:00:00+05:30");
    assert.equal(calculateFirstBillingMonth(sameDayJoiner, 5), "2026-11");
    assert.equal(isStudentEligibleForBilling(sameDayJoiner, 5, "2026-10"), false);
    assert.equal(isStudentEligibleForBilling(sameDayJoiner, 5, "2026-11"), true);

    // Student joins on Oct 20th (joinDay 20 >= 5) -> deferred to Nov 2026
    const lateJoiner = new Date("2026-10-20T10:00:00+05:30");
    assert.equal(calculateFirstBillingMonth(lateJoiner, 5), "2026-11");
    assert.equal(isStudentEligibleForBilling(lateJoiner, 5, "2026-10"), false);
    assert.equal(isStudentEligibleForBilling(lateJoiner, 5, "2026-11"), true);

    // Null/undefined joining date preserves legacy behavior (eligible)
    assert.equal(isStudentEligibleForBilling(null, 5, "2026-10"), true);
  });

  await t.test("3. Center-specific due-date offset calculation & 5-day default", () => {
    const baseDate = new Date("2026-10-01T12:00:00+05:30");

    // Default offset = 5 days
    const dueDefault = calculateDueDate(baseDate, undefined);
    assert.equal(dueDefault.getDate(), 6);

    // Configured offset = 8 days
    const dueCustom = calculateDueDate(baseDate, 8);
    assert.equal(dueCustom.getDate(), 9);

    // Configured offset = 0 days
    const dueZero = calculateDueDate(baseDate, 0);
    assert.equal(dueZero.getDate(), 6);
  });

  await t.test("4. 7-day automatic reminder cooldown & 24-hour manual cooldown", () => {
    const now = new Date("2026-10-29T12:00:00+05:30");

    // Sent 2 days ago: within 7-day cooldown (not eligible), within 24h cooldown? No (48h > 24h)
    const twoDaysAgo = new Date("2026-10-27T12:00:00+05:30");
    assert.equal(isEligibleForFollowupReminder(twoDaysAgo, now, 7), false);
    assert.equal(isWithin24HourCooldown(twoDaysAgo, now), false);

    // Sent 8 days ago: outside 7-day cooldown (eligible)
    const eightDaysAgo = new Date("2026-10-21T12:00:00+05:30");
    assert.equal(isEligibleForFollowupReminder(eightDaysAgo, now, 7), true);
    assert.equal(isWithin24HourCooldown(eightDaysAgo, now), false);

    // Sent 5 hours ago: within 24-hour cooldown
    const fiveHoursAgo = new Date("2026-10-29T07:00:00+05:30");
    assert.equal(isWithin24HourCooldown(fiveHoursAgo, now), true);
    assert.equal(isEligibleForFollowupReminder(fiveHoursAgo, now, 7), false);

    // Never sent (null): eligible
    assert.equal(isEligibleForFollowupReminder(null, now, 7), true);
    assert.equal(isWithin24HourCooldown(null, now), false);
  });

  // =========================================================================
  // 2. IDEMPOTENT FEE GENERATION SERVICE (feeService.ts)
  // =========================================================================
  await t.test("5. Idempotent fee generation: creates on first call, reuses on second call", async () => {
    const mockDb = new Map();
    let idCounter = 1;

    const mockFeeModel = {
      find: (query) => {
        const results = [];
        for (const fee of mockDb.values()) {
          let match = true;
          if (query.centerId && fee.centerId !== query.centerId) match = false;
          if (query.studentId && fee.studentId !== query.studentId) match = false;
          if (query.billingMonth && fee.billingMonth !== query.billingMonth) match = false;
          if (match) results.push(fee);
        }
        return results;
      },
      findOne: (query) => {
        for (const fee of mockDb.values()) {
          let match = true;
          if (query.centerId && fee.centerId !== query.centerId) match = false;
          if (query.studentId && fee.studentId !== query.studentId) match = false;
          if (query.billingMonth && fee.billingMonth !== query.billingMonth) match = false;
          if (query.feeType && fee.feeType !== query.feeType) match = false;
          if (match) return fee;
        }
        return null;
      },
      create: async (data) => {
        const newDoc = {
          ...data,
          _id: `fee_${idCounter++}`,
          createdAt: new Date(),
        };
        mockDb.set(newDoc._id, newDoc);
        return newDoc;
      },
    };

    const student = {
      _id: "student_101",
      name: "Aarav Sharma",
      monthlyFee: 2500,
      centerId: "center_1",
      joiningDate: new Date("2026-09-01"),
      billingCycleDate: 5,
    };
    const mockStudentModel = {
      findById: async () => student,
    };
    const mockCenterModel = {
      findOne: async () => ({ centerId: "center_1", dueDateOffsetDays: 7 }),
    };

    // First call: creates new monthly fee
    const res1 = await generateOrGetMonthlyFee({
      studentId: student._id,
      centerId: "center_1",
      referenceDate: new Date("2026-10-05T10:00:00+05:30"),
      isManual: false,
      models: {
        Fee: mockFeeModel,
        Student: mockStudentModel,
        Center: mockCenterModel,
      },
    });

    assert.equal(res1.status, "created");
    assert.equal(res1.wasCreated, true);
    assert.equal(res1.fee.billingMonth, "2026-10");
    assert.equal(res1.fee.feeType, "monthly_recurring");
    assert.equal(res1.fee.amountDue, 2500);
    const expectedDueDate = calculateDueDate(new Date("2026-10-05T10:00:00+05:30"), 7);
    assert.equal(new Date(res1.fee.dueDate).getDate(), expectedDueDate.getDate());

    // Second call: reuses existing monthly fee
    const res2 = await generateOrGetMonthlyFee({
      studentId: student._id,
      centerId: "center_1",
      referenceDate: new Date("2026-10-05T10:00:00+05:30"),
      isManual: false,
      models: {
        Fee: mockFeeModel,
        Student: mockStudentModel,
        Center: mockCenterModel,
      },
    });

    assert.equal(res2.status, "reused");
    assert.equal(res2.wasCreated, false);
    assert.equal(res2.fee._id, res1.fee._id);
    assert.equal(mockDb.size, 1, "Must not create duplicate record in database");
  });

  await t.test("6. Fee reuse regardless of Paid or Verification Pending status", async () => {
    const paidFee = {
      _id: "fee_paid_1",
      studentId: "student_102",
      centerId: "center_1",
      billingMonth: "2026-10",
      feeType: "monthly_recurring",
      month: "October 2026",
      amountDue: 3000,
      status: "Paid",
      dueDate: new Date("2026-10-10"),
    };

    const mockFeeModel = {
      findOne: (query) => {
        if (query.billingMonth === "2026-10") return paidFee;
        return null;
      },
      find: () => [paidFee],
      create: async () => { throw new Error("Should not be called!"); },
    };

    const student = {
      _id: "student_102",
      name: "Diya Patel",
      monthlyFee: 3000,
      centerId: "center_1",
    };
    const mockStudentModel = { findById: async () => student };
    const mockCenterModel = { findOne: async () => ({ dueDateOffsetDays: 5 }) };

    const res = await generateOrGetMonthlyFee({
      studentId: student._id,
      centerId: "center_1",
      referenceDate: new Date("2026-10-05T10:00:00+05:30"),
      isManual: true,
      models: {
        Fee: mockFeeModel,
        Student: mockStudentModel,
        Center: mockCenterModel,
      },
    });

    assert.equal(res.status, "reused");
    assert.equal(res.fee._id, "fee_paid_1");
    assert.equal(res.fee.status, "Paid");
    assert.equal(new Date(res.fee.dueDate).toISOString(), paidFee.dueDate.toISOString());
  });

  await t.test("7. Advance and ad-hoc fees are NEVER matched as monthly_recurring", async () => {
    const mockDb = new Map();
    const advanceFee = {
      _id: "fee_adv_1",
      studentId: "student_103",
      centerId: "center_1",
      billingMonth: undefined,
      feeType: "advance",
      isAdvance: true,
      month: "October 2026",
      amountDue: 4000,
      status: "Paid",
    };
    mockDb.set(advanceFee._id, advanceFee);

    let createdDoc = null;
    const mockFeeModel = {
      findOne: (query) => {
        for (const fee of mockDb.values()) {
          if (query.billingMonth && fee.billingMonth === query.billingMonth) {
            if (query.feeType && fee.feeType === query.feeType) return fee;
          }
        }
        return null;
      },
      find: (query) => {
        const results = [];
        for (const fee of mockDb.values()) {
          if (query.feeType && query.feeType.$ne === "advance" && fee.feeType === "advance") {
            continue;
          }
          results.push(fee);
        }
        return results;
      },
      create: async (doc) => {
        createdDoc = {
          ...doc,
          _id: "fee_new_monthly_1",
        };
        mockDb.set(createdDoc._id, createdDoc);
        return createdDoc;
      },
    };

    const student = {
      _id: "student_103",
      name: "Karan Mehta",
      monthlyFee: 4000,
      centerId: "center_1",
    };
    const mockStudentModel = { findById: async () => student };
    const mockCenterModel = { findOne: async () => ({ dueDateOffsetDays: 5 }) };

    const res = await generateOrGetMonthlyFee({
      studentId: student._id,
      centerId: "center_1",
      referenceDate: new Date("2026-10-05T10:00:00+05:30"),
      isManual: false,
      models: {
        Fee: mockFeeModel,
        Student: mockStudentModel,
        Center: mockCenterModel,
      },
    });

    assert.equal(res.status, "created");
    assert.equal(res.fee.feeType, "monthly_recurring");
    assert.notEqual(res.fee._id, "fee_adv_1", "Must not reuse advance fee as monthly fee");
  });

  await t.test("8. Ambiguous legacy records trigger reconciliation_required", async () => {
    const legacy1 = {
      _id: "leg_1",
      studentId: "student_104",
      centerId: "center_1",
      month: "October 2026",
      status: "Paid",
      amountDue: 2000,
    };
    const legacy2 = {
      _id: "leg_2",
      studentId: "student_104",
      centerId: "center_1",
      month: "Oct 2026",
      status: "Pending",
      amountDue: 2000,
    };

    const mockFeeModel = {
      findOne: () => null,
      find: () => [legacy1, legacy2],
      create: async () => { throw new Error("Must NOT create fee when ambiguous!"); },
    };

    const student = {
      _id: "student_104",
      name: "Sneha Reddy",
      monthlyFee: 2000,
      centerId: "center_1",
    };
    const mockStudentModel = { findById: async () => student };
    const mockCenterModel = { findOne: async () => ({ dueDateOffsetDays: 5 }) };

    const res = await generateOrGetMonthlyFee({
      studentId: student._id,
      centerId: "center_1",
      referenceDate: new Date("2026-10-05T10:00:00+05:30"),
      isManual: false,
      models: {
        Fee: mockFeeModel,
        Student: mockStudentModel,
        Center: mockCenterModel,
      },
    });

    assert.equal(res.status, "reconciliation_required");
    assert.equal(res.wasCreated, false);
    assert.ok(res.conflictReason.includes("Safe reconciliation required"));
  });

  // =========================================================================
  // 3. REMINDER FOUNDATION & SAFETY (reminderService.ts)
  // =========================================================================
  await t.test("9. Reminder eligibility exclusions (Paid, Verification Pending, Paused, Inactive)", () => {
    const now = new Date("2026-10-29T12:00:00+05:30");
    const activeStudent = { name: "Active", isActive: true };
    const inactiveStudent = { name: "Inactive", isActive: false };

    // Paid -> excluded
    const paidCheck = checkReminderEligibility({ status: "Paid" }, activeStudent, "auto_followup", now);
    assert.equal(paidCheck.eligible, false);
    assert.equal(paidCheck.reason, "fee_already_paid");

    // Verification Pending -> excluded
    const verifyCheck = checkReminderEligibility({ status: "Verification Pending" }, activeStudent, "auto_followup", now);
    assert.equal(verifyCheck.eligible, false);
    assert.equal(verifyCheck.reason, "verification_pending");

    // Paused -> excluded
    const pausedCheck = checkReminderEligibility({ status: "Pending", reminderPaused: true }, activeStudent, "auto_followup", now);
    assert.equal(pausedCheck.eligible, false);
    assert.equal(pausedCheck.reason, "reminders_paused");

    // Inactive student -> excluded
    const inactiveCheck = checkReminderEligibility({ status: "Pending" }, inactiveStudent, "auto_followup", now);
    assert.equal(inactiveCheck.eligible, false);
    assert.equal(inactiveCheck.reason, "student_inactive");
  });

  await t.test("10. Manual reminder 24-hour cooldown and logged forceOverride", async () => {
    const mockStudent = {
      _id: "student_201",
      name: "Vijay Kumar",
      parentWhatsApp: "9876543210",
      isActive: true,
    };

    const mockFee = {
      _id: "fee_remind_1",
      centerId: "center_1",
      studentId: mockStudent,
      status: "Pending",
      amountDue: 2500,
      month: "October 2026",
      lastReminderSentAt: new Date(Date.now() - 2 * 3600 * 1000), // sent 2 hours ago
      reminderCount: 1,
      reminderLockUntil: null,
    };

    const logs = [];
    const mockLogModel = {
      create: async (data) => {
        logs.push(data);
        return { _id: "log_1", ...data };
      },
    };

    const mockFeeModel = {
      findOne: () => ({
        populate: async () => mockFee,
      }),
      findOneAndUpdate: async () => mockFee,
      updateOne: async () => {},
    };

    let sendCalled = false;
    const mockSendFn = async () => {
      sendCalled = true;
      return { success: true, messageId: "msg_abc_123" };
    };

    // Attempt 1: Without forceOverride inside 24h -> Blocked with COOLDOWN_ACTIVE
    const blockedRes = await dispatchFeeReminder({
      feeId: mockFee._id,
      centerId: "center_1",
      triggerType: "manual_owner_single",
      forceOverride: false,
      models: {
        Fee: mockFeeModel,
        FeeReminderLog: mockLogModel,
      },
      sendFn: mockSendFn,
    });

    assert.equal(blockedRes.success, false);
    assert.equal(blockedRes.code, "COOLDOWN_ACTIVE");
    assert.equal(sendCalled, false, "External send must not be called when cooldown is active");

    // Attempt 2: With forceOverride: true and overrideReason -> Allowed and logged
    const overrideRes = await dispatchFeeReminder({
      feeId: mockFee._id,
      centerId: "center_1",
      triggerType: "manual_owner_single",
      forceOverride: true,
      overrideReason: "Parent requested urgent invoice link via phone",
      models: {
        Fee: mockFeeModel,
        FeeReminderLog: mockLogModel,
      },
      sendFn: mockSendFn,
    });

    assert.equal(overrideRes.success, true);
    assert.equal(sendCalled, true);
    assert.equal(overrideRes.status, "provider_accepted");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].isManualOverride, true);
    assert.equal(logs[0].overrideReason, "Parent requested urgent invoice link via phone");
    assert.equal(logs[0].status, "provider_accepted");
    assert.notEqual(logs[0].status, "delivered");
  });

  await t.test("11. Concurrency lock: blocks simultaneous reminder attempts", async () => {
    const lockedFee = {
      _id: "fee_locked_1",
      centerId: "center_1",
      studentId: { name: "User", parentWhatsApp: "9876543210", isActive: true },
      status: "Pending",
      reminderLockUntil: new Date(Date.now() + 3 * 60 * 1000),
    };

    const mockFeeModel = {
      findOne: () => ({
        populate: async () => lockedFee,
      }),
      findOneAndUpdate: async () => null,
    };

    const res = await dispatchFeeReminder({
      feeId: lockedFee._id,
      centerId: "center_1",
      triggerType: "manual_owner_single",
      models: {
        Fee: mockFeeModel,
        FeeReminderLog: { create: async () => {} },
      },
      sendFn: async () => ({ success: true }),
    });

    assert.equal(res.success, false);
    assert.equal(res.code, "LOCKED_CONCURRENT");
  });

  await t.test("12. Dispatch uncertain: network timeout retains 60-minute retry lock", async () => {
    let lockedUntilRetained = null;
    const feeToLock = {
      _id: "fee_timeout_1",
      centerId: "center_1",
      studentId: { name: "Timeout Student", parentWhatsApp: "9876543210", isActive: true },
      status: "Pending",
      amountDue: 2000,
      dueDate: new Date(),
      reminderLockUntil: null,
    };

    const mockFeeModel = {
      findOne: () => ({
        populate: async () => feeToLock,
      }),
      findOneAndUpdate: async () => feeToLock,
      updateOne: async (q, update) => {
        if (update.$set && update.$set.reminderLockUntil) {
          lockedUntilRetained = update.$set.reminderLockUntil;
        }
      },
    };

    const logs = [];
    const mockLogModel = {
      create: async (doc) => {
        logs.push(doc);
        return { _id: "log_timeout_1", ...doc };
      },
    };

    const timeoutSendFn = async () => {
      const err = new Error("Gateway timeout connecting to WhatsApp socket");
      err.name = "TimeoutError";
      throw err;
    };

    const res = await dispatchFeeReminder({
      feeId: feeToLock._id,
      centerId: "center_1",
      triggerType: "auto_due_date",
      models: {
        Fee: mockFeeModel,
        FeeReminderLog: mockLogModel,
      },
      sendFn: timeoutSendFn,
    });

    assert.equal(res.success, false);
    assert.equal(res.status, "dispatch_uncertain");
    assert.equal(res.code, "DISPATCH_UNCERTAIN");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, "dispatch_uncertain");
    assert.ok(lockedUntilRetained instanceof Date);
    const lockDurationMinutes = Math.round((lockedUntilRetained.getTime() - Date.now()) / (60 * 1000));
    assert.ok(lockDurationMinutes >= 58 && lockDurationMinutes <= 60, `Lock should be ~60 mins, got ${lockDurationMinutes}`);
  });

  // =========================================================================
  // 4. REAL ROUTE TESTING: STUDENT REMOVAL PROTECTION (DELETE /api/students/[id])
  // =========================================================================
  await t.test("13. Student DELETE route: missing authentication returns 401 Unauthorized", async () => {
    // Calling without auth header or cookie
    StudentModel.findById = async () => ({
      _id: "student_101",
      centerId: "center_alpha",
    });
    const req = createMockRequest({ method: "DELETE" });
    const res = await deleteStudentRoute(req, { params: Promise.resolve({ id: "student_101" }) });
    const data = await res.json();
    if (res.status !== 401) console.log("DEBUG TEST 13:", res.status, data);

    assert.equal(res.status, 401);
    assert.equal(data.success, false);
    assert.equal(data.error, "Authentication required");
  });

  await t.test("14. Student DELETE route: cross-center access returns 403 Forbidden", async () => {
    // Authenticated for center_beta attempting to delete student of center_alpha
    const token = await signToken({ centerId: "center_beta", role: "owner" });
    const req = createMockRequest({ method: "DELETE", token });

    StudentModel.findById = async () => ({
      _id: "student_101",
      centerId: "center_alpha",
    });

    const res = await deleteStudentRoute(req, { params: Promise.resolve({ id: "student_101" }) });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes("Unauthorized: student belongs to another center"));
  });

  await t.test("15. Student DELETE route: unresolved Pending/Verification Pending fees return 409 Conflict", async () => {
    const token = await signToken({ centerId: "center_alpha", role: "owner" });
    const req = createMockRequest({ method: "DELETE", token });

    StudentModel.findById = async () => ({
      _id: "student_101",
      centerId: "center_alpha",
    });

    // 2 unresolved fees exist
    FeeModel.countDocuments = async () => 2;

    const res = await deleteStudentRoute(req, { params: Promise.resolve({ id: "student_101" }) });

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.code, "UNRESOLVED_FEES_EXIST");
    assert.equal(data.unresolvedCount, 2);
  });

  await t.test("16. Student DELETE route: historical records cause soft-deactivation (isActive = false)", async () => {
    const token = await signToken({ centerId: "center_alpha", role: "owner" });
    const req = createMockRequest({ method: "DELETE", token });

    let saveCalled = false;
    const studentDoc = {
      _id: "student_101",
      centerId: "center_alpha",
      name: "Rohan Varma",
      isActive: true,
      save: async () => {
        saveCalled = true;
      },
    };

    StudentModel.findById = async () => studentDoc;
    FeeModel.countDocuments = async () => 0; // 0 unresolved dues
    FeeModel.exists = async () => true; // Historical paid fee exists
    AttendanceModel.exists = async () => false;
    TestModel.exists = async () => false;

    const res = await deleteStudentRoute(req, { params: Promise.resolve({ id: "student_101" }) });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.action, "deactivated");
    assert.equal(studentDoc.isActive, false, "Must soft-deactivate student");
    assert.equal(saveCalled, true);
  });

  await t.test("17. Student DELETE route: hard-delete occurs only when zero historical dependencies exist", async () => {
    const token = await signToken({ centerId: "center_alpha", role: "owner" });
    const req = createMockRequest({ method: "DELETE", token });

    let deletedId = null;
    const studentDoc = {
      _id: "student_102",
      centerId: "center_alpha",
      name: "New Student Zero History",
      isActive: true,
    };

    StudentModel.findById = async () => studentDoc;
    FeeModel.countDocuments = async () => 0;
    FeeModel.exists = async () => null;
    AttendanceModel.exists = async () => null;
    TestModel.exists = async () => null;
    StudentModel.findByIdAndDelete = async (id) => {
      deletedId = id;
    };

    const res = await deleteStudentRoute(req, { params: Promise.resolve({ id: "student_102" }) });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.action, "deleted");
    assert.equal(deletedId, "student_102");
  });

  // =========================================================================
  // 5. FEE TYPE SEPARATION & REMINDER ENDPOINT ROUTE CONTRACT
  // =========================================================================
  await t.test("18. Fee type separation: ad-hoc and advance fees cannot suppress recurring monthly billing", async () => {
    const studentId = "student_202";
    const centerId = "center_alpha";
    const token = await signToken({ centerId, role: "owner" });

    let createdDoc = null;
    FeeModel.create = async (doc) => {
      createdDoc = { ...doc, _id: "fee_created_adhoc" };
      return createdDoc;
    };

    // Post ad-hoc fee
    const adhocReq = createMockRequest({
      method: "POST",
      token,
      body: {
        centerId,
        studentId,
        feeType: "adhoc",
        title: "Annual Lab Fee",
        amountDue: 500,
        month: "October 2026",
      },
    });

    const resAdhoc = await postFeeRoute(adhocReq);
    assert.equal(resAdhoc.status, 201);
    assert.equal(createdDoc.feeType, "adhoc");
    assert.equal(createdDoc.billingMonth, undefined, "Ad-hoc fee must not have canonical billingMonth");

    // Post ambiguous fee without feeType or indication -> rejected with 400
    const ambiguousReq = createMockRequest({
      method: "POST",
      token,
      body: {
        centerId,
        title: "Random payment",
        amountDue: 100,
      },
    });
    const resAmbiguous = await postFeeRoute(ambiguousReq);
    assert.equal(resAmbiguous.status, 400);
    const ambData = await resAmbiguous.json();
    assert.ok(ambData.error.includes("Ambiguous fee creation request"));
  });

  await t.test("19. Reminder endpoint: 24h cooldown returns 409, explicit forceOverride returns 200 provider_accepted", async () => {
    const centerId = "center_alpha";
    const feeId = "507f1f77bcf86cd799439011";
    const token = await signToken({ centerId, role: "owner" });

    // Mock fee populated with student
    const mockStudent = { _id: "507f191e810c19729de860ea", name: "Ananya", parentWhatsApp: "9876543210", isActive: true };
    const mockFeeDoc = {
      _id: feeId,
      centerId,
      studentId: mockStudent,
      status: "Pending",
      amountDue: 1500,
      dueDate: new Date("2026-11-05"),
      lastReminderSentAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      reminderCount: 1,
      reminderLockUntil: null,
    };

    FeeModel.findOne = () => ({
      populate: async () => mockFeeDoc,
    });
    FeeModel.findOneAndUpdate = async () => mockFeeDoc;
    FeeModel.updateOne = async () => {};
    FeeReminderLogModel.create = async (doc) => ({ _id: "log_123", ...doc });

    // 1. Without forceOverride -> returns 409 COOLDOWN_ACTIVE
    const reqWithoutOverride = createMockRequest({
      method: "POST",
      token,
      body: { forceOverride: false },
    });

    const resCooldown = await remindFeeRoute(reqWithoutOverride, {
      params: Promise.resolve({ feeId }),
    });

    assert.equal(resCooldown.status, 409);
    const coolData = await resCooldown.json();
    assert.equal(coolData.code, "COOLDOWN_ACTIVE");

    // 2. With forceOverride: true -> returns 200 OK provider_accepted (simulation mode in tests)
    const reqWithOverride = createMockRequest({
      method: "POST",
      token,
      body: {
        forceOverride: true,
        overrideReason: "Owner explicit manual override from UI",
      },
    });

    const resOverride = await remindFeeRoute(reqWithOverride, {
      params: Promise.resolve({ feeId }),
    });

    const overData = await resOverride.json();
    assert.equal(resOverride.status, 200);
    assert.equal(overData.success, true);
    assert.equal(overData.status, "provider_accepted");
  });

  await t.test("20. Reminder endpoint contract: strictly expects fee record ID and rejects student ID with FEE_NOT_FOUND", async () => {
    const centerId = "center_alpha";
    const studentId = "507f191e810c19729de860ea"; // Valid ObjectId of a Student, NOT a Fee
    const token = await signToken({ centerId, role: "owner" });

    // When queried with studentId as feeId, Fee.findOne returns null
    FeeModel.findOne = (query) => {
      // FeeModel only returns fee doc if queried by actual feeId
      if (query._id === "507f1f77bcf86cd799439011") {
        return {
          populate: async () => ({
            _id: "507f1f77bcf86cd799439011",
            centerId,
            studentId: { _id: studentId, name: "Ananya", parentWhatsApp: "9876543210" },
            dueDate: new Date("2026-11-05"),
          }),
        };
      }
      return {
        populate: async () => null, // student ID is not in Fee collection
      };
    };

    // Invoking reminder endpoint using studentId instead of feeId
    const reqWithStudentId = createMockRequest({
      method: "POST",
      token,
      body: {},
    });

    const res = await remindFeeRoute(reqWithStudentId, {
      params: Promise.resolve({ feeId: studentId }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.code, "NOT_FOUND");
    assert.ok(data.error.includes("not found for this center"), "Must fail closed when student ID is passed instead of fee ID");
  });

  await t.test("21. Manual fee creation contract: monthly_recurring receives canonical YYYY-MM billingMonth", async () => {
    const studentId = "507f191e810c19729de860ea";
    const centerId = "center_alpha";
    const token = await signToken({ centerId, role: "owner" });

    // Stub student document for feeService
    StudentModel.findById = async () => ({
      _id: studentId,
      centerId,
      name: "Rohit",
      isActive: true,
      monthlyFee: 2000,
      billingCycleDate: 10,
    });

    let savedFeeDoc = null;
    CenterModel.findOne = async () => ({ dueDateOffsetDays: 5 });
    FeeModel.findOne = async () => null;
    FeeModel.find = async () => [];
    FeeModel.create = async (doc) => {
      savedFeeDoc = { _id: "fee_nov_101", ...doc };
      return savedFeeDoc;
    };
    if (!FeeCreationLockModel.collection) {
      FeeCreationLockModel.collection = {};
    }
    FeeCreationLockModel.collection.indexes = async () => [
      { key: { lockKey: 1 }, unique: true, name: "lockKey_1" },
      { key: { expiresAt: 1 }, expireAfterSeconds: 600, name: "expiresAt_1" },
    ];
    FeeCreationLockModel.create = async (doc) => doc;
    FeeCreationLockModel.findOneAndUpdate = async () => null;
    FeeCreationLockModel.deleteOne = async () => ({ deletedCount: 1 });

    const req = createMockRequest({
      method: "POST",
      token,
      body: {
        centerId,
        studentId,
        feeType: "monthly_recurring",
        month: "November 2026",
        billingMonth: "2026-11",
        amountDue: 2000,
        dueDate: "2026-11-10T00:00:00.000Z",
      },
    });

    const res = await postFeeRoute(req);
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(savedFeeDoc.billingMonth, "2026-11", "Must save canonical YYYY-MM billingMonth");
    assert.equal(savedFeeDoc.feeType, "monthly_recurring");
  });
});
