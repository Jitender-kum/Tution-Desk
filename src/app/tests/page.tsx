"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import CreateTestModal from "@/components/modals/CreateTestModal";
import EnterMarksModal from "@/components/modals/EnterMarksModal";
import { apiClient, getCurrentCenterId } from "@/lib/apiClient";
import { TestRecord, BatchRecord } from "@/types";
import {
  FileText,
  Plus,
  Award,
  Layers,
  Calendar,
  CheckCircle2,
  Clock,
  Search,
  Pencil,
  Users,
  Loader2,
  X,
  TrendingUp,
} from "lucide-react";

function formatTestDate(dateStr?: string): string {
  if (!dateStr) return "Recent";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Recent";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function TestsPage() {
  const [tests, setTests] = useState<TestRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatchFilter, setSelectedBatchFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTestForMarks, setSelectedTestForMarks] =
    useState<TestRecord | null>(null);

  // Success Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Fetch tests from backend
  const fetchTests = useCallback(async () => {
    try {
      const res = await apiClient<TestRecord[]>("/tests", {
        params: { centerId: getCurrentCenterId() },
      });
      setTests(res.data || []);
    } catch (err) {
      console.error("Failed to fetch tests:", err);
    }
  }, []);

  // Fetch batches from backend
  const fetchBatches = useCallback(async () => {
    try {
      const res = await apiClient<BatchRecord[]>("/batches", {
        params: { centerId: getCurrentCenterId() },
      });
      setBatches(res.data || []);
    } catch (err) {
      console.error("Failed to fetch batches:", err);
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      await Promise.all([fetchTests(), fetchBatches()]);
      setLoading(false);
    }
    loadData();
  }, [fetchTests, fetchBatches]);

  // Extract all unique batch names
  const allBatchNames = useMemo(() => {
    const set = new Set<string>();
    batches.forEach((b) => set.add(b.name));
    tests.forEach((t) => {
      if (t.batch) set.add(t.batch);
    });
    return Array.from(set);
  }, [batches, tests]);

  // Filtered Tests
  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      const matchBatch =
        selectedBatchFilter === "all" || t.batch === selectedBatchFilter;
      const matchSearch =
        searchQuery.trim() === "" ||
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.batch.toLowerCase().includes(searchQuery.toLowerCase());

      return matchBatch && matchSearch;
    });
  }, [tests, selectedBatchFilter, searchQuery]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalTests = tests.length;
    const evaluatedTests = tests.filter(
      (t) => t.results && t.results.length > 0
    ).length;
    const totalSubmissions = tests.reduce(
      (acc, t) => acc + (t.results?.length || 0),
      0
    );

    return { totalTests, evaluatedTests, totalSubmissions };
  }, [tests]);

  const handleCreateSuccess = (newTest: TestRecord) => {
    fetchTests();
    showToast(`Test "${newTest.title}" scheduled for ${newTest.batch}!`);
  };

  const handleMarksSaved = (updatedTest: TestRecord) => {
    fetchTests();
    showToast(`Marks updated successfully for "${updatedTest.title}"!`);
  };

  return (
    <div className="flex flex-col min-h-full pb-20">

      {/* Floating Success Feedback Toast */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 w-[92%] max-w-sm z-50 animate-bounce">
          <div className="rounded-2xl bg-slate-900 text-white p-3.5 shadow-2xl flex items-center gap-2.5 border border-slate-700">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="flex-1 text-xs font-semibold leading-snug">
              {toastMessage}
            </div>
          </div>
        </div>
      )}

      {/* 2. Main Content Container */}
      <div className="p-4 space-y-4">
        {/* Mobile-first Header Banner */}
        <div className="flex flex-col gap-3.5">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Tests &amp; Marks</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Schedule tests, enter student marks &amp; track progress
            </p>
          </div>

          {/* Primary Action Button */}
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="tap-bounce w-full h-11 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-indigo-600/30 transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>+ Create Test</span>
          </button>
        </div>

        {/* 3. Summary KPI Stat Cards */}
        <div className="grid grid-cols-3 gap-2">
          {/* Card 1: Total Tests */}
          <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Tests
              </span>
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <div className="mt-1">
              <div className="text-lg font-black text-slate-900">
                {metrics.totalTests}
              </div>
              <span className="text-[10px] text-emerald-600 font-semibold">
                Scheduled
              </span>
            </div>
          </div>

          {/* Card 2: Batches */}
          <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Batches
              </span>
              <Layers className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="mt-1">
              <div className="text-lg font-black text-slate-900">
                {allBatchNames.length}
              </div>
              <span className="text-[10px] text-slate-500 font-semibold">
                Active
              </span>
            </div>
          </div>

          {/* Card 3: Evaluated Submissions */}
          <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Evaluated
              </span>
              <Award className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="mt-1">
              <div className="text-lg font-black text-slate-900">
                {metrics.totalSubmissions}
              </div>
              <span className="text-[10px] text-emerald-600 font-semibold">
                Papers
              </span>
            </div>
          </div>
        </div>

        {/* 4. Search & Batch Filter Controls */}
        <div className="space-y-2">
          {/* Search Input */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tests by title or batch..."
              className="w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-9 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 shadow-xs transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Batch Filter Tabs */}
          {allBatchNames.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedBatchFilter("all")}
                className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                  selectedBatchFilter === "all"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                All Batches ({tests.length})
              </button>
              {allBatchNames.map((b) => {
                const count = tests.filter((t) => t.batch === b).length;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setSelectedBatchFilter(b)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                      selectedBatchFilter === b
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {b} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 5. Test Cards List */}
        {loading ? (
          /* Loading Skeleton */
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="p-4 rounded-3xl border border-slate-200 bg-white space-y-3 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="h-4 w-32 bg-slate-200 rounded-md" />
                  <div className="h-4 w-16 bg-slate-200 rounded-md" />
                </div>
                <div className="h-5 w-48 bg-slate-200 rounded-md" />
                <div className="h-10 bg-slate-100 rounded-2xl w-full" />
              </div>
            ))}
          </div>
        ) : filteredTests.length === 0 ? (
          /* Empty State */
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {searchQuery || selectedBatchFilter !== "all"
                  ? "No matching tests found"
                  : "No tests created yet"}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {searchQuery || selectedBatchFilter !== "all"
                  ? "Try resetting your search query or batch filter."
                  : "Schedule weekly quizzes, unit tests, or exams and enter student marks directly."}
              </p>
            </div>

            {searchQuery || selectedBatchFilter !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedBatchFilter("all");
                }}
                className="tap-bounce inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors"
              >
                Reset Filters
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="tap-bounce inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all"
              >
                <Plus className="w-4 h-4 stroke-[2.2]" />
                <span>+ Create First Test</span>
              </button>
            )}
          </div>
        ) : (
          /* Render Real Test Cards */
          <div className="space-y-3">
            {filteredTests.map((test) => {
              const hasResults = test.results && test.results.length > 0;
              const evaluatedCount = test.results?.length || 0;

              // Calculate average marks if evaluated
              const avgScore = hasResults
                ? (
                    test.results!.reduce(
                      (acc, r) => acc + (r.marksObtained || 0),
                      0
                    ) / evaluatedCount
                  ).toFixed(1)
                : null;

              return (
                <div
                  key={test._id}
                  className="p-4 rounded-3xl border border-slate-200/90 bg-white shadow-xs hover:border-indigo-200 transition-all space-y-3"
                >
                  {/* Card Header: Batch & Date */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-bold border border-indigo-100">
                      <Layers className="w-3 h-3" />
                      <span>{test.batch}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>{formatTestDate(test.date)}</span>
                    </span>
                  </div>

                  {/* Test Title & Score Meta */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 leading-snug">
                      {test.title}
                    </h3>

                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                        Max Marks:{" "}
                        <strong className="text-slate-900">
                          {test.maxMarks}
                        </strong>
                      </span>

                      <span className="text-slate-300">•</span>

                      {hasResults ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>
                            {evaluatedCount} Evaluated • Avg: {avgScore}/
                            {test.maxMarks}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span>Marks Pending</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action Button: Enter Marks or Edit Marks */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedTestForMarks(test)}
                      className={`tap-bounce w-full h-10 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                        hasResults
                          ? "bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80"
                          : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25"
                      }`}
                    >
                      {hasResults ? (
                        <>
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit Marks</span>
                        </>
                      ) : (
                        <>
                          <Award className="w-4 h-4 stroke-[2.2]" />
                          <span>Enter Marks</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Action Modals */}
      <CreateTestModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
        availableBatches={allBatchNames}
      />

      <EnterMarksModal
        isOpen={Boolean(selectedTestForMarks)}
        onClose={() => setSelectedTestForMarks(null)}
        onSuccess={handleMarksSaved}
        test={selectedTestForMarks}
      />
    </div>
  );
}
