import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

export interface AuthenticatedOwner {
  centerId: string;
  role: "owner";
}

export interface AuthOwnerResult {
  authenticated: boolean;
  owner?: AuthenticatedOwner;
  status: 200 | 401 | 403;
  error?: string;
}

/**
 * Verifies that the incoming request has a valid, non-expired JWT token
 * in the auth_token cookie or Authorization header, and that the authenticated
 * user has role 'owner' with a valid centerId.
 *
 * Rejects missing/invalid tokens (401) and non-owner roles (403).
 * Client-supplied center IDs are NEVER trusted.
 */
export async function verifyOwnerRequest(
  request: NextRequest
): Promise<AuthOwnerResult> {
  const cookieToken = request.cookies.get("auth_token")?.value;
  const authHeader = request.headers.get("authorization");
  let bearerToken: string | undefined;

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    bearerToken = authHeader.substring(7).trim();
  }

  const token = cookieToken || bearerToken;

  if (!token) {
    return {
      authenticated: false,
      status: 401,
      error: "Authentication required",
    };
  }

  const payload = await verifyToken<{
    centerId?: string;
    role?: string;
  }>(token);

  if (!payload || !payload.centerId || typeof payload.centerId !== "string") {
    return {
      authenticated: false,
      status: 401,
      error: "Invalid or expired session token",
    };
  }

  if (payload.role !== "owner") {
    return {
      authenticated: false,
      status: 403,
      error: "Forbidden: Owner privileges required",
    };
  }

  const cleanCenterId = payload.centerId.trim().toLowerCase();
  if (!cleanCenterId) {
    return {
      authenticated: false,
      status: 401,
      error: "Invalid center identification in session",
    };
  }

  return {
    authenticated: true,
    owner: {
      centerId: cleanCenterId,
      role: "owner",
    },
    status: 200,
  };
}
