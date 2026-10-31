import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type ReminderTriggerType =
  | "auto_due_date"
  | "auto_followup"
  | "manual_owner_single"
  | "manual_owner_bulk";

export type ReminderDispatchStatus =
  | "attempted"
  | "provider_accepted"
  | "delivered"
  | "dispatch_uncertain"
  | "failed";

export interface IFeeReminderLog {
  centerId: string;
  feeId: Types.ObjectId;
  studentId: Types.ObjectId;
  recipientPhone: string;
  amountDue: number;
  dueDate: Date;
  triggerType: ReminderTriggerType;
  status: ReminderDispatchStatus;
  providerMessageId?: string;
  simulated: boolean;
  isManualOverride: boolean;
  overrideReason?: string;
  failureReason?: string;
  attemptedAt: Date;
  retryLockUntil?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IFeeReminderLogDocument extends IFeeReminderLog, Document {}

const FeeReminderLogSchema = new Schema<IFeeReminderLogDocument>(
  {
    centerId: {
      type: String,
      required: [true, "Center ID is required"],
      ref: "Center",
      index: true,
      trim: true,
    },
    feeId: {
      type: Schema.Types.ObjectId,
      ref: "Fee",
      required: [true, "Fee ID is required"],
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student ID is required"],
      index: true,
    },
    recipientPhone: {
      type: String,
      required: [true, "Recipient phone is required"],
      trim: true,
    },
    amountDue: {
      type: Number,
      required: [true, "Amount due is required"],
      min: [0, "Amount due cannot be negative"],
    },
    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
    },
    triggerType: {
      type: String,
      enum: {
        values: [
          "auto_due_date",
          "auto_followup",
          "manual_owner_single",
          "manual_owner_bulk",
        ],
        message: "{VALUE} is not a valid trigger type",
      },
      required: [true, "Trigger type is required"],
    },
    status: {
      type: String,
      enum: {
        values: [
          "attempted",
          "provider_accepted",
          "delivered",
          "dispatch_uncertain",
          "failed",
        ],
        message: "{VALUE} is not a valid reminder dispatch status",
      },
      required: [true, "Dispatch status is required"],
    },
    providerMessageId: {
      type: String,
      trim: true,
    },
    simulated: {
      type: Boolean,
      default: false,
    },
    isManualOverride: {
      type: Boolean,
      default: false,
    },
    overrideReason: {
      type: String,
      trim: true,
      default: "",
    },
    failureReason: {
      type: String,
      trim: true,
      default: "",
    },
    attemptedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    retryLockUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
    autoIndex: false,
  }
);

// Compound indexes for fast audit and center log retrieval
FeeReminderLogSchema.index({ feeId: 1, attemptedAt: -1 });
FeeReminderLogSchema.index({ centerId: 1, attemptedAt: -1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.FeeReminderLog) {
  delete (mongoose.models as Record<string, unknown>).FeeReminderLog;
}

export const FeeReminderLog: Model<IFeeReminderLogDocument> =
  (mongoose.models.FeeReminderLog as Model<IFeeReminderLogDocument>) ||
  mongoose.model<IFeeReminderLogDocument>("FeeReminderLog", FeeReminderLogSchema);

export default FeeReminderLog;
