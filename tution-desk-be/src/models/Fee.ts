import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type FeeStatusType =
  | "Pending"
  | "Paid"
  | "Verification Pending"
  | "Partial Paid";

export type FeeType =
  | "monthly_recurring"
  | "advance"
  | "adhoc"
  | "registration";

export interface IPaymentTransaction {
  txnId: string;
  amount: number;
  date?: Date;
  mode?: string;
  status?: string;
}

export interface IFee {
  centerId: string;
  studentId: Types.ObjectId;
  billingMonth?: string; // Canonical YYYY-MM format (e.g., "2026-10")
  month: string; // Human-readable or legacy label
  title?: string;
  amountDue: number;
  paidAmount?: number;
  dueDate: Date;
  status: FeeStatusType;
  feeType?: FeeType;
  lastReminderSentAt?: Date;
  reminderCount?: number;
  reminderPaused?: boolean;
  reminderLockUntil?: Date;
  utrNumber?: string;
  upiTransactionId?: string;
  processedTxnIds?: string[];
  paymentTransactions?: IPaymentTransaction[];
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
    billingMonth: {
      type: String,
      trim: true,
      match: [/^\d{4}-\d{2}$/, "Invalid billing month format (expected YYYY-MM)"],
    },
    feeType: {
      type: String,
      enum: {
        values: ["monthly_recurring", "advance", "adhoc", "registration"],
        message: "{VALUE} is not a valid fee type",
      },
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
    lastReminderSentAt: {
      type: Date,
    },
    reminderCount: {
      type: Number,
      default: 0,
      min: [0, "Reminder count cannot be negative"],
    },
    reminderPaused: {
      type: Boolean,
      default: false,
    },
    reminderLockUntil: {
      type: Date,
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
    processedTxnIds: {
      type: [String],
      default: [],
    },
    paymentTransactions: [
      {
        txnId: { type: String, trim: true },
        amount: { type: Number },
        date: { type: Date },
        mode: { type: String, default: "Online/UPI" },
        status: { type: String, default: "SUCCESS" },
      },
    ],
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
    autoIndex: false,
  }
);

// Compound indexes for multi-tenant querying
FeeSchema.index({ centerId: 1, studentId: 1, month: 1 });
FeeSchema.index({ centerId: 1, status: 1 });

if (
  process.env.NODE_ENV !== "production" &&
  mongoose.models.Fee &&
  (!mongoose.models.Fee.schema.path("billingMonth") ||
    !mongoose.models.Fee.schema.path("feeType"))
) {
  delete (mongoose.models as Record<string, unknown>).Fee;
}

export const Fee: Model<IFeeDocument> =
  (mongoose.models.Fee as Model<IFeeDocument>) ||
  mongoose.model<IFeeDocument>("Fee", FeeSchema);

export default Fee;
