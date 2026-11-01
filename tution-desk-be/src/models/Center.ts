import mongoose, { Schema, Document, Model } from "mongoose";

export interface IMessagingTemplates {
  admission?: string;
  feeReminder?: string;
  paymentReceipt?: string;
}

export const DEFAULT_ADMISSION_TEMPLATE =
  "Welcome to our center! 🎉\n\nDear Parent, your child {{studentName}} has been successfully enrolled.\nTrack their daily attendance, view performance, and pay fees seamlessly using your personalized VIP portal:\n🔗 {{magicLink}}\n\nNo app installation required.";

export const DEFAULT_FEE_REMINDER_TEMPLATE =
  "Payment Reminder 🔔\n\nDear Parent, this is a friendly reminder that the tuition fee of ₹{{amountDue}} for {{studentName}} is due on {{dueDate}}.\n\n💳 Pay or view fee receipt online directly via your VIP Parent Portal:\n🔗 {{magicLink}}\n\nIf you have already paid, please ignore this reminder. Thank you!";

export const DEFAULT_PAYMENT_RECEIPT_TEMPLATE =
  "Payment Received Successfully ✅\n\nDear Parent, we have received a payment of ₹{{paidAmount}} for {{studentName}}.\nOfficial Receipt Number: {{receiptNumber}}\n\n📄 View and download your updated fee ledger & receipt here:\n🔗 {{magicLink}}\n\nThank you for your timely payment!";

export interface ICenter {
  centerId: string;
  name: string;
  ownerName: string;
  phone: string;
  password?: string;
  themeColor?: string;
  welcomeMessageTemplate?: string;
  messagingTemplates?: IMessagingTemplates;
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
      default: DEFAULT_ADMISSION_TEMPLATE,
    },
    messagingTemplates: {
      admission: {
        type: String,
        default: DEFAULT_ADMISSION_TEMPLATE,
      },
      feeReminder: {
        type: String,
        default: DEFAULT_FEE_REMINDER_TEMPLATE,
      },
      paymentReceipt: {
        type: String,
        default: DEFAULT_PAYMENT_RECEIPT_TEMPLATE,
      },
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

// Ensure updated schema with password, welcomeMessageTemplate, messagingTemplates, upiId, and dueDateOffsetDays fields is recompiled in Next.js development
if (
  mongoose.models.Center &&
  (!mongoose.models.Center.schema.path("password") ||
    !mongoose.models.Center.schema.path("welcomeMessageTemplate") ||
    !mongoose.models.Center.schema.path("messagingTemplates.admission") ||
    !mongoose.models.Center.schema.path("upiId") ||
    !mongoose.models.Center.schema.path("dueDateOffsetDays"))
) {
  delete mongoose.models.Center;
}

export const Center: Model<ICenterDocument> =
  (mongoose.models.Center as Model<ICenterDocument>) ||
  mongoose.model<ICenterDocument>("Center", CenterSchema);

export default Center;

