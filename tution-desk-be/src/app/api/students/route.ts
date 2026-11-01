import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Student from "@/models/Student";
import Center, { DEFAULT_ADMISSION_TEMPLATE } from "@/models/Center";
import { sendWelcomeMessage, formatTemplate } from "@/lib/whatsappService";
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

    const cleanParentWhatsApp = String(parentWhatsApp).replace(/\D/g, "");
    if (cleanParentWhatsApp.length < 10 || cleanParentWhatsApp.length > 15) {
      return NextResponse.json(
        {
          success: false,
          error: "parentWhatsApp must be a valid 10 to 15 digit phone number",
        },
        { status: 400 }
      );
    }

    const newStudent = await Student.create({
      centerId: targetCenterId,
      name: name.trim(),
      batch: batch.trim(),
      parentWhatsApp: cleanParentWhatsApp,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
      monthlyFee: monthlyFee !== undefined ? Number(monthlyFee) : 0,
      billingCycleDate:
        billingCycleDate !== undefined ? Number(billingCycleDate) : 5,
    });

    // Automated WhatsApp Welcome Notification (non-blocking, scoped to center)
    try {
      const center = await Center.findOne({ centerId: targetCenterId });
      const template =
        center?.messagingTemplates?.admission ||
        center?.welcomeMessageTemplate ||
        DEFAULT_ADMISSION_TEMPLATE;

      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        "http://localhost:3000";
      const magicLink = `${appUrl}/p/${newStudent._id.toString()}`;

      const customMessage = formatTemplate(template, {
        studentName: newStudent.name,
        magicLink,
      });

      sendWelcomeMessage(
        newStudent.centerId,
        newStudent.parentWhatsApp,
        customMessage,
        newStudent._id.toString()
      )
        .then((result) => {
          const maskedPhone =
            newStudent.parentWhatsApp && newStudent.parentWhatsApp.length >= 4
              ? `***${newStudent.parentWhatsApp.slice(-4)}`
              : "****";
          if (result.simulated) {
            console.log(
              `[ADMISSION NOTIFICATION SIMULATED] Student: ${newStudent.name} (${newStudent._id}) | Center: ${newStudent.centerId} | Recipient: ${maskedPhone} | Simulation mode active.`
            );
          } else if (result.success) {
            console.log(
              `[ADMISSION NOTIFICATION DISPATCHED] Student: ${newStudent.name} (${newStudent._id}) | Center: ${newStudent.centerId} | Recipient: ${maskedPhone} | Provider accepted ID: ${result.messageId}`
            );
          } else {
            console.warn(
              `[ADMISSION NOTIFICATION FAILED] Student: ${newStudent.name} (${newStudent._id}) | Center: ${newStudent.centerId} | Recipient: ${maskedPhone} | Error: ${result.error || "Unknown send failure"}`
            );
          }
        })
        .catch((whatsappErr) => {
          const errMsg =
            whatsappErr instanceof Error ? whatsappErr.message : "Unknown error";
          console.error(
            `[ADMISSION NOTIFICATION ERROR] Center: ${newStudent.centerId} | Student ID: ${newStudent._id} | Error: ${errMsg}`
          );
        });
    } catch (dispatchErr) {
      const errMsg =
        dispatchErr instanceof Error ? dispatchErr.message : "Unknown error";
      console.error(
        `[ADMISSION NOTIFICATION INIT ERROR] Center: ${targetCenterId} | Error: ${errMsg}`
      );
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
