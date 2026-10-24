import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getJwtSecretKey } from "./jwt";

export interface AuthPayload extends JWTPayload {
  userId: string;
  centerId: string;
  role: "owner" | "parent";
}

/**
 * Sign a JWT token with userId, centerId, and role.
 * Expires in 7 days.
 */
export async function signToken(payload: {
  userId: string;
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
    return payload as AuthPayload;
  } catch {
    return null;
  }
}
