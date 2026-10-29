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

// Dynamically import apiClient utilities
const {
  apiClient,
  getApiCache,
  clearApiCache,
  invalidateApiCache,
  getCurrentCenterId,
} = await import("../src/lib/apiClient.ts");

test("UX & Performance: Client Caching & In-Flight Deduplication Suite", async (t) => {
  t.beforeEach(() => {
    storage.clear();
    globalThis.document.cookie = "";
    clearApiCache();
  });

  await t.test(
    "1. Short-lived read caching: repeated GET calls return cached data without repeated fetch",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-101");
      let networkCalls = 0;

      globalThis.fetch = async (url) => {
        networkCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [{ id: "std_1", name: "Rohan Varma" }],
          }),
        };
      };

      // First call -> hits network
      const res1 = await apiClient("/students");
      assert.equal(networkCalls, 1);
      assert.equal(res1.data[0].name, "Rohan Varma");

      // Second call within TTL -> returns cached response directly
      const res2 = await apiClient("/students");
      assert.equal(networkCalls, 1, "fetch must not be called again on cache hit");
      assert.deepEqual(res2.data, res1.data);
    }
  );

  await t.test(
    "2. In-flight request deduplication: concurrent GET calls share a single network promise",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-101");
      let networkCalls = 0;

      globalThis.fetch = async () => {
        networkCalls++;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [{ id: "batch_1", name: "Class 10 Science" }],
          }),
        };
      };

      // Fire 3 simultaneous requests for /batches
      const [res1, res2, res3] = await Promise.all([
        apiClient("/batches"),
        apiClient("/batches"),
        apiClient("/batches"),
      ]);

      assert.equal(networkCalls, 1, "Expected exactly 1 network call for 3 concurrent requests");
      assert.equal(res1.data[0].name, "Class 10 Science");
      assert.equal(res2.data[0].name, "Class 10 Science");
      assert.equal(res3.data[0].name, "Class 10 Science");
    }
  );

  await t.test(
    "3. Synchronous cache reading (getApiCache) enables instant frame-0 rendering",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-101");

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { totalStudents: 42, pendingFeesTotal: 15000 },
        }),
      });

      // Initially, cache is empty
      const before = getApiCache("/dashboard/owner");
      assert.equal(before, null);

      // Fetch once to populate cache
      await apiClient("/dashboard/owner");

      // Synchronous read returns the cached entry immediately without await
      const after = getApiCache("/dashboard/owner");
      assert.ok(after);
      assert.equal(after.success, true);
      assert.equal(after.data.totalStudents, 42);
    }
  );

  await t.test(
    "4. Cache invalidation on mutation: POST/PUT/DELETE automatically invalidates active center cache",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-101");
      let networkCalls = 0;

      globalThis.fetch = async (url, options) => {
        networkCalls++;
        const method = options?.method || "GET";
        if (method === "POST") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { id: "std_new" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [{ id: "std_1", name: `Call #${networkCalls}` }],
          }),
        };
      };

      // 1. Initial GET -> network call #1
      const res1 = await apiClient("/students");
      assert.equal(networkCalls, 1);
      assert.equal(res1.data[0].name, "Call #1");

      // 2. Cache hit -> network calls stay 1
      const res2 = await apiClient("/students");
      assert.equal(networkCalls, 1);

      // 3. Mutation POST -> network call #2 and invalidates cache
      await apiClient("/students", {
        method: "POST",
        body: { name: "New Student" },
      });
      assert.equal(networkCalls, 2);

      // 4. Subsequent GET must fetch fresh data -> network call #3
      const res3 = await apiClient("/students");
      assert.equal(networkCalls, 3);
      assert.equal(res3.data[0].name, "Call #3");
    }
  );

  await t.test(
    "5. Account-switch protection: cached data is strictly isolated by centerId",
    async () => {
      // Center Alpha fetches /students
      globalThis.localStorage.setItem("user_center_id", "center-alpha");
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [{ id: "std_a", name: "Alpha Student" }],
        }),
      });

      await apiClient("/students");
      const alphaCached = getApiCache("/students");
      assert.equal(alphaCached?.data[0].name, "Alpha Student");

      // Switch account to Center Beta
      globalThis.localStorage.setItem("user_center_id", "center-beta");

      // Center Beta must NOT see Center Alpha's cached data
      const betaCached = getApiCache("/students");
      assert.equal(betaCached, null, "Center Beta must not read Center Alpha cached data");

      // Calling clearApiCache completely purges any remaining entries
      clearApiCache();
      assert.equal(getApiCache("/students"), null);
    }
  );

  await t.test(
    "6. Skip cache flag: requests with skipCache: true bypass client cache",
    async () => {
      globalThis.localStorage.setItem("user_center_id", "center-101");
      let networkCalls = 0;

      globalThis.fetch = async () => {
        networkCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [{ count: networkCalls }],
          }),
        };
      };

      await apiClient("/metrics");
      assert.equal(networkCalls, 1);

      // Normal call hits cache
      await apiClient("/metrics");
      assert.equal(networkCalls, 1);

      // skipCache: true forces network call
      const resFresh = await apiClient("/metrics", { skipCache: true });
      assert.equal(networkCalls, 2);
      assert.equal(resFresh.data[0].count, 2);
    }
  );
});
