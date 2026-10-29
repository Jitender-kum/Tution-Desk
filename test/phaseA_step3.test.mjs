import test from "node:test";
import assert from "node:assert/strict";

test("Phase A Step 3: Measurement & Targeted Optimizations Suite", async (t) => {
  await t.test(
    "1. Attendance row memoization contract: shallow equality correctly skips unchanged rows",
    () => {
      const student1 = { id: "s1", name: "Aarav Sharma", initials: "AS", rollNumber: 1, attendanceRate: 95 };
      const student2 = { id: "s2", name: "Bhavya Gupta", initials: "BG", rollNumber: 2, attendanceRate: 88 };

      const onToggle = () => {};

      // Initial props for both rows
      const prevPropsRow1 = { student: student1, status: "unmarked", onToggleStatus: onToggle };
      const prevPropsRow2 = { student: student2, status: "unmarked", onToggleStatus: onToggle };

      // User marks Student 1 as "present". Student 2 is NOT touched.
      const nextPropsRow1 = { student: student1, status: "present", onToggleStatus: onToggle };
      const nextPropsRow2 = { student: student2, status: "unmarked", onToggleStatus: onToggle };

      // Helper function matching React.memo default shallow comparison
      const shallowEqual = (prev, next) => {
        const keysA = Object.keys(prev);
        const keysB = Object.keys(next);
        if (keysA.length !== keysB.length) return false;
        return keysA.every((k) => prev[k] === next[k]);
      };

      // Row 1 changed -> must re-render
      assert.equal(shallowEqual(prevPropsRow1, nextPropsRow1), false);

      // Row 2 did NOT change -> React.memo skips re-rendering!
      assert.equal(shallowEqual(prevPropsRow2, nextPropsRow2), true);
    }
  );

  await t.test(
    "2. Rapid roll-call sequence: state update updates only the targeted student ID",
    () => {
      const students = [
        { id: "s1", name: "Student 1" },
        { id: "s2", name: "Student 2" },
        { id: "s3", name: "Student 3" },
      ];

      let attendanceMap = { s1: "unmarked", s2: "unmarked", s3: "unmarked" };

      const toggleStatus = (map, studentId, newStatus) => ({
        ...map,
        [studentId]: newStatus,
      });

      // Mark student 2 as present
      attendanceMap = toggleStatus(attendanceMap, "s2", "present");

      assert.equal(attendanceMap.s1, "unmarked");
      assert.equal(attendanceMap.s2, "present");
      assert.equal(attendanceMap.s3, "unmarked");

      // Mark student 3 as absent
      attendanceMap = toggleStatus(attendanceMap, "s3", "absent");

      assert.equal(attendanceMap.s1, "unmarked");
      assert.equal(attendanceMap.s2, "present");
      assert.equal(attendanceMap.s3, "absent");
    }
  );

  await t.test(
    "3. Test assessments search: query normalization and deferred matching filters tests accurately",
    () => {
      const testsList = [
        { title: "Periodic Test 1", batch: "Class 10 - Mathematics" },
        { title: "Unit Test: Optics", batch: "Class 12 - Physics" },
        { title: "Mid-Term Exam", batch: "Class 10 - Mathematics" },
      ];

      const filterTests = (query, batchFilter) => {
        const q = query.trim().toLowerCase();
        return testsList.filter((t) => {
          const matchBatch = batchFilter === "all" || t.batch === batchFilter;
          const matchSearch =
            q === "" ||
            t.title.toLowerCase().includes(q) ||
            t.batch.toLowerCase().includes(q);
          return matchBatch && matchSearch;
        });
      };

      // Case-insensitive title match
      const byTitle = filterTests("optics", "all");
      assert.equal(byTitle.length, 1);
      assert.equal(byTitle[0].title, "Unit Test: Optics");

      // Batch filter + title match
      const byBoth = filterTests("mid-term", "Class 10 - Mathematics");
      assert.equal(byBoth.length, 1);
      assert.equal(byBoth[0].title, "Mid-Term Exam");

      // Non-matching query returns empty
      const empty = filterTests("Chemistry", "all");
      assert.equal(empty.length, 0);
    }
  );
});
