import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { NextRequest } from "next/server";
import { getJwtSecretKey } from "./jwt";

export interface AuthPayload extends JWTPayload {
  userId?: string;
  centerId: string;
  role: "owner" | "parent";
}

/**
 * Sign a JWT token with userId, centerId, and role.
 * Expires in 7 days.
 */
export async function signToken(payload: {
  userId?: string;
  centerId: string;
  role: "owner" | "parent";
}): Promise<string> {
  const secretKey = getJwtSecretKey();
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);
}

/**
 * Verify a JWT token and return the payload.
 * Throws configuration errors if JWT_SECRET is missing.
 * Returns null if invalid or expired.
 */
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  const secretKey = getJwtSecretKey();
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as AuthPayload;
  } catch {
    return null;
  }
}

/**
 * Extracts and verifies the centerId strictly from the request's verified JWT token
 * in cookies or Authorization header (Bearer token).
 * Fails closed and returns null if unauthenticated.
 */
export async function getAuthenticatedCenterId(
  request: NextRequest
): Promise<string | null> {
  // 1. Check cookies (auth_token or token)
  const cookieToken =
    request.cookies.get("auth_token")?.value ||
    request.cookies.get("token")?.value;

  if (cookieToken) {
    const payload = await verifyToken(cookieToken);
    if (payload?.centerId) {
      return String(payload.centerId);
    }
  }

  // 2. Check Authorization header: Bearer <token>
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    const payload = await verifyToken(token);
    if (payload?.centerId) {
      return String(payload.centerId);
    }
  }

  return null;
}
