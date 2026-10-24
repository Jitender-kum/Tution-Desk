import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Center from "@/models/Center";
import { signToken } from "@/lib/jwt";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const body = await request.json();
    const { name, ownerName, phone, password } = body;

    if (!name || !ownerName || !phone || !password) {
      return NextResponse.json(
        {
          success: false,
          error:
            "All fields are required: name, ownerName, phone, and password.",
        },
        { status: 400 }
      );
    }

    if (String(password).length < 6) {
      return NextResponse.json(
        {
          success: false,
          error: "Password must be at least 6 characters long.",
        },
        { status: 400 }
      );
    }

    const cleanName = String(name).trim();
    const cleanOwnerName = String(ownerName).trim();
    const cleanPhone = String(phone).trim();

    // Check if phone number already registered
    const existingCenter = await Center.findOne({ phone: cleanPhone });

    if (existingCenter) {
      return NextResponse.json(
        { success: false, error: "Phone number is already registered." },
        { status: 409 }
      );
    }

    // Automatically generate centerId using center's name + random 4-digit number
    const baseSlug =
      cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "") || "center";

    let centerId = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 5) {
      const existingSlug = await Center.findOne({ centerId });
      if (!existingSlug) {
        isUnique = true;
      } else {
        centerId = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
        attempts++;
      }
    }

    // Hash password securely with bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(password), salt);

    // Create new Center with hashed password and auto-generated centerId
    const newCenter = await Center.create({
      centerId,
      name: cleanName,
      ownerName: cleanOwnerName,
      phone: cleanPhone,
      password: hashedPassword,
      themeColor: "#2563eb",
      isActive: true,
    });

    // Generate JWT strictly using the dynamically created center's centerId
    const token = await signToken({
      centerId: newCenter.centerId,
      role: "owner",
    });

    const sanitizedCenter = {
      centerId: newCenter.centerId,
      name: newCenter.name,
      ownerName: newCenter.ownerName,
      phone: newCenter.phone,
      themeColor: newCenter.themeColor,
      isActive: newCenter.isActive,
    };

    const response = NextResponse.json(
      {
        success: true,
        center: sanitizedCenter,
        token,
      },
      { status: 201 }
    );

    // Set HttpOnly cookie
    response.cookies.set({
      name: "auth_token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to register center.";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}

