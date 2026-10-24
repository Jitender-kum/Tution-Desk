import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Resolves the JWT secret key from the environment.
 * - Missing or empty secret in production -> Fails closed with fatal error.
 * - Missing or empty secret in local development -> Fails closed with configuration error.
 * - Configuration errors are thrown immediately and must not be swallowed.
 */
export function getJwtSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FATAL: JWT_SECRET environment variable is missing or empty in production. System is failing closed."
      );
    }
    throw new Error(
      "Configuration error: JWT_SECRET environment variable is not defined. Please configure JWT_SECRET in your environment."
    );
  }
  return new TextEncoder().encode(secret.trim());
}

/**
 * Sign a JWT token with the provided payload using jose.
 * Expires in 7 days.
 */
export async function signToken(
  payload: Record<string, unknown>
): Promise<string> {
  const secretKey = getJwtSecretKey();
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);
}

/**
 * Verify a JWT token using jose.
 * Throws configuration errors if JWT_SECRET is missing (does not swallow them).
 * Returns null only if the token itself is invalid or expired.
 */
export async function verifyToken<T = JWTPayload>(
  token: string
): Promise<T | null> {
  const secretKey = getJwtSecretKey();
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload as T;
  } catch {
    return null;
  }
}
