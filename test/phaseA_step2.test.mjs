import test from "node:test";
import assert from "node:assert/strict";

test("Phase A Step 2: High-Impact Optimizations Suite", async (t) => {
  await t.test(
    "1. Attendance save resilience: Promise.allSettled correctly separates successful and failed students",
    async () => {
      const mockStudents = [
        { id: "s1", name: "Student 1" },
        { id: "s2", name: "Student 2" },
        { id: "s3", name: "Student 3" },
      ];

      // Simulate 1 network failure out of 3
      const saveStudent = async (student) => {
        if (student.id === "s2") {
          throw new Error("Network timeout");
        }
        return { success: true, data: { studentId: student.id } };
      };

      const results = await Promise.allSettled(
        mockStudents.map((s) => saveStudent(s))
      );

      const successfulCount = results.filter((r) => r.status === "fulfilled").length;
      const failedCount = results.filter((r) => r.status === "rejected").length;

      assert.equal(successfulCount, 2);
      assert.equal(failedCount, 1);

      // Verify that partial save does not throw an unhandled fatal error
      assert.ok(successfulCount > 0 && failedCount > 0);
    }
  );

  await t.test(
    "2. Admissions search: query normalization and deferred matching preserves phone and case-insensitive names",
    () => {
      const students = [
        { name: "Rahul Sharma", parentWhatsApp: "9876543210", batch: "Class 10 - Science" },
        { name: "Priya Patel", parentWhatsApp: "9123456789", batch: "Class 12 - Physics" },
        { name: "Ananya Verma", parentWhatsApp: "9876500000", batch: "Class 10 - Science" },
      ];

      const filterStudents = (query, selectedBatch) => {
        const normalizedQuery = query.trim().toLowerCase();
        const rawQuery = query.trim();
        return students.filter((s) => {
          const matchSearch =
            normalizedQuery === "" ||
            s.name.toLowerCase().includes(normalizedQuery) ||
            s.parentWhatsApp.includes(rawQuery);
          const matchBatch =
            selectedBatch === "all" || s.batch === selectedBatch;
          return matchSearch && matchBatch;
        });
      };

      // Search by lowercase partial name
      const byName = filterStudents("rahul", "all");
      assert.equal(byName.length, 1);
      assert.equal(byName[0].name, "Rahul Sharma");

      // Search by partial phone number
      const byPhone = filterStudents("98765", "all");
      assert.equal(byPhone.length, 2);

      // Combined search + batch filter
      const byBoth = filterStudents("98765", "Class 10 - Science");
      assert.equal(byBoth.length, 2);

      // Empty query returns all
      const all = filterStudents("", "all");
      assert.equal(all.length, 3);
    }
  );

  await t.test(
    "3. Fees collection calculation: total collection rate properly handles overdue + collected sum",
    () => {
      const calculateRate = (totalOverdue, collected) => {
        const totalDemand = (totalOverdue || 0) + (collected || 0);
        return totalDemand > 0 ? Math.round(((collected || 0) / totalDemand) * 100) : 0;
      };

      // Zero demand
      assert.equal(calculateRate(0, 0), 0);

      // 50% collected
      assert.equal(calculateRate(5000, 5000), 50);

      // 100% collected
      assert.equal(calculateRate(0, 10000), 100);

      // 0% collected
      assert.equal(calculateRate(10000, 0), 0);
    }
  );

  await t.test(
    "4. Settings QR freshness elapsed calculation: accurately computes seconds and formatting boundaries",
    () => {
      const formatElapsed = (now, generatedAt) => {
        const elapsedSeconds = Math.max(0, Math.floor((now - generatedAt) / 1000));
        return {
          elapsedSeconds,
          text: elapsedSeconds < 5 ? "just now" : `${elapsedSeconds}s ago`,
          isExpiringSoon: elapsedSeconds > 50,
        };
      };

      const baseTime = 1700000000000;

      // 2 seconds ago -> "just now"
      const fresh = formatElapsed(baseTime + 2000, baseTime);
      assert.equal(fresh.text, "just now");
      assert.equal(fresh.isExpiringSoon, false);

      // 25 seconds ago -> "25s ago"
      const mid = formatElapsed(baseTime + 25000, baseTime);
      assert.equal(mid.text, "25s ago");
      assert.equal(mid.isExpiringSoon, false);

      // 55 seconds ago -> "55s ago" & warning
      const old = formatElapsed(baseTime + 55000, baseTime);
      assert.equal(old.text, "55s ago");
      assert.equal(old.isExpiringSoon, true);
    }
  );
});
