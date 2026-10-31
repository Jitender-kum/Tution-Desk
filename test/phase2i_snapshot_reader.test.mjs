import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

const mongoose = (await import("../tution-desk-be/node_modules/mongoose/index.js")).default;

const {
  parseBsonBuffer,
  readFeeSnapshotFile,
  normalizeSnapshotRecord,
} = await import("../tution-desk-be/src/lib/snapshotReader.ts");
const { reconcileFeeDataset } = await import("../tution-desk-be/src/lib/reconciliationEngine.ts");
const { generateBackfillPlan } = await import("../tution-desk-be/src/lib/backfillPlanner.ts");

const { BSON } = mongoose.mongo;

test("TuitionDesk Phase 2I: Local Snapshot Reader & BSON Parsing Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuitiondesk-snapshot-test-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  await t.test("1. Successfully parses empty BSON buffer safely", () => {
    const emptyBuf = Buffer.alloc(0);
    const records = parseBsonBuffer(emptyBuf);
    assert.deepEqual(records, []);
  });

  await t.test("2. Successfully parses a single valid BSON document preserving ObjectId and Date", () => {
    const id = new BSON.ObjectId("507f1f77bcf86cd799439011");
    const centerId = new BSON.ObjectId("507f1f77bcf86cd799439012");
    const studentId = new BSON.ObjectId("507f1f77bcf86cd799439013");
    const dueDate = new Date("2024-09-15T00:00:00.000Z");

    const sampleDoc = {
      _id: id,
      centerId: centerId,
      studentId: studentId,
      month: "September 2024",
      amountDue: 2500,
      status: "paid",
      dueDate: dueDate,
      isAdvance: false,
    };

    const bsonBuffer = BSON.serialize(sampleDoc);
    const records = parseBsonBuffer(bsonBuffer);

    assert.equal(records.length, 1);
    const rec = records[0];
    assert.equal(rec._id, "507f1f77bcf86cd799439011");
    assert.equal(rec.centerId, "507f1f77bcf86cd799439012");
    assert.equal(rec.studentId, "507f1f77bcf86cd799439013");
    assert.equal(rec.month, "September 2024");
    assert.equal(rec.amountDue, 2500);
    assert.equal(rec.status, "paid");
    assert.ok(rec.dueDate instanceof Date);
    assert.equal(rec.dueDate.toISOString(), "2024-09-15T00:00:00.000Z");
  });

  await t.test("3. Successfully parses multiple sequential BSON documents", () => {
    const docs = [
      {
        _id: new BSON.ObjectId("507f1f77bcf86cd799439011"),
        centerId: "center_01",
        studentId: "student_01",
        month: "October 2024",
        status: "pending",
      },
      {
        _id: new BSON.ObjectId("507f1f77bcf86cd799439012"),
        centerId: "center_01",
        studentId: "student_02",
        month: "November 2024",
        status: "paid",
      },
      {
        _id: new BSON.ObjectId("507f1f77bcf86cd799439013"),
        centerId: "center_02",
        studentId: "student_03",
        month: "December 2024",
        status: "partial",
      },
    ];

    const buffers = docs.map((d) => BSON.serialize(d));
    const combinedBuffer = Buffer.concat(buffers);

    const records = parseBsonBuffer(combinedBuffer);
    assert.equal(records.length, 3);
    assert.equal(records[0]._id, "507f1f77bcf86cd799439011");
    assert.equal(records[1]._id, "507f1f77bcf86cd799439012");
    assert.equal(records[2]._id, "507f1f77bcf86cd799439013");
    assert.equal(records[0].month, "October 2024");
    assert.equal(records[1].month, "November 2024");
    assert.equal(records[2].month, "December 2024");
  });

  await t.test("4. Rejects truncated BSON headers (< 4 bytes)", () => {
    const truncatedBuf = Buffer.from([0x05, 0x00]); // only 2 bytes
    assert.throws(
      () => parseBsonBuffer(truncatedBuf),
      /Malformed BSON: truncated header/
    );
  });

  await t.test("5. Rejects invalid document length (< 5 bytes)", () => {
    const invalidLenBuf = Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00]); // docSize = 2
    assert.throws(
      () => parseBsonBuffer(invalidLenBuf),
      /Malformed BSON: invalid document size/
    );
  });

  await t.test("6. Rejects truncated BSON payload where specified length > available buffer", () => {
    const partialDoc = Buffer.from([0x20, 0x00, 0x00, 0x00, 0x10, 0x61, 0x00]); // docSize = 32, but buffer length is only 7
    assert.throws(
      () => parseBsonBuffer(partialDoc),
      /Truncated BSON: document at offset 0 specifies length 32/
    );
  });

  await t.test("7. Rejects BSON document missing trailing null terminator", () => {
    const validDoc = BSON.serialize({ a: 1 });
    // Corrupt null terminator
    validDoc[validDoc.length - 1] = 0xff;
    assert.throws(
      () => parseBsonBuffer(validDoc),
      /missing null terminator/
    );
  });

  await t.test("8. Correctly normalizes populated studentId objects vs ObjectId instances", () => {
    // Case A: studentId is a BSON ObjectId
    const rawA = {
      _id: new BSON.ObjectId("507f1f77bcf86cd799439011"),
      centerId: "c1",
      studentId: new BSON.ObjectId("507f1f77bcf86cd799439012"),
    };
    const normA = normalizeSnapshotRecord(rawA);
    assert.equal(typeof normA.studentId, "string");
    assert.equal(normA.studentId, "507f1f77bcf86cd799439012");

    // Case B: studentId is an object with _id, name, parentWhatsApp
    const rawB = {
      _id: "fee_01",
      centerId: "c1",
      studentId: {
        _id: new BSON.ObjectId("507f1f77bcf86cd799439099"),
        name: "Test Student",
        parentWhatsApp: "+919876543210",
      },
    };
    const normB = normalizeSnapshotRecord(rawB);
    assert.equal(typeof normB.studentId, "object");
    assert.equal(normB.studentId._id, "507f1f77bcf86cd799439099");
  });

  await t.test("9. readFeeSnapshotFile reads valid BSON and JSON files from disk", () => {
    const bsonPath = path.join(tmpDir, "test_fees.bson");
    const jsonPath = path.join(tmpDir, "test_fees.json");

    const sample = {
      _id: "fee_disc_01",
      centerId: "c_disc",
      studentId: "s_disc",
      month: "August 2024",
      status: "paid",
      amountDue: 1500,
    };

    fs.writeFileSync(bsonPath, BSON.serialize(sample));
    fs.writeFileSync(jsonPath, JSON.stringify([sample]));

    const bsonResult = readFeeSnapshotFile(bsonPath);
    assert.equal(bsonResult.format, "bson");
    assert.equal(bsonResult.records.length, 1);
    assert.equal(bsonResult.records[0]._id, "fee_disc_01");

    const jsonResult = readFeeSnapshotFile(jsonPath);
    assert.equal(jsonResult.format, "json");
    assert.equal(jsonResult.records.length, 1);
    assert.equal(jsonResult.records[0]._id, "fee_disc_01");
  });

  await t.test("10. readFeeSnapshotFile handles non-existent file safely", () => {
    assert.throws(
      () => readFeeSnapshotFile(path.join(tmpDir, "missing_file.bson")),
      /Snapshot file not found/
    );
  });

  await t.test("11. End-to-end integration: Parsed BSON records run successfully through reconcileFeeDataset and generateBackfillPlan", () => {
    const docs = [
      {
        _id: new BSON.ObjectId("6adad5b4b8a5fad976b95001"),
        centerId: "center_alpha",
        studentId: new BSON.ObjectId("6adad5b4b8a5fad976b95010"),
        month: "September 2024",
        amountDue: 2000,
        status: "paid",
        createdAt: new Date("2024-09-01T10:00:00Z"),
      },
      {
        _id: new BSON.ObjectId("6adad5b4b8a5fad976b95002"),
        centerId: "center_alpha",
        studentId: new BSON.ObjectId("6adad5b4b8a5fad976b95010"),
        month: "October 2024",
        amountDue: 2000,
        status: "pending",
        createdAt: new Date("2024-10-01T10:00:00Z"),
      },
      {
        _id: new BSON.ObjectId("6adad5b4b8a5fad976b95003"),
        centerId: "center_alpha",
        studentId: new BSON.ObjectId("6adad5b4b8a5fad976b95020"),
        month: "Registration",
        feeType: "registration",
        amountDue: 500,
        status: "paid",
        createdAt: new Date("2024-08-15T10:00:00Z"),
      },
    ];

    const buf = Buffer.concat(docs.map((d) => BSON.serialize(d)));
    const records = parseBsonBuffer(buf);

    assert.equal(records.length, 3);

    // 1. Reconciliation Engine
    const report = reconcileFeeDataset(records);
    assert.equal(report.summary.totalRecordsAudited, 3);
    assert.equal(report.summary.confirmedRecurringCount, 2);
    assert.equal(report.summary.confirmedRegistrationCount, 1);
    assert.equal(report.summary.duplicateGroupsCount, 0);

    // 2. Backfill Planner
    const plan = generateBackfillPlan(records);
    assert.equal(plan.summary.totalRecordsInspected, 3);
    assert.equal(plan.summary.safeRecurringBackfillCandidatesCount, 2);
    assert.equal(plan.summary.nonRecurringRegistrationCount, 1);
    assert.equal(plan.proposedChanges.length, 2);
    assert.equal(plan.proposedChanges[0].proposedUpdates.billingMonth, "2024-09");
    assert.equal(plan.proposedChanges[1].proposedUpdates.billingMonth, "2024-10");
  });
});
