/**
 * TuitionDesk Phase 2I — Snapshot Input Reader
 *
 * Provides safe, offline, zero-network reading and validation of BSON and JSON
 * fee database backup files.
 *
 * SAFETY INVARIANTS:
 * 1. Strictly offline: Zero network requests or database connections.
 * 2. Immutable: Read-only access; never writes or modifies the snapshot file.
 * 3. Robust validation: Strict BSON boundary and size checks; rejects malformed or truncated data.
 * 4. Preservation: Correctly preserves ObjectId hex strings, Date objects, and primitives.
 */

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import type { RawFeeRecord } from "./reconciliationEngine.ts";

export interface SnapshotReadResult {
  records: RawFeeRecord[];
  filePath: string;
  fileSizeBytes: number;
  format: "bson" | "json";
}

/**
 * Normalizes an arbitrary deserialized document into a conforming RawFeeRecord.
 * Converts BSON ObjectId instances to strings while preserving Date objects and other primitives.
 */
export function normalizeSnapshotRecord(raw: Record<string, unknown>): RawFeeRecord {
  const norm = { ...raw };

  // Normalize _id
  if (norm._id !== undefined && norm._id !== null) {
    norm._id = typeof norm._id === "object" && "_bsontype" in norm._id ? String(norm._id) : String(norm._id);
  }

  // Normalize centerId
  if (norm.centerId !== undefined && norm.centerId !== null) {
    norm.centerId = typeof norm.centerId === "object" && "_bsontype" in norm.centerId ? String(norm.centerId) : String(norm.centerId);
  }

  // Normalize studentId: can be ObjectId, string, or populated object
  if (norm.studentId !== undefined && norm.studentId !== null) {
    if (typeof norm.studentId === "object" && norm.studentId !== null) {
      if ("_bsontype" in norm.studentId) {
        norm.studentId = String(norm.studentId);
      } else {
        const studentObj = { ...(norm.studentId as Record<string, unknown>) };
        if (studentObj._id !== undefined && studentObj._id !== null) {
          studentObj._id = String(studentObj._id);
        }
        norm.studentId = studentObj as unknown as RawFeeRecord["studentId"];
      }
    } else {
      norm.studentId = String(norm.studentId);
    }
  }

  return norm as unknown as RawFeeRecord;
}

/**
 * Safely parses a BSON buffer containing one or more sequential BSON documents.
 * Validates document length headers against buffer boundaries.
 * Throws explicit errors on truncated or malformed BSON.
 */
export function parseBsonBuffer(buffer: Buffer): RawFeeRecord[] {
  if (buffer.length === 0) {
    return [];
  }

  const { BSON } = mongoose.mongo;
  const records: RawFeeRecord[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Each BSON document must have at least 5 bytes: 4 bytes length (int32) + 1 byte terminator (0x00)
    if (offset + 4 > buffer.length) {
      throw new Error(
        `Malformed BSON: truncated header at byte offset ${offset}. Expected 4 bytes for document length, found ${buffer.length - offset}.`
      );
    }

    const docSize = buffer.readInt32LE(offset);

    // Validate size sanity
    if (docSize < 5) {
      throw new Error(
        `Malformed BSON: invalid document size ${docSize} at byte offset ${offset}. Minimum BSON document size is 5 bytes.`
      );
    }

    if (offset + docSize > buffer.length) {
      throw new Error(
        `Truncated BSON: document at offset ${offset} specifies length ${docSize}, but remaining buffer is only ${buffer.length - offset} bytes.`
      );
    }

    // Verify last byte of document is 0x00 (BSON null terminator)
    if (buffer[offset + docSize - 1] !== 0x00) {
      throw new Error(
        `Malformed BSON: document at offset ${offset} of length ${docSize} missing null terminator (0x00).`
      );
    }

    const docBuffer = buffer.subarray(offset, offset + docSize);
    let deserialized: Record<string, unknown>;
    try {
      deserialized = BSON.deserialize(docBuffer, {
        promoteBuffers: true,
      }) as Record<string, unknown>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Malformed BSON: deserialization failed at offset ${offset}: ${msg}`);
    }

    records.push(normalizeSnapshotRecord(deserialized));
    offset += docSize;
  }

  return records;
}

/**
 * Safely reads a BSON or JSON fee snapshot file from disk.
 * Strictly read-only. Never modifies the file or accesses network/database.
 */
export function readFeeSnapshotFile(targetPath: string): SnapshotReadResult {
  const resolvedPath = path.resolve(process.cwd(), targetPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Snapshot file not found: "${resolvedPath}".`);
  }

  const stats = fs.statSync(resolvedPath);
  if (stats.isDirectory()) {
    throw new Error(`Snapshot path is a directory, expected a file: "${resolvedPath}".`);
  }

  const buffer = fs.readFileSync(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();

  let records: RawFeeRecord[];
  let format: "bson" | "json";

  if (ext === ".json") {
    format = "json";
    if (buffer.length === 0) {
      records = [];
    } else {
      try {
        const parsed = JSON.parse(buffer.toString("utf8"));
        if (!Array.isArray(parsed)) {
          throw new Error("JSON snapshot content must be an array of fee documents.");
        }
        records = parsed.map((item) => normalizeSnapshotRecord(item as Record<string, unknown>));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Malformed JSON snapshot: ${msg}`);
      }
    }
  } else {
    // Default to BSON parsing (e.g. .bson or unextensioned dump files)
    format = "bson";
    records = parseBsonBuffer(buffer);
  }

  return {
    records,
    filePath: resolvedPath,
    fileSizeBytes: stats.size,
    format,
  };
}
