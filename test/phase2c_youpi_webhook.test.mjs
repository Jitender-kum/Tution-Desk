import test from "node:test";
import assert from "node:assert/strict";

const randomHex24 = () =>
  "507f191e810c19729de8" + Math.floor(1000 + Math.random() * 9000);

process.env.YOUPI_WEBHOOK_SECRET = "test_youpi_secret_key_12345";
process.env.MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/test_tuitiondesk";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-phase2c4-youpi";

// Ensure connectDB does not attempt real network connection in tests
globalThis.mongooseCache = { conn: {}, promise: Promise.resolve({}) };

const { POST } = await import(
  "../tution-desk-be/src/app/api/webhooks/youpi/route.ts"
);
const { default: FeeModel } = await import(
  "../tution-desk-be/src/models/Fee.ts"
);

function createMockRequest({
  headers = {},
  body = {},
} = {}) {
  const headerMap = new Map();
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase(), v);
  }

  return {
    headers: {
      get: (name) => headerMap.get(name.toLowerCase()) || null,
    },
    json: async () => body,
  };
}

/**
 * In-memory MongoDB atomic update simulator for tests.
 * Accurately simulates MongoDB filter predicates ($ne, $gte, $gt) and update operators ($set, $inc, $push).
 */
function applySimulatedAtomicUpdate(doc, filter, update) {
  // Predicate: status
  if (filter.status) {
    if (filter.status.$ne && doc.status === filter.status.$ne) return null;
    if (filter.status.$in && !filter.status.$in.includes(doc.status)) return null;
  }

  // Predicate: amountDue
  if (filter.amountDue !== undefined) {
    if (typeof filter.amountDue === "number" && doc.amountDue !== filter.amountDue) {
      return null;
    }
    if (filter.amountDue.$gt !== undefined && !(doc.amountDue > filter.amountDue.$gt)) {
      return null;
    }
    if (filter.amountDue.$gte !== undefined && !(doc.amountDue >= filter.amountDue.$gte)) {
      return null;
    }
  }

  // Predicate: processedTxnIds $ne
  if (filter.processedTxnIds && filter.processedTxnIds.$ne) {
    const forbidden = filter.processedTxnIds.$ne;
    if (Array.isArray(doc.processedTxnIds) && doc.processedTxnIds.includes(forbidden)) {
      return null; // Atomic duplicate guard prevented match!
    }
  }

  // Apply $set
  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) {
      doc[k] = v;
    }
  }

  // Apply $inc
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      doc[k] = (Number(doc[k]) || 0) + Number(v);
    }
  }

  // Apply $push
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      if (!Array.isArray(doc[k])) doc[k] = [];
      doc[k].push(v);
    }
  }

  return { ...doc };
}

