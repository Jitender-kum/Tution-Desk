const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

/**
 * Retrieves the active tuition center ID dynamically from cookies or localStorage.
 * No hardcoding — correctly scopes data to the currently authenticated owner.
 */
export function getCurrentCenterId(): string {
  if (typeof window !== "undefined") {
    // 1. Read from document.cookie (set on login/register & refreshed by middleware)
    const cookieMatch = document.cookie.match(/(?:^|;\s*)center_id=([^;]+)/);
    if (cookieMatch && cookieMatch[1]) {
      return decodeURIComponent(cookieMatch[1]);
    }
    // 2. Read from localStorage
    const stored = localStorage.getItem("user_center_id");
    if (stored) {
      return stored;
    }
  }
  return "";
}

/**
 * Dynamically resolves the active center ID.
 * Kept for backwards compatibility with existing UI components.
 */
export const CURRENT_CENTER_ID = typeof window !== "undefined" ? getCurrentCenterId() : "";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

/**
 * Generic API client utility for fetching backend endpoints.
 * Automatically attaches authentication cookies, Bearer token, and active centerId.
 */
export async function apiClient<T = unknown>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { params = {}, body, headers = {}, ...rest } = options;

  let url = `${BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  // Automatically inject dynamic centerId if not explicitly provided or if legacy hardcoded
  const activeCenterId = getCurrentCenterId();
  const queryParams: Record<string, string | number | boolean | undefined | null> = {
    ...params,
  };

  if ((!queryParams.centerId || queryParams.centerId === "aroven-001") && activeCenterId) {
    queryParams.centerId = activeCenterId;
  }

  const searchParams = new URLSearchParams();
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, String(value));
    }
  });
  const queryString = searchParams.toString();
  if (queryString) {
    url += (url.includes("?") ? "&" : "?") + queryString;
  }

  // Retrieve auth token if stored locally
  const token =
    typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (activeCenterId) {
    authHeaders["x-center-id"] = activeCenterId;
  }

  // If body is an object, inject centerId if missing or hardcoded
  let payloadBody = body;
  if (
    payloadBody &&
    typeof payloadBody === "object" &&
    !Array.isArray(payloadBody) &&
    activeCenterId
  ) {
    const obj = payloadBody as Record<string, unknown>;
    if (!obj.centerId || obj.centerId === "aroven-001") {
      payloadBody = { ...obj, centerId: activeCenterId };
    }
  }

  const response = await fetch(url, {
    credentials: "include", // Pass cookies cross-origin between port 3000 & 3001
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...headers,
    },
    body: payloadBody !== undefined ? JSON.stringify(payloadBody) : undefined,
    ...rest,
  });

  const json = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !json.success) {
    throw new Error(json.error || `Request failed with status ${response.status}`);
  }

  return json;
}

export default apiClient;

