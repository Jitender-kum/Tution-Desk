import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json(
    { success: true, message: "Logged out successfully" },
    { status: 200 }
  );

  response.cookies.delete("auth_token");
  response.cookies.delete("parent_token");
  response.cookies.delete("center_id");
  return response;
}
