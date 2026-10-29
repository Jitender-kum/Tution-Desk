import test from "node:test";
import assert from "node:assert/strict";

// Setup browser globals for Node test environment before importing modules
const storage = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};
globalThis.document = {
  cookie: "",
};

// Dynamically import centerProfile with experimental strip types
const { getAuthenticatedCenter, clearCachedCenter } = await import(
  "../src/lib/centerProfile.ts"
);

test("centerProfile cache & account-switch protection", async (t) => {
  t.beforeEach(() => {
    storage.clear();
    globalThis.document.cookie = "";
    clearCachedCenter();
  });

  await t.test(
    "1. Cache hit: returns cached center without repeated fetches when identity is unchanged",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-alpha");
      let fetchCount = 0;

      globalThis.fetch = async (url) => {
        fetchCount++;
        assert.equal(url, "/api/auth/me");
        return {
          ok: true,
          json: async () => ({
            success: true,
            center: {
              centerId: "center-alpha",
              name: "Alpha Academy",
              ownerName: "Alice",
            },
          }),
        };
      };

      const center1 = await getAuthenticatedCenter();
      assert.deepEqual(center1, {
        name: "Alpha Academy",
        ownerName: "Alice",
        tagline: "Classes 8th - 12th • CBSE & State",
        centerId: "center-alpha",
      });
      assert.equal(fetchCount, 1);

      // Second call should hit in-memory cache without fetching again
      const center2 = await getAuthenticatedCenter();
      assert.deepEqual(center2, center1);
      assert.equal(fetchCount, 1, "fetch should not be called on cache hit");
    }
  );

  await t.test(
    "2. In-flight deduplication: concurrent calls share a single fetch promise",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-alpha");
      let fetchCount = 0;

      globalThis.fetch = async () => {
        fetchCount++;
        await new Promise((res) => setTimeout(res, 20));
        return {
          ok: true,
          json: async () => ({
            success: true,
            center: {
              centerId: "center-alpha",
              name: "Alpha Academy",
            },
          }),
        };
      };

      const [res1, res2, res3] = await Promise.all([
        getAuthenticatedCenter(),
        getAuthenticatedCenter(),
        getAuthenticatedCenter(),
      ]);

      assert.equal(fetchCount, 1, "Expected single in-flight fetch call");
      assert.equal(res1?.name, "Alpha Academy");
      assert.equal(res2?.name, "Alpha Academy");
      assert.equal(res3?.name, "Alpha Academy");
    }
  );

  await t.test(
    "3. Account switch cache invalidation: switches from Center Alpha to Center Beta",
    async () => {
      let activeId = "center-alpha";
      globalThis.localStorage.setItem("user_center_id", activeId);
      let fetchCount = 0;

      globalThis.fetch = async () => {
        fetchCount++;
        return {
          ok: true,
          json: async () => ({
            success: true,
            center: {
              centerId: activeId,
              name: activeId === "center-alpha" ? "Alpha Academy" : "Beta Institute",
            },
          }),
        };
      };

      // 1st account
      const first = await getAuthenticatedCenter();
      assert.equal(first?.name, "Alpha Academy");
      assert.equal(fetchCount, 1);

      // Account switch occurs (e.g. user re-logs in as Beta)
      activeId = "center-beta";
      globalThis.localStorage.setItem("user_center_id", activeId);

      // Next call MUST invalidate stale alpha cache and fetch beta
      const second = await getAuthenticatedCenter();
      assert.equal(second?.name, "Beta Institute");
      assert.equal(second?.centerId, "center-beta");
      assert.equal(fetchCount, 2, "Fresh fetch must occur on identity switch");
    }
  );

  await t.test(
    "4. Epoch protection: in-flight request discarded if clearCachedCenter called before completion",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-alpha");
      let resolveSlowFetch;
      const slowFetchPromise = new Promise((resolve) => {
        resolveSlowFetch = resolve;
      });

      globalThis.fetch = () => slowFetchPromise;

      // Start initial fetch (epoch 0)
      const inFlightPromise = getAuthenticatedCenter();

      // Logout or account switch happens while in-flight!
      clearCachedCenter();
      globalThis.localStorage.setItem("user_center_id", "center-beta");

      // The slow response finally resolves late
      resolveSlowFetch({
        ok: true,
        json: async () => ({
          success: true,
          center: {
            centerId: "center-alpha",
            name: "Stale Alpha Academy",
          },
        }),
      });

      const inFlightResult = await inFlightPromise;
      // Stale response must be discarded and return null
      assert.equal(
        inFlightResult,
        null,
        "Stale in-flight response should return null due to epoch mismatch"
      );

      // Future calls for center-beta must NOT find stale alpha in cache
      let betaFetched = false;
      globalThis.fetch = async () => {
        betaFetched = true;
        return {
          ok: true,
          json: async () => ({
            success: true,
            center: {
              centerId: "center-beta",
              name: "Beta Institute",
            },
          }),
        };
      };

      const freshResult = await getAuthenticatedCenter();
      assert.equal(freshResult?.name, "Beta Institute");
      assert.equal(betaFetched, true, "Must have fetched fresh Beta Institute");
    }
  );

  await t.test(
    "5. Session mismatch guard: rejects caching if backend session centerId contradicts client identity",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-alpha");

      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          success: true,
          center: {
            centerId: "center-rogue", // Mismatched ID from backend token
            name: "Rogue Center",
          },
        }),
      });

      const res = await getAuthenticatedCenter();
      assert.equal(
        res,
        null,
        "Should return null and not cache when active centerId contradicts backend centerId"
      );
    }
  );

  await t.test("6. clearCachedCenter resets cache immediately", async () => {
    globalThis.localStorage.setItem("user_center_id", "center-alpha");

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        success: true,
        center: {
          centerId: "center-alpha",
          name: "Alpha Academy",
        },
      }),
    });

    const res = await getAuthenticatedCenter();
    assert.equal(res?.name, "Alpha Academy");

    clearCachedCenter();

    // Verify next call triggers fetch
    let fetchedAgain = false;
    globalThis.fetch = async () => {
      fetchedAgain = true;
      return {
        ok: true,
        json: async () => ({
          success: true,
          center: {
            centerId: "center-alpha",
            name: "Alpha Academy Fresh",
          },
        }),
      };
    };

    const resAfterClear = await getAuthenticatedCenter();
    assert.equal(resAfterClear?.name, "Alpha Academy Fresh");
    assert.equal(fetchedAgain, true);
  });
});
