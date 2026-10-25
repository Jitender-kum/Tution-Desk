import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type AttendanceStatusType = "Present" | "Absent";

export interface IAttendance {
  centerId: string;
  studentId: Types.ObjectId;
  date: Date;
  batch: string;
  status: AttendanceStatusType;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IAttendanceDocument extends IAttendance, Document {}

const AttendanceSchema = new Schema<IAttendanceDocument>(
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
    date: {
      type: Date,
      required: [true, "Attendance date is required"],
      index: true,
    },
    batch: {
      type: String,
      required: [true, "Batch is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ["Present", "Absent"],
        message: "{VALUE} is not a valid attendance status (must be Present or Absent)",
      },
      required: [true, "Attendance status is required"],
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for multi-tenant querying
AttendanceSchema.index({ centerId: 1, studentId: 1, date: 1 });
AttendanceSchema.index({ centerId: 1, batch: 1, date: 1 });

export const Attendance: Model<IAttendanceDocument> =
  (mongoose.models.Attendance as Model<IAttendanceDocument>) ||
  mongoose.model<IAttendanceDocument>("Attendance", AttendanceSchema);

export default Attendance;
