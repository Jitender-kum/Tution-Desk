import test from "node:test";
import assert from "node:assert/strict";

const randomHex24 = () =>
  "507f191e810c19729de8" + Math.floor(1000 + Math.random() * 9000);

process.env.CRON_SECRET = "test_cron_secret_key_super_secure_32_chars";
process.env.MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/test_tuitiondesk";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-phase2d-cron";

// Ensure connectDB does not attempt real network connection in tests
globalThis.mongooseCache = { conn: {}, promise: Promise.resolve({}) };

const { GET, POST } = await import(
  "../tution-desk-be/src/app/api/cron/generate-fees/route.ts"
);
const { default: StudentModel } = await import(
  "../tution-desk-be/src/models/Student.ts"
);
const { default: FeeModel } = await import(
  "../tution-desk-be/src/models/Fee.ts"
);
const { default: CenterModel } = await import(
  "../tution-desk-be/src/models/Center.ts"
);
const { default: FeeCreationLockModel } = await import(
  "../tution-desk-be/src/models/FeeCreationLock.ts"
);

function createMockRequest({
  method = "GET",
  url = "http://localhost:3000/api/cron/generate-fees",
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
    json: async () => body || {},
  };
}

test("TuitionDesk Phase 2D: Fee Generation Cron Security & Idempotency Suite", async (t) => {
  const originalStudentFind = StudentModel.find;
  const originalStudentFindById = StudentModel.findById;
  const originalFeeFind = FeeModel.find;
  const originalFeeFindOne = FeeModel.findOne;
  const originalFeeCreate = FeeModel.create;
  const originalCenterFindOne = CenterModel.findOne;
  const originalLockIndexes = FeeCreationLockModel.collection?.indexes;
  const originalLockCreate = FeeCreationLockModel.create;
  const originalLockFindOneAndUpdate = FeeCreationLockModel.findOneAndUpdate;
  const originalLockDeleteOne = FeeCreationLockModel.deleteOne;

  t.afterEach(() => {
    StudentModel.find = originalStudentFind;
    StudentModel.findById = originalStudentFindById;
    FeeModel.find = originalFeeFind;
    FeeModel.findOne = originalFeeFindOne;
    FeeModel.create = originalFeeCreate;
    CenterModel.findOne = originalCenterFindOne;
    if (FeeCreationLockModel.collection) {
      FeeCreationLockModel.collection.indexes = originalLockIndexes;
    }
    FeeCreationLockModel.create = originalLockCreate;
    FeeCreationLockModel.findOneAndUpdate = originalLockFindOneAndUpdate;
    FeeCreationLockModel.deleteOne = originalLockDeleteOne;
  });

  t.beforeEach(() => {
    CenterModel.findOne = async () => ({ dueDateOffsetDays: 5 });
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
  });

  await t.test(
    "1. Server fails closed with 500 if CRON_SECRET is missing or empty in environment",
    async () => {
      const savedSecret = process.env.CRON_SECRET;
      try {
        process.env.CRON_SECRET = "";

        const req = createMockRequest({
          headers: { authorization: "Bearer some_token" },
        });

        const res = await GET(req);
        assert.equal(res.status, 500);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.match(json.error, /CRON_SECRET is missing/i);
      } finally {
        process.env.CRON_SECRET = savedSecret;
      }
    }
  );

  await t.test(
    "2. Missing authentication headers reject request with 401 Unauthorized before any DB calls",
    async () => {
      StudentModel.find = async () => {
        assert.fail("Database query should NOT be called on unauthenticated request");
      };

      const reqNoAuth = createMockRequest({
        headers: {},
      });

      const res = await GET(reqNoAuth);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Unauthorized: Invalid or missing cron secret/i);
    }
  );

  await t.test(
    "3. Invalid secret in Authorization: Bearer or x-cron-secret header returns 401 Unauthorized",
    async () => {
      StudentModel.find = async () => {
        assert.fail("Database query should NOT be called on invalid secret");
      };

      // Wrong Bearer token
      const reqBadBearer = createMockRequest({
        headers: { authorization: "Bearer invalid_secret_token" },
      });
      const resBadBearer = await GET(reqBadBearer);
      assert.equal(resBadBearer.status, 401);

      // Wrong x-cron-secret
      const reqBadCustom = createMockRequest({
        headers: { "x-cron-secret": "wrong_cron_secret" },
      });
      const resBadCustom = await GET(reqBadCustom);
      assert.equal(resBadCustom.status, 401);
    }
  );

  await t.test(
    "4. Authorized GET request with Authorization: Bearer <CRON_SECRET> generates fees for eligible students",
    async () => {
      const centerId = "center_alpha";
      const studentId1 = randomHex24();

      const mockStudent1 = {
        _id: studentId1,
        centerId,
        name: "Aman Verma",
        monthlyFee: 1500,
        billingCycleDate: 10,
        isActive: true,
      };

      StudentModel.find = async () => [mockStudent1];
      StudentModel.findById = async (id) => (String(id) === studentId1 ? mockStudent1 : null);

      // No existing fee in database
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [],
        }),
      });
      FeeModel.findOne = async () => null;

      let createdFee = null;
      FeeModel.create = async (doc) => {
        createdFee = {
          _id: randomHex24(),
          ...doc,
          status: "Pending",
          amountDue: doc.amountDue || 1500,
        };
        return createdFee;
      };

      const req = createMockRequest({
        url: "http://localhost:3000/api/cron/generate-fees?day=10&centerId=center_alpha",
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });

      const res = await GET(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.generatedCount, 1);
      assert.equal(json.skippedCount, 0);
      assert.ok(createdFee !== null);
      assert.match(createdFee.billingMonth, /^\d{4}-\d{2}$/, "Must be canonical YYYY-MM");
      assert.equal(createdFee.centerId, centerId);
    }
  );

  await t.test(
    "5. Authorized request with x-cron-secret header works identically and supports POST",
    async () => {
      const centerId = "center_beta";
      const studentId2 = randomHex24();

      const mockStudent2 = {
        _id: studentId2,
        centerId,
        name: "Neha Singh",
        monthlyFee: 1800,
        billingCycleDate: 15,
        isActive: true,
      };

      StudentModel.find = async () => [mockStudent2];
      StudentModel.findById = async (id) => (String(id) === studentId2 ? mockStudent2 : null);

      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [],
        }),
      });
      FeeModel.findOne = async () => null;

      let createdFee = null;
      FeeModel.create = async (doc) => {
        createdFee = { _id: randomHex24(), ...doc };
        return createdFee;
      };

      const reqPost = createMockRequest({
        method: "POST",
        url: "http://localhost:3000/api/cron/generate-fees",
        headers: {
          "x-cron-secret": process.env.CRON_SECRET,
        },
        body: {
          day: 15,
          centerId: "center_beta",
        },
      });

      const res = await POST(reqPost);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.generatedCount, 1);
      assert.ok(createdFee !== null);
      assert.equal(createdFee.amountDue, 1800);
    }
  );

  await t.test(
    "6. Repeated authorized cron requests are strictly idempotent and never create duplicate fees",
    async () => {
      const centerId = "center_alpha";
      const studentId = randomHex24();
      const existingFeeId = randomHex24();

      const mockStudent = {
        _id: studentId,
        centerId,
        name: "Aman Verma",
        monthlyFee: 1500,
        billingCycleDate: 10,
        isActive: true,
      };

      StudentModel.find = async () => [mockStudent];
      StudentModel.findById = async (id) => (String(id) === studentId ? mockStudent : null);

      // Fee ALREADY exists in database for this cycle
      const existingFee = {
        _id: existingFeeId,
        centerId,
        studentId,
        billingMonth: "2026-10",
        month: "October 2026",
        amountDue: 1500,
        paidAmount: 0,
        status: "Pending",
        feeType: "monthly_recurring",
      };

      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [existingFee],
        }),
      });
      FeeModel.findOne = async () => existingFee;

      FeeModel.create = async () => {
        assert.fail("FeeModel.create should NEVER be called when fee already exists");
      };

      // Second authorized execution of the same day's cron
      const reqRepeat = createMockRequest({
        url: "http://localhost:3000/api/cron/generate-fees?day=10&centerId=center_alpha",
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });

      const res = await GET(reqRepeat);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.generatedCount, 0, "Duplicate fee generation must be 0");
      assert.equal(json.skippedCount, 1, "Existing fee must be reported as skipped");
      assert.equal(json.skippedRecords.length, 1);
      assert.match(json.skippedRecords[0].reason, /Fee already exists/i);
    }
  );

  await t.test(
    "7. Deactivated students (isActive: false) are strictly excluded from automated fee generation",
    async () => {
      StudentModel.find = async (query) => {
        // Verify query enforces isActive: { $ne: false }
        assert.deepEqual(query.isActive, { $ne: false });
        return []; // Zero active students found
      };

      const req = createMockRequest({
        url: "http://localhost:3000/api/cron/generate-fees?day=10",
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });

      const res = await GET(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.generatedCount, 0);
      assert.equal(json.totalEligibleStudents, 0);
    }
  );
});
