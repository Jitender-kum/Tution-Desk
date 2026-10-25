import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type FeeStatusType =
  | "Pending"
  | "Paid"
  | "Verification Pending"
  | "Partial Paid";

export interface IFee {
  centerId: string;
  studentId: Types.ObjectId;
  month: string;
  title?: string;
  amountDue: number;
  paidAmount?: number;
  dueDate: Date;
  status: FeeStatusType;
  utrNumber?: string;
  upiTransactionId?: string;
  paymentDate?: Date;
  paidDate?: Date;
  paidAt?: Date;
  paymentMode?: string;
  receiptNumber?: string;
  isAdvance?: boolean;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IFeeDocument extends IFee, Document {}

const FeeSchema = new Schema<IFeeDocument>(
  {
    centerId: {
      type: String,
      required: [true, "Center ID is required"],
      ref: "Center",
      index: true,
      trim: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student ID is required"],
      index: true,
    },
    month: {
      type: String,
      required: [true, "Fee month is required"],
      trim: true,
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    amountDue: {
      type: Number,
      required: [true, "Amount due is required"],
      min: [0, "Amount due cannot be negative"],
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: [0, "Paid amount cannot be negative"],
    },
    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
    },
    status: {
      type: String,
      enum: {
        values: ["Pending", "Paid", "Verification Pending", "Partial Paid"],
        message:
          "{VALUE} is not a valid fee status",
      },
      default: "Pending",
      required: [true, "Fee status is required"],
    },
    utrNumber: {
      type: String,
      trim: true,
      default: "",
    },
    upiTransactionId: {
      type: String,
      trim: true,
      default: "",
    },
    paymentDate: {
      type: Date,
    },
    paidDate: {
      type: Date,
    },
    paidAt: {
      type: Date,
    },
    paymentMode: {
      type: String,
      trim: true,
      default: "Manual/Cash",
    },
    receiptNumber: {
      type: String,
      trim: true,
      default: "",
    },
    isAdvance: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for multi-tenant querying
FeeSchema.index({ centerId: 1, studentId: 1, month: 1 });
FeeSchema.index({ centerId: 1, status: 1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.Fee) {
  delete (mongoose.models as Record<string, unknown>).Fee;
}

export const Fee: Model<IFeeDocument> =
  (mongoose.models.Fee as Model<IFeeDocument>) ||
  mongoose.model<IFeeDocument>("Fee", FeeSchema);

export default Fee;
