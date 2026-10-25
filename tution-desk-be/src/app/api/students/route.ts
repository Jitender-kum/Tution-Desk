import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Student from "@/models/Student";
import Center from "@/models/Center";
import { sendWelcomeMessage } from "@/lib/whatsappService";
import { getAuthenticatedCenterId } from "@/lib/auth";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const authCenterId = await getAuthenticatedCenterId(request);
    const body = await request.json();
    const {
      centerId,
      name,
      batch,
      parentWhatsApp,
      isActive,
      joiningDate,
      monthlyFee,
      billingCycleDate,
    } = body;

    const targetCenterId = authCenterId || centerId;

    if (!targetCenterId || !name || !batch || !parentWhatsApp) {
      return NextResponse.json(
        {
          success: false,
          error: "centerId, name, batch, and parentWhatsApp are required",
        },
        { status: 400 }
      );
    }

    const newStudent = await Student.create({
      centerId: targetCenterId,
      name: name.trim(),
      batch: batch.trim(),
      parentWhatsApp: parentWhatsApp.trim(),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
      monthlyFee: monthlyFee !== undefined ? Number(monthlyFee) : 0,
      billingCycleDate:
        billingCycleDate !== undefined ? Number(billingCycleDate) : 5,
    });

    // Automated WhatsApp Welcome Notification (non-blocking, scoped to center)
    try {
      const center = await Center.findOne({ centerId: targetCenterId });
      const defaultTemplate =
        "Welcome to our center! 🎉\n\nDear Parent, your child {{studentName}} has been successfully enrolled.\nTrack their daily attendance, view performance, and pay fees seamlessly using your personalized VIP portal:\n🔗 {{magicLink}}\n\nNo app installation required.";

      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        "http://localhost:3000";
      const magicLink = `${appUrl}/p/${newStudent._id.toString()}`;

      const template =
        center?.welcomeMessageTemplate || defaultTemplate;

      const customMessage = template
        .replace(/\{\{studentName\}\}/g, newStudent.name)
        .replace(/\{\{magicLink\}\}/g, magicLink);

      sendWelcomeMessage(
        newStudent.centerId,
        newStudent.parentWhatsApp,
        customMessage,
        newStudent._id.toString()
      ).catch((whatsappErr) => {
        console.error("Async WhatsApp Welcome Error:", whatsappErr);
      });
    } catch (dispatchErr) {
      console.error("Failed to dispatch WhatsApp Welcome Message:", dispatchErr);
    }

    return NextResponse.json(
      { success: true, data: newStudent },
      { status: 201 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create student";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = request.nextUrl;
    const authCenterId = await getAuthenticatedCenterId(request);
    const centerId = authCenterId || searchParams.get("centerId");

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "Authentication or centerId query parameter is required" },
        { status: 400 }
      );
    }

    const filter: Record<string, unknown> = { centerId };
    const batch = searchParams.get("batch");
    if (batch) {
      filter.batch = batch;
    }

    const students = await Student.find(filter).sort({ createdAt: -1 });

    return NextResponse.json(
      { success: true, data: students },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch students";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
