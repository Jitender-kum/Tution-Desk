import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBatch {
  centerId: string;
  name: string;
  timing?: string;
  subject?: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IBatchDocument extends IBatch, Document {}

const BatchSchema = new Schema<IBatchDocument>(
  {
    centerId: {
      type: String,
      required: [true, "Center ID is required"],
      ref: "Center",
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Batch name is required"],
      trim: true,
    },
    timing: {
      type: String,
      trim: true,
    },
    subject: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for unique batch name within the same center
BatchSchema.index({ centerId: 1, name: 1 });

// In development, reset cached model to support hot reloads
if (process.env.NODE_ENV !== "production" && mongoose.models.Batch) {
  delete (mongoose.models as Record<string, unknown>).Batch;
}

export const Batch: Model<IBatchDocument> =
  (mongoose.models.Batch as Model<IBatchDocument>) ||
  mongoose.model<IBatchDocument>("Batch", BatchSchema);

export default Batch;
