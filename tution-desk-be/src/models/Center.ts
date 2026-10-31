import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICenter {
  centerId: string;
  name: string;
  ownerName: string;
  phone: string;
  password?: string;
  themeColor?: string;
  welcomeMessageTemplate?: string;
  upiId?: string;
  dueDateOffsetDays?: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICenterDocument extends ICenter, Document {}

const CenterSchema = new Schema<ICenterDocument>(
  {
    centerId: {
      type: String,
      required: [true, "Center ID is required"],
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Center name is required"],
      trim: true,
    },
    ownerName: {
      type: String,
      required: [true, "Owner name is required"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
    },
    themeColor: {
      type: String,
      default: "#2563eb",
      trim: true,
    },
    welcomeMessageTemplate: {
      type: String,
      default:
        "Welcome to our center! 🎉\n\nDear Parent, your child {{studentName}} has been successfully enrolled.\nTrack their daily attendance, view performance, and pay fees seamlessly using your personalized VIP portal:\n🔗 {{magicLink}}\n\nNo app installation required.",
    },
    upiId: {
      type: String,
      trim: true,
      default: "",
    },
    dueDateOffsetDays: {
      type: Number,
      default: 5,
      min: [0, "Due date offset cannot be negative"],
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

// Ensure updated schema with password, welcomeMessageTemplate, upiId, and dueDateOffsetDays fields is recompiled in Next.js development
if (
  mongoose.models.Center &&
  (!mongoose.models.Center.schema.path("password") ||
    !mongoose.models.Center.schema.path("welcomeMessageTemplate") ||
    !mongoose.models.Center.schema.path("upiId") ||
    !mongoose.models.Center.schema.path("dueDateOffsetDays"))
) {
  delete mongoose.models.Center;
}

export const Center: Model<ICenterDocument> =
  (mongoose.models.Center as Model<ICenterDocument>) ||
  mongoose.model<ICenterDocument>("Center", CenterSchema);

export default Center;

