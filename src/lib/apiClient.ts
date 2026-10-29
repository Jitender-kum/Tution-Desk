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

export interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /**
   * Set to true to bypass cache read and force a fresh network fetch.
   */
  skipCache?: boolean;
  /**
   * Custom cache time-to-live in milliseconds. Defaults to 60,000ms (60s).
   * Set to 0 to disable caching of the response.
   */
  cacheTtlMs?: number;
}

interface CacheEntry<T> {
  data: ApiResponse<T>;
  expiresAt: number;
  centerId: string;
}

// In-memory short-lived cache and in-flight request deduplication map
const apiCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<ApiResponse<any>>>();

/**
 * Builds a deterministic cache key scoped by active center ID and sorted query parameters.
 */
function buildCacheKey(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined | null> | undefined,
  centerId: string
): string {
  const normEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!params || Object.keys(params).length === 0) {
    return `${centerId}::${normEndpoint}`;
  }
  const keys = Object.keys(params)
    .filter((k) => k !== "centerId")
    .sort();
  const searchParams = new URLSearchParams();
  for (const k of keys) {
    const val = params[k];
    if (val !== undefined && val !== null && val !== "") {
      searchParams.append(k, String(val));
    }
  }
  const queryString = searchParams.toString();
  return queryString
    ? `${centerId}::${normEndpoint}?${queryString}`
    : `${centerId}::${normEndpoint}`;
}

/**
 * Clears the in-memory API response cache and any active in-flight request records.
 * If centerIdOnly is provided, only entries for that center are cleared.
 */
export function clearApiCache(centerIdOnly?: string): void {
  if (centerIdOnly) {
    for (const [key, entry] of apiCache.entries()) {
      if (entry.centerId === centerIdOnly) {
        apiCache.delete(key);
      }
    }
  } else {
    apiCache.clear();
  }
  inFlightRequests.clear();
}

/**
 * Invalidates cache entries matching an endpoint pattern or all entries for the active center.
 */
export function invalidateApiCache(pattern?: string | RegExp): void {
  const activeCenterId = getCurrentCenterId();
  for (const [key, entry] of apiCache.entries()) {
    if (activeCenterId && entry.centerId !== activeCenterId) continue;
    if (!pattern) {
      apiCache.delete(key);
    } else if (typeof pattern === "string") {
      if (key.includes(pattern)) {
        apiCache.delete(key);
      }
    } else if (pattern.test(key)) {
      apiCache.delete(key);
    }
  }
}

/**
 * Synchronously retrieves valid, unexpired cached data if available.
 * Enables instant frame-0 rendering when navigating between tabs.
 */
export function getApiCache<T = unknown>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined | null>
): ApiResponse<T> | null {
  if (typeof window === "undefined") return null;
  const activeCenterId = getCurrentCenterId();
  if (!activeCenterId) return null;
  const key = buildCacheKey(endpoint, params, activeCenterId);
  const entry = apiCache.get(key);
  if (entry && entry.centerId === activeCenterId && Date.now() < entry.expiresAt) {
    return entry.data as ApiResponse<T>;
  }
  if (entry && Date.now() >= entry.expiresAt) {
    apiCache.delete(key);
  }
  return null;
}

/**
 * Generic API client utility for fetching backend endpoints.
 * Automatically attaches authentication cookies, Bearer token, and active centerId.
 * Includes short-lived read caching, in-flight deduplication, and mutation invalidation.
 */
export async function apiClient<T = unknown>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { params = {}, body, headers = {}, skipCache = false, cacheTtlMs, ...rest } = options;

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

  const method = (rest.method || "GET").toUpperCase();
  const isGet = method === "GET";
  const canCache = isGet && !skipCache && (cacheTtlMs === undefined || cacheTtlMs > 0);
  const cacheKey = canCache ? buildCacheKey(endpoint, queryParams, activeCenterId) : "";

  // 1. If eligible for cache read, check synchronous memory cache
  if (canCache && cacheKey) {
    const cachedEntry = apiCache.get(cacheKey);
    if (cachedEntry && cachedEntry.centerId === activeCenterId && Date.now() < cachedEntry.expiresAt) {
      return cachedEntry.data as ApiResponse<T>;
    }
    // 2. Check in-flight request deduplication
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight as Promise<ApiResponse<T>>;
    }
  }

  // 3. Construct and execute the fetch
  const executeFetch = async (): Promise<ApiResponse<T>> => {
    try {
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

      // If GET was successful and cacheable, save to client cache
      if (canCache && cacheKey) {
        const ttl = cacheTtlMs ?? 60000; // 60s default
        apiCache.set(cacheKey, {
          data: json,
          expiresAt: Date.now() + ttl,
          centerId: activeCenterId,
        });
      }

      // If mutation (POST/PUT/PATCH/DELETE), invalidate cache for active center
      if (!isGet) {
        invalidateApiCache();
      }

      return json;
    } finally {
      if (canCache && cacheKey) {
        inFlightRequests.delete(cacheKey);
      }
    }
  };

  if (canCache && cacheKey) {
    const promise = executeFetch();
    inFlightRequests.set(cacheKey, promise);
    return promise;
  }

  return executeFetch();
}

export default apiClient;
