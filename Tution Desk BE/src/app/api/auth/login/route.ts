import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Center from "@/models/Center";
import { signToken } from "@/lib/jwt";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const body = await request.json();
    const { phone, password } = body;

    if (!phone || !password) {
      return NextResponse.json(
        { success: false, error: "Phone number and password are required." },
        { status: 400 }
      );
    }

    const cleanPhone = String(phone).trim();

    // Find Center by phone
    const center = await Center.findOne({ phone: cleanPhone });

    if (!center) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid phone number or password.",
        },
        { status: 401 }
      );
    }

    // Verify password with bcryptjs
    let isMatch = false;
    if (center.password) {
      isMatch = await bcrypt.compare(String(password), center.password);
    } else {
      // Legacy fallback for previously seeded centers: accept default password & migrate hash
      if (password === "password123" || password === "123456") {
        isMatch = true;
        const salt = await bcrypt.genSalt(10);
        center.password = await bcrypt.hash(password, salt);
        await center.save();
      }
    }

    if (!isMatch) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid phone number or password.",
        },
        { status: 401 }
      );
    }

    // Generate JWT strictly using the center's actual centerId
    const token = await signToken({
      centerId: center.centerId,
      role: "owner",
    });

    const response = NextResponse.json(
      {
        success: true,
        center: {
          centerId: center.centerId,
          name: center.name,
          ownerName: center.ownerName,
          phone: center.phone,
          themeColor: center.themeColor,
        },
        token,
      },
      { status: 200 }
    );

    // Set HttpOnly cookie
    response.cookies.set({
      name: "auth_token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Authentication error";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}

