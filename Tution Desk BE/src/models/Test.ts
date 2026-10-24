import mongoose, { Schema, Document, Model } from "mongoose";

export interface ITestResult {
  studentId: mongoose.Types.ObjectId | string;
  marksObtained: number;
  isAbsent?: boolean;
}

export interface ITest {
  centerId: string;
  title: string;
  batch: string;
  date: Date;
  maxMarks: number;
  results: ITestResult[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ITestDocument extends ITest, Document {}

const TestResultSchema = new Schema<ITestResult>(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    marksObtained: {
      type: Number,
      default: 0,
      min: [0, "Marks cannot be negative"],
    },
    isAbsent: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const TestSchema = new Schema<ITestDocument>(
  {
    centerId: {
      type: String,
      required: [true, "Center ID is required"],
      ref: "Center",
      index: true,
      trim: true,
    },
    title: {
      type: String,
      required: [true, "Test title is required"],
      trim: true,
    },
    batch: {
      type: String,
      required: [true, "Batch is required"],
      trim: true,
      index: true,
    },
    date: {
      type: Date,
      required: [true, "Test date is required"],
      default: Date.now,
    },
    maxMarks: {
      type: Number,
      required: [true, "Max marks is required"],
      min: [1, "Max marks must be at least 1"],
      default: 100,
    },
    results: {
      type: [TestResultSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for queries by center and date
TestSchema.index({ centerId: 1, date: -1 });

// In development, reset cached model to support hot reloads
if (process.env.NODE_ENV !== "production" && mongoose.models.Test) {
  delete (mongoose.models as Record<string, unknown>).Test;
}

export const Test: Model<ITestDocument> =
  (mongoose.models.Test as Model<ITestDocument>) ||
  mongoose.model<ITestDocument>("Test", TestSchema);

export default Test;
