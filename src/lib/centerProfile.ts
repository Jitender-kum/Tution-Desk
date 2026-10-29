import { getCurrentCenterId } from "./apiClient";

export interface CenterInfo {
  name: string;
  ownerName?: string;
  tagline?: string;
  centerId?: string;
}

let cachedCenter: CenterInfo | null = null;
let centerPromise: Promise<CenterInfo | null> | null = null;
let cacheEpoch = 0;

/**
 * Fetches authenticated tuition center profile with:
 * 1. Active center identity validation (prevents stale cross-account metadata).
 * 2. In-flight request deduplication (prevents duplicate simultaneous /api/auth/me calls).
 * 3. Generation/epoch protection (prevents in-flight responses from repopulating cache after invalidation).
 */
export async function getAuthenticatedCenter(): Promise<CenterInfo | null> {
  const activeCenterId = getCurrentCenterId();

  // If a cached center exists but active identity has changed (or session ended), invalidate stale cache
  if (cachedCenter && (!activeCenterId || cachedCenter.centerId !== activeCenterId)) {
    cachedCenter = null;
    centerPromise = null;
    cacheEpoch++;
  }

  // Return cached center if it matches the currently authenticated center identity
  if (
    cachedCenter &&
    activeCenterId &&
    cachedCenter.centerId === activeCenterId
  ) {
    return cachedCenter;
  }

  // Deduplicate in-flight requests within the current epoch
  if (centerPromise) return centerPromise;

  const requestEpoch = cacheEpoch;

  centerPromise = fetch("/api/auth/me")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      // If cache was invalidated while this request was in-flight, discard stale response
      if (requestEpoch !== cacheEpoch) {
        return null;
      }

      if (data?.center?.name) {
        const sessionCenterId = data.center.centerId ? String(data.center.centerId).trim() : "";
        const freshCenter: CenterInfo = {
          name: String(data.center.name).trim(),
          ownerName: data.center.ownerName || "Owner",
          tagline: data.center.tagline || "Classes 8th - 12th • CBSE & State",
          centerId: sessionCenterId || activeCenterId || "",
        };

        // If client storage has an activeCenterId that conflicts with the backend session, do not cache
        const currentActiveId = getCurrentCenterId();
        if (currentActiveId && sessionCenterId && currentActiveId !== sessionCenterId) {
          return null;
        }

        cachedCenter = freshCenter;
        return cachedCenter;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      if (requestEpoch === cacheEpoch) {
        centerPromise = null;
      }
    });

  return centerPromise;
}

/**
 * Clears the center cache upon sign out, login, registration, or session termination.
 * Increments cacheEpoch so any active in-flight requests are discarded.
 */
export function clearCachedCenter(): void {
  cacheEpoch++;
  cachedCenter = null;
  centerPromise = null;
}
