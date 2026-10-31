import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "tuition-desk-test-jwt-secret-key-32-chars-ok";
process.env.MONGODB_URI = "mongodb://localhost:27017/test_tuitiondesk";
globalThis.mongooseCache = { conn: {}, promise: Promise.resolve({}) };

const { signToken } = await import("../tution-desk-be/src/lib/auth.ts");
const StudentModel = (await import("../tution-desk-be/src/models/Student.ts")).default;
const FeeModel = (await import("../tution-desk-be/src/models/Fee.ts")).default;
const AttendanceModel = (await import("../tution-desk-be/src/models/Attendance.ts")).default;
const TestModel = (await import("../tution-desk-be/src/models/Test.ts")).default;

const { DELETE: deleteStudentRoute } = await import(
  "../tution-desk-be/src/app/api/students/[id]/route.ts"
);
const { POST: manualCollectionRoute } = await import(
  "../tution-desk-be/src/app/api/fees/manual-collection/route.ts"
);

function createMockRequest({
  method = "DELETE",
  token,
  body = null,
  headers = {},
  url = "http://localhost:3000/api",
} = {}) {
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
    nextUrl: new URL(url),
    json: async () => body || {},
  };
}

test("TuitionDesk Phase 2F: Audit Findings Remediation Suite", async (t) => {
  const originalStudentFindById = StudentModel.findById;
  const originalStudentFindByIdAndDelete = StudentModel.findByIdAndDelete;
  const originalFeeCountDocuments = FeeModel.countDocuments;
  const originalFeeExists = FeeModel.exists;
  const originalFeeFind = FeeModel.find;
  const originalFeeFindOneAndUpdate = FeeModel.findOneAndUpdate;
  const originalFeeCreate = FeeModel.create;
  const originalAttendanceExists = AttendanceModel.exists;
  const originalTestExists = TestModel.exists;

  t.afterEach(() => {
    StudentModel.findById = originalStudentFindById;
    StudentModel.findByIdAndDelete = originalStudentFindByIdAndDelete;
    FeeModel.countDocuments = originalFeeCountDocuments;
    FeeModel.exists = originalFeeExists;
    FeeModel.find = originalFeeFind;
    FeeModel.findOneAndUpdate = originalFeeFindOneAndUpdate;
    FeeModel.create = originalFeeCreate;
    AttendanceModel.exists = originalAttendanceExists;
    TestModel.exists = originalTestExists;
  });

  const centerId = "center_alpha";
  const studentId = "507f191e810c19729de860ea";

  // =========================================================================
  // FIX 1: PARTIAL PAID STUDENT DEACTIVATION BYPASS REMEDIATION
  // =========================================================================

  await t.test(
    "Fix 1.1: Pending fee blocks deactivation with 409 UNRESOLVED_FEES_EXIST",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const req = createMockRequest({ method: "DELETE", token });

      let capturedQuery = null;
      StudentModel.findById = async () => ({
        _id: studentId,
        centerId,
        name: "Aman Gupta",
        isActive: true,
      });

      FeeModel.countDocuments = async (query) => {
        capturedQuery = query;
        return 1; // 1 Pending fee
      };

      const res = await deleteStudentRoute(req, {
        params: Promise.resolve({ id: studentId }),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, "UNRESOLVED_FEES_EXIST");
      assert.equal(data.unresolvedCount, 1);
      assert.deepEqual(capturedQuery.status.$in, [
        "Pending",
        "Verification Pending",
        "Partial Paid",
      ]);
    }
  );

  await t.test(
    "Fix 1.2: Verification Pending fee blocks deactivation with 409 UNRESOLVED_FEES_EXIST",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const req = createMockRequest({ method: "DELETE", token });

      StudentModel.findById = async () => ({
        _id: studentId,
        centerId,
        name: "Aman Gupta",
        isActive: true,
      });

      FeeModel.countDocuments = async () => 1; // 1 Verification Pending fee

      const res = await deleteStudentRoute(req, {
        params: Promise.resolve({ id: studentId }),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, "UNRESOLVED_FEES_EXIST");
    }
  );

  await t.test(
    "Fix 1.3: Partial Paid fee strictly blocks deactivation with 409 UNRESOLVED_FEES_EXIST",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const req = createMockRequest({ method: "DELETE", token });

      let countQuery = null;
      StudentModel.findById = async () => ({
        _id: studentId,
        centerId,
        name: "Rahul Verma",
        isActive: true,
      });

      FeeModel.countDocuments = async (query) => {
        countQuery = query;
        // Verify query includes "Partial Paid"
        assert.ok(
          query.status.$in.includes("Partial Paid"),
          "Count query must include Partial Paid"
        );
        return 1; // 1 Partial Paid fee exists
      };

      const res = await deleteStudentRoute(req, {
        params: Promise.resolve({ id: studentId }),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, "UNRESOLVED_FEES_EXIST");
      assert.equal(data.unresolvedCount, 1);
      assert.match(data.error, /1 active fee obligation\(s\) exist/);
    }
  );

  await t.test(
    "Fix 1.4: Fully Paid fee does NOT count as unresolved and allows soft-deactivation",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const req = createMockRequest({ method: "DELETE", token });

      let saveCalled = false;
      const studentDoc = {
        _id: studentId,
        centerId,
        name: "Karan Johar",
        isActive: true,
        save: async () => {
          saveCalled = true;
        },
      };

      StudentModel.findById = async () => studentDoc;

      FeeModel.countDocuments = async (query) => {
        // Query must NOT match Paid fees
        assert.ok(!query.status.$in.includes("Paid"));
        return 0; // 0 unresolved fees
      };

      FeeModel.exists = async () => true; // Historical paid fee exists
      AttendanceModel.exists = async () => false;
      TestModel.exists = async () => false;

      const res = await deleteStudentRoute(req, {
        params: Promise.resolve({ id: studentId }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.action, "deactivated");
      assert.equal(studentDoc.isActive, false, "Must soft-deactivate student");
      assert.equal(saveCalled, true);
    }
  );

  await t.test(
    "Fix 1.5: Student with no unresolved fees can still be deactivated cleanly",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const req = createMockRequest({ method: "DELETE", token });

      let saveCalled = false;
      const studentDoc = {
        _id: studentId,
        centerId,
        name: "Neha Sharma",
        isActive: true,
        save: async () => {
          saveCalled = true;
        },
      };

      StudentModel.findById = async () => studentDoc;
      FeeModel.countDocuments = async () => 0; // 0 unresolved
      FeeModel.exists = async () => false;
      AttendanceModel.exists = async () => true; // Historical attendance exists
      TestModel.exists = async () => false;

      const res = await deleteStudentRoute(req, {
        params: Promise.resolve({ id: studentId }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.action, "deactivated");
      assert.equal(studentDoc.isActive, false);
      assert.equal(saveCalled, true);
    }
  );

  // =========================================================================
  // FIX 2: CONSISTENT amountDue AFTER FULL CASH SETTLEMENT
  // =========================================================================

  await t.test(
    "Fix 2.1: Full cash settlement sets amountDue strictly to 0 and stores full paidAmount",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const mockStudent = {
        _id: studentId,
        centerId,
        name: "Vikram Mehta",
        monthlyFee: 3000,
        isActive: true,
      };

      const existingPendingFee = {
        _id: "fee_pending_full_settle",
        centerId,
        studentId,
        billingMonth: "2026-10",
        month: "October 2026",
        status: "Pending",
        amountDue: 3000,
        paidAmount: 0,
        feeType: "monthly_recurring",
      };

      StudentModel.findById = async () => mockStudent;
      FeeModel.find = async () => [existingPendingFee];

      let updatedDoc = null;
      FeeModel.findOneAndUpdate = (query, update) => {
        assert.equal(query._id, "fee_pending_full_settle");
        assert.deepEqual(query.status, { $in: ["Pending", "Partial Paid"] });
        assert.equal(update.$set.status, "Paid");
        assert.equal(
          update.$set.amountDue,
          0,
          "Full settlement MUST store amountDue: 0"
        );
        assert.equal(
          update.$set.paidAmount,
          3000,
          "Full settlement MUST store cumulative paidAmount: 3000"
        );

        updatedDoc = {
          ...existingPendingFee,
          ...update.$set,
        };
        return {
          populate: async () => updatedDoc,
        };
      };

      const req = createMockRequest({
        method: "POST",
        token,
        body: {
          studentId,
          centerId,
          amount: 3000,
          billingMonth: "2026-10",
          notes: "Collected ₹3000 in full cash",
        },
        url: "http://localhost:3000/api/fees/manual-collection",
      });

      const res = await manualCollectionRoute(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.settledExisting, true);
      assert.equal(json.data.status, "Paid");
      assert.equal(json.data.amountDue, 0, "amountDue must be 0 after full settlement");
      assert.equal(json.data.paidAmount, 3000);
      assert.ok(json.data.receiptNumber.startsWith("RCPT-"));
      assert.ok(json.data.notes.includes("Cash collected: ₹3000"));
    }
  );

  await t.test(
    "Fix 2.2: Partial cash settlement retains correct outstanding balance (amountDue > 0)",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const mockStudent = {
        _id: studentId,
        centerId,
        name: "Vikram Mehta",
        monthlyFee: 3000,
        isActive: true,
      };

      const existingPendingFee = {
        _id: "fee_pending_partial_settle",
        centerId,
        studentId,
        billingMonth: "2026-10",
        month: "October 2026",
        status: "Pending",
        amountDue: 3000,
        paidAmount: 0,
        feeType: "monthly_recurring",
      };

      StudentModel.findById = async () => mockStudent;
      FeeModel.find = async () => [existingPendingFee];

      let updatedDoc = null;
      FeeModel.findOneAndUpdate = (query, update) => {
        assert.equal(update.$set.status, "Partial Paid");
        assert.equal(
          update.$set.amountDue,
          1000,
          "Partial settlement must set amountDue: 3000 - 2000 = 1000"
        );
        assert.equal(update.$set.paidAmount, 2000);

        updatedDoc = {
          ...existingPendingFee,
          ...update.$set,
        };
        return {
          populate: async () => updatedDoc,
        };
      };

      const req = createMockRequest({
        method: "POST",
        token,
        body: {
          studentId,
          centerId,
          amount: 2000,
          billingMonth: "2026-10",
        },
        url: "http://localhost:3000/api/fees/manual-collection",
      });

      const res = await manualCollectionRoute(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.settledExisting, true);
      assert.equal(json.data.status, "Partial Paid");
      assert.equal(json.data.amountDue, 1000);
      assert.equal(json.data.paidAmount, 2000);
    }
  );

  await t.test(
    "Fix 2.3: Existing receipt numbers and IDs are preserved and no duplicate fee is created",
    async () => {
      const token = await signToken({ centerId, role: "owner" });
      const mockStudent = {
        _id: studentId,
        centerId,
        name: "Anjali Roy",
        monthlyFee: 1500,
        isActive: true,
      };

      const existingFee = {
        _id: "fee_existing_with_id_and_cycle",
        centerId,
        studentId,
        billingMonth: "2026-10",
        month: "October 2026",
        status: "Pending",
        amountDue: 1500,
        paidAmount: 0,
        feeType: "monthly_recurring",
      };

      let feeCreateCalled = false;
      FeeModel.create = async () => {
        feeCreateCalled = true;
        throw new Error("FeeModel.create must NOT be called when existing fee is found");
      };

      StudentModel.findById = async () => mockStudent;
      FeeModel.find = async () => [existingFee];

      let updatedDoc = null;
      FeeModel.findOneAndUpdate = (query, update) => {
        assert.equal(query._id, "fee_existing_with_id_and_cycle");
        updatedDoc = {
          ...existingFee,
          ...update.$set,
        };
        return {
          populate: async () => updatedDoc,
        };
      };

      const req = createMockRequest({
        method: "POST",
        token,
        body: {
          studentId,
          centerId,
          amount: 1500,
          billingMonth: "2026-10",
        },
        url: "http://localhost:3000/api/fees/manual-collection",
      });

      const res = await manualCollectionRoute(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.settledExisting, true);
      assert.equal(json.data._id, "fee_existing_with_id_and_cycle");
      assert.equal(feeCreateCalled, false, "Zero duplicate records created");
      assert.ok(json.data.receiptNumber.startsWith("RCPT-"));
      assert.equal(json.data.amountDue, 0);
      assert.equal(json.data.paidAmount, 1500);
    }
  );
});
