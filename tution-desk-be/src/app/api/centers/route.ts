import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Center from "@/models/Center";

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const body = await request.json();
    const { centerId, name, ownerName, phone, themeColor } = body;

    const newCenter = await Center.create({
      centerId,
      name,
      ownerName,
      phone,
      themeColor,
    });

    return NextResponse.json(
      { success: true, data: newCenter },
      { status: 201 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create center";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await connectDB();

    const centers = await Center.find({}).sort({ createdAt: -1 });

    return NextResponse.json(
      { success: true, data: centers },
      { status: 200 }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch centers";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