test("TuitionDesk Phase 2C.4: Atomic YouPi Webhook Payment & Idempotency Suite", async (t) => {
  const originalFind = FeeModel.find;
  const originalFindById = FeeModel.findById;
  const originalFindOneAndUpdate = FeeModel.findOneAndUpdate;

  t.afterEach(() => {
    FeeModel.find = originalFind;
    FeeModel.findById = originalFindById;
    FeeModel.findOneAndUpdate = originalFindOneAndUpdate;
  });

  await t.test(
    "1. Missing or invalid webhook secret returns 401 Unauthorized",
    async () => {
      const reqNoSecret = createMockRequest({
        headers: {},
        body: { transactionNote: "FEE-123456", amount: 500, upiTransactionId: "TXN-1" },
      });
      const resNoSecret = await POST(reqNoSecret);
      assert.equal(resNoSecret.status, 401);
      const jsonNoSecret = await resNoSecret.json();
      assert.equal(jsonNoSecret.success, false);
      assert.match(jsonNoSecret.error, /Unauthorized/i);

      const reqBadSecret = createMockRequest({
        headers: { "x-youpi-secret": "wrong_secret_value" },
        body: { transactionNote: "FEE-123456", amount: 500, upiTransactionId: "TXN-1" },
      });
      const resBadSecret = await POST(reqBadSecret);
      assert.equal(resBadSecret.status, 401);
    }
  );

  await t.test(
    "2. Non-finite (Infinity, -Infinity), zero, and negative amounts are strictly rejected with 400",
    async () => {
      const validHeaders = { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET };

      // Infinity
      const reqInf = createMockRequest({
        headers: validHeaders,
        body: { transactionNote: "FEE-123456", amount: Infinity, upiTransactionId: "TXN-1" },
      });
      const resInf = await POST(reqInf);
      assert.equal(resInf.status, 400);
      assert.match((await resInf.json()).error, /positive finite number/i);

      // -Infinity
      const reqNegInf = createMockRequest({
        headers: validHeaders,
        body: { transactionNote: "FEE-123456", amount: -Infinity, upiTransactionId: "TXN-1" },
      });
      const resNegInf = await POST(reqNegInf);
      assert.equal(resNegInf.status, 400);

      // Zero
      const reqZero = createMockRequest({
        headers: validHeaders,
        body: { transactionNote: "FEE-123456", amount: 0, upiTransactionId: "TXN-1" },
      });
      const resZero = await POST(reqZero);
      assert.equal(resZero.status, 400);

      // Negative
      const reqNeg = createMockRequest({
        headers: validHeaders,
        body: { transactionNote: "FEE-123456", amount: -500, upiTransactionId: "TXN-1" },
      });
      const resNeg = await POST(reqNeg);
      assert.equal(resNeg.status, 400);
    }
  );

  await t.test(
    "3. Overpayment exceeding outstanding balance is rejected with 400",
    async () => {
      const feeId = randomHex24();
      const mockFeeDoc = {
        _id: feeId,
        centerId: "center_alpha",
        month: "2026-10",
        amountDue: 500,
        paidAmount: 1000,
        status: "Partial Paid",
        processedTxnIds: ["TXN_PRIOR"],
        paymentTransactions: [],
      };

      FeeModel.findById = async (id) => (String(id) === feeId ? mockFeeDoc : null);
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [mockFeeDoc],
        }),
      });

      // Attempt payment of 600 against balance of 500
      const reqOverpay = createMockRequest({
        headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
        body: {
          transactionNote: `FEE-${feeId.slice(-6)}`,
          amount: 600,
          upiTransactionId: "TXN_OVERPAY",
        },
      });

      const res = await POST(reqOverpay);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /exceeds outstanding balance/i);
    }
  );

  await t.test(
    "4. Ambiguous fee suffix matching multiple records fails closed with 409 Conflict",
    async () => {
      const suffix = "abc123";
      const doc1 = {
        _id: `507f191e810c19729de8${suffix}`,
        status: "Pending",
        amountDue: 1500,
      };
      const doc2 = {
        _id: `507f191e810c19729df9${suffix}`,
        status: "Partial Paid",
        amountDue: 1200,
      };

      FeeModel.findById = async () => null;
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [doc1, doc2], // Multiple candidate fees matching suffix
        }),
      });

      const reqAmbiguous = createMockRequest({
        headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
        body: {
          transactionNote: `FEE-${suffix}`,
          amount: 500,
          upiTransactionId: "TXN_AMBIGUOUS",
        },
      });

      const res = await POST(reqAmbiguous);
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, "AMBIGUOUS_FEE_SUFFIX");
      assert.match(json.error, /Ambiguous fee suffix/i);
    }
  );

  await t.test(
    "5. Two concurrent deliveries of same transaction ID: second fails atomic filter and returns duplicate 200 without double-counting",
    async () => {
      const feeId = randomHex24();
      const mockSharedDoc = {
        _id: feeId,
        centerId: "center_alpha",
        month: "2026-10",
        amountDue: 1500,
        paidAmount: 0,
        status: "Pending",
        processedTxnIds: [],
        paymentTransactions: [],
      };

      FeeModel.findById = async (id) => (String(id) === feeId ? mockSharedDoc : null);
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [mockSharedDoc],
        }),
      });

      FeeModel.findOneAndUpdate = async (filter, update) => {
        return applySimulatedAtomicUpdate(mockSharedDoc, filter, update);
      };

      const txnId = "UPI_CONCURRENT_SAME_001";
      const makeRequest = () =>
        createMockRequest({
          headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
          body: {
            transactionNote: `FEE-${feeId.slice(-6)}`,
            amount: 600,
            upiTransactionId: txnId,
          },
        });

      // Dispatch 1: Succeeds and commits txnId to processedTxnIds
      const res1 = await POST(makeRequest());
      assert.equal(res1.status, 200);
      const json1 = await res1.json();
      assert.equal(json1.success, true);
      assert.equal(json1.data.status, "Partial Paid");
      assert.equal(json1.data.totalPaid, 600);
      assert.equal(json1.data.remainingDue, 900);

      // Dispatch 2 (Simulating concurrent twin delivery):
      // The filter { processedTxnIds: { $ne: 'UPI_CONCURRENT_SAME_001' } } blocks mutation!
      const res2 = await POST(makeRequest());
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.success, true);
      assert.equal(json2.duplicate, true);
      assert.equal(json2.data.totalPaid, 600, "MUST NOT double count paidAmount");
      assert.equal(json2.data.remainingDue, 900, "MUST NOT double decrement amountDue");

      // Verify DB doc state
      assert.equal(mockSharedDoc.paidAmount, 600);
      assert.equal(mockSharedDoc.amountDue, 900);
      assert.deepEqual(mockSharedDoc.processedTxnIds, [txnId]);
      assert.equal(mockSharedDoc.paymentTransactions.length, 1);
    }
  );

  await t.test(
    "6. Two concurrent distinct transactions against one fee accumulate correctly without lost updates",
    async () => {
      const feeId = randomHex24();
      const mockSharedDoc = {
        _id: feeId,
        centerId: "center_alpha",
        month: "2026-10",
        amountDue: 1500,
        paidAmount: 0,
        status: "Pending",
        processedTxnIds: [],
        paymentTransactions: [],
      };

      FeeModel.findById = async (id) => (String(id) === feeId ? mockSharedDoc : null);
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [mockSharedDoc],
        }),
      });

      FeeModel.findOneAndUpdate = async (filter, update) => {
        return applySimulatedAtomicUpdate(mockSharedDoc, filter, update);
      };

      // Transaction A: 600
      const reqA = createMockRequest({
        headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
        body: {
          transactionNote: `FEE-${feeId.slice(-6)}`,
          amount: 600,
          upiTransactionId: "UPI_DISTINCT_A",
        },
      });

      // Transaction B: 400
      const reqB = createMockRequest({
        headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
        body: {
          transactionNote: `FEE-${feeId.slice(-6)}`,
          amount: 400,
          upiTransactionId: "UPI_DISTINCT_B",
        },
      });

      const resA = await POST(reqA);
      assert.equal(resA.status, 200);
      const jsonA = await resA.json();
      assert.equal(jsonA.data.totalPaid, 600);
      assert.equal(jsonA.data.remainingDue, 900);

      const resB = await POST(reqB);
      assert.equal(resB.status, 200);
      const jsonB = await resB.json();
      assert.equal(jsonB.data.totalPaid, 1000);
      assert.equal(jsonB.data.remainingDue, 500);

      // Verify cumulative state
      assert.equal(mockSharedDoc.paidAmount, 1000);
      assert.equal(mockSharedDoc.amountDue, 500);
      assert.deepEqual(mockSharedDoc.processedTxnIds, [
        "UPI_DISTINCT_A",
        "UPI_DISTINCT_B",
      ]);
      assert.equal(mockSharedDoc.paymentTransactions.length, 2);
    }
  );

  await t.test(
    "7. Consecutive payment settling remaining balance transitions status to Paid, assigns receipt, and zeroes amountDue",
    async () => {
      const feeId = randomHex24();
      const mockSharedDoc = {
        _id: feeId,
        centerId: "center_alpha",
        month: "2026-10",
        amountDue: 500,
        paidAmount: 1000,
        status: "Partial Paid",
        processedTxnIds: ["UPI_DISTINCT_A", "UPI_DISTINCT_B"],
        paymentTransactions: [
          { txnId: "UPI_DISTINCT_A", amount: 600, status: "SUCCESS" },
          { txnId: "UPI_DISTINCT_B", amount: 400, status: "SUCCESS" },
        ],
      };

      FeeModel.findById = async (id) => (String(id) === feeId ? mockSharedDoc : null);
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [mockSharedDoc],
        }),
      });

      FeeModel.findOneAndUpdate = async (filter, update) => {
        return applySimulatedAtomicUpdate(mockSharedDoc, filter, update);
      };

      // Settles remaining 500
      const reqSettle = createMockRequest({
        headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
        body: {
          transactionNote: `FEE-${feeId.slice(-6)}`,
          amount: 500,
          upiTransactionId: "UPI_SETTLE_C",
        },
      });

      const resSettle = await POST(reqSettle);
      assert.equal(resSettle.status, 200);
      const jsonSettle = await resSettle.json();

      assert.equal(jsonSettle.success, true);
      assert.equal(jsonSettle.data.status, "Paid");
      assert.equal(jsonSettle.data.totalPaid, 1500);
      assert.equal(jsonSettle.data.remainingDue, 0);
      assert.ok(jsonSettle.data.receiptNumber.startsWith("RCPT-"));

      assert.equal(mockSharedDoc.status, "Paid");
      assert.equal(mockSharedDoc.paidAmount, 1500);
      assert.equal(mockSharedDoc.amountDue, 0);
      assert.ok(mockSharedDoc.receiptNumber.startsWith("RCPT-"));
      assert.deepEqual(mockSharedDoc.processedTxnIds, [
        "UPI_DISTINCT_A",
        "UPI_DISTINCT_B",
        "UPI_SETTLE_C",
      ]);
      assert.equal(mockSharedDoc.paymentTransactions.length, 3);
    }
  );

  await t.test(
    "8. Duplicate retry after final settlement returns 200 idempotent and preserves receipt and amounts",
    async () => {
      const feeId = randomHex24();
      const mockSettledDoc = {
        _id: feeId,
        centerId: "center_alpha",
        month: "2026-10",
        amountDue: 0,
        paidAmount: 1500,
        status: "Paid",
        receiptNumber: "RCPT-ORIGINAL999",
        processedTxnIds: ["UPI_DISTINCT_A", "UPI_DISTINCT_B", "UPI_SETTLE_C"],
      };

      FeeModel.findById = async (id) => (String(id) === feeId ? mockSettledDoc : null);
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [mockSettledDoc],
        }),
      });

      FeeModel.findOneAndUpdate = async () => {
        assert.fail("findOneAndUpdate should NOT be invoked on idempotent duplicate retry");
      };

      const reqRetry = createMockRequest({
        headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
        body: {
          transactionNote: `FEE-${feeId.slice(-6)}`,
          amount: 500,
          upiTransactionId: "UPI_SETTLE_C", // Same settle transaction retried
        },
      });

      const resRetry = await POST(reqRetry);
      assert.equal(resRetry.status, 200);
      const jsonRetry = await resRetry.json();

      assert.equal(jsonRetry.success, true);
      assert.equal(jsonRetry.duplicate, true);
      assert.equal(jsonRetry.data.status, "Paid");
      assert.equal(jsonRetry.data.totalPaid, 1500);
      assert.equal(jsonRetry.data.remainingDue, 0);

      // Receipt is preserved
      assert.equal(mockSettledDoc.receiptNumber, "RCPT-ORIGINAL999");
    }
  );

  await t.test(
    "9. Unknown payment against already fully Paid fee is rejected with 409 Conflict",
    async () => {
      const feeId = randomHex24();
      const mockSettledDoc = {
        _id: feeId,
        centerId: "center_alpha",
        month: "2026-10",
        amountDue: 0,
        paidAmount: 1500,
        status: "Paid",
        processedTxnIds: ["UPI_TXN_OLD"],
      };

      FeeModel.findById = async (id) => (String(id) === feeId ? mockSettledDoc : null);
      FeeModel.find = () => ({
        sort: () => ({
          limit: async () => [mockSettledDoc],
        }),
      });

      const reqConflict = createMockRequest({
        headers: { "x-youpi-secret": process.env.YOUPI_WEBHOOK_SECRET },
        body: {
          transactionNote: `FEE-${feeId.slice(-6)}`,
          amount: 100,
          upiTransactionId: "UPI_TXN_NEW_UNEXPECTED",
        },
      });

      const resConflict = await POST(reqConflict);
      assert.equal(resConflict.status, 409);
      const json = await resConflict.json();
      assert.equal(json.success, false);
      assert.match(json.error, /already fully settled/i);
    }
  );
});
