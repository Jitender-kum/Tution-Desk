import mongoose, { Schema, Document, Model } from "mongoose";

export interface IFeeCreationLock {
  lockKey: string; // "centerId:studentId:billingMonth:feeType"
  centerId: string;
  studentId: string;
  billingMonth: string;
  feeType: string;
  lockedAt: Date;
  expiresAt: Date;
  holderId: string;
  status: "LOCKED" | "COMPLETED";
  feeId?: string;
}

export interface IFeeCreationLockDocument extends IFeeCreationLock, Document {}

const FeeCreationLockSchema = new Schema<IFeeCreationLockDocument>(
  {
    lockKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    centerId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    studentId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    billingMonth: {
      type: String,
      required: true,
      trim: true,
    },
    feeType: {
      type: String,
      required: true,
      default: "monthly_recurring",
    },
    lockedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: "10m" }, // TTL index as safety net
    },
    holderId: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["LOCKED", "COMPLETED"],
      required: true,
      default: "LOCKED",
    },
    feeId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    autoIndex: false,
  }
);

// Ensure unique index on lockKey
FeeCreationLockSchema.index({ lockKey: 1 }, { unique: true });

export const FeeCreationLock: Model<IFeeCreationLockDocument> =
  (mongoose.models.FeeCreationLock as Model<IFeeCreationLockDocument>) ||
  mongoose.model<IFeeCreationLockDocument>("FeeCreationLock", FeeCreationLockSchema);

/**
 * Verifies whether the unique index on 'lockKey' is active and enforced on the collection.
 * When Mongoose autoIndex is false (standard in production), unique constraints are NOT automatically
 * created by Mongoose and require explicit database index verification.
 */
export async function verifyLockIndexIntegrity(model?: any): Promise<boolean> {
  const targetModel = model || FeeCreationLock;
  if (!targetModel) return false;

  try {
    if (typeof targetModel.hasUniqueLockIndex === "function") {
      return await targetModel.hasUniqueLockIndex();
    }
    const collection = targetModel.collection;
    if (collection) {
      if (typeof collection.indexes === "function") {
        const indexes = await collection.indexes();
        return indexes.some(
          (idx: any) => idx.key && idx.key.lockKey === 1 && idx.unique === true
        );
      }
      if (typeof collection.listIndexes === "function") {
        const cursor = collection.listIndexes();
        const indexes =
          typeof cursor.toArray === "function" ? await cursor.toArray() : await cursor;
        return indexes.some(
          (idx: any) => idx.key && idx.key.lockKey === 1 && idx.unique === true
        );
      }
    }
    if (targetModel.enforceUniqueness !== undefined) {
      return Boolean(targetModel.enforceUniqueness);
    }
  } catch {
    return false;
  }
  return false;
}

export default FeeCreationLock;

