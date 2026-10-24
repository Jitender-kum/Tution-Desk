"use client";

import { useState, useEffect } from "react";
import {
  X,
  FileText,
  Layers,
  Calendar,
  Award,
  Loader2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { apiClient, CURRENT_CENTER_ID } from "@/lib/apiClient";
import { TestRecord, BatchRecord } from "@/types";

interface CreateTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newTest: TestRecord) => void;
  availableBatches?: string[];
}

const PRESET_MARKS = [20, 25, 40, 50, 100];
const TITLE_SUGGESTIONS = [
  "Weekly Unit Test",
  "Chapter Quiz",
  "Mid-Term Exam",
  "Term 1 Final Mock",
];

export default function CreateTestModal({
  isOpen,
  onClose,
  onSuccess,
  availableBatches = [],
}: CreateTestModalProps) {
  const [title, setTitle] = useState("");
  const [batch, setBatch] = useState("");
  const [date, setDate] = useState("");
  const [maxMarks, setMaxMarks] = useState<number | string>(50);

  // Batches state
  const [fetchedBatches, setFetchedBatches] = useState<string[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch batches on open
  useEffect(() => {
    async function loadBatches() {
      if (!isOpen) return;
      try {
        setLoadingBatches(true);
        const res = await apiClient<BatchRecord[]>("/batches", {
          params: { centerId: CURRENT_CENTER_ID },
        });
        if (res.data && res.data.length > 0) {
          const names = res.data.map((b) => b.name);
          setFetchedBatches(names);
          if (!batch) {
            setBatch(names[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load batches:", err);
      } finally {
        setLoadingBatches(false);
      }
    }

    loadBatches();
    setDate(new Date().toISOString().split("T")[0]);
  }, [isOpen]);

  const allBatchOptions = Array.from(
    new Set([...fetchedBatches, ...availableBatches])
  );

  useEffect(() => {
    if (!batch && allBatchOptions.length > 0) {
      setBatch(allBatchOptions[0]);
    }
  }, [allBatchOptions, batch]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanTitle = title.trim();
    const cleanBatch = batch.trim();
    const parsedMax = Number(maxMarks);

    if (!cleanTitle) {
      setError("Please enter a test title.");
      return;
    }

    if (!cleanBatch) {
      setError("Please select a target batch for this test.");
      return;
    }

    if (isNaN(parsedMax) || parsedMax <= 0) {
      setError("Maximum marks must be greater than 0.");
      return;
    }

    setLoading(true);

    try {
      const res = await apiClient<TestRecord>("/tests", {
        method: "POST",
        body: {
          centerId: CURRENT_CENTER_ID,
          title: cleanTitle,
          batch: cleanBatch,
          date: date || new Date().toISOString(),
          maxMarks: parsedMax,
          results: [],
        },
      });

      onSuccess(res.data);
      setTitle("");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create test.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden my-6">
        {/* Accent Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-500" />

        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/25 ring-2 ring-indigo-100">
              <FileText className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                Create New Test
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Schedule a test, quiz or exam for your batch
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2.5 text-xs animate-shake">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <span className="font-semibold leading-tight">{error}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Field 1: Test Title */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Test Title <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <FileText className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Science Chapter 3 - Electricity"
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all"
              />
            </div>

            {/* Title Suggestions */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-[10px] text-slate-400 font-medium">Quick:</span>
              {TITLE_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setTitle(sug)}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[10px] font-semibold transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {/* Field 2: Target Batch */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="test-batch-select"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600"
              >
                Target Batch <span className="text-rose-500">*</span>
              </label>
              {loadingBatches && (
                <span className="text-[10px] text-indigo-600 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading...
                </span>
              )}
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Layers className="w-4 h-4" />
              </div>
              <select
                id="test-batch-select"
                value={batch}
                onChange={(e) => {
                  setBatch(e.target.value);
                  if (error) setError(null);
                }}
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-8 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all cursor-pointer"
              >
                {allBatchOptions.length === 0 ? (
                  <option value="" disabled>
                    No batches available
                  </option>
                ) : (
                  allBatchOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Row: Date & Max Marks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Field 3: Date */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Date <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Calendar className="w-4 h-4" />
                </div>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-2 text-sm font-semibold text-slate-800 focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>
            </div>

            {/* Field 4: Max Marks */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Max Marks <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Award className="w-4 h-4" />
                </div>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={maxMarks}
                  onChange={(e) => setMaxMarks(e.target.value)}
                  placeholder="50"
                  required
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-2 text-sm font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all text-center"
                />
              </div>
            </div>
          </div>

          {/* Quick Marks Selection */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-slate-400 font-medium">Standard marks:</span>
            {PRESET_MARKS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMaxMarks(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                  Number(maxMarks) === m
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="tap-bounce flex-1 h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={loading}
              className="tap-bounce flex-1 h-11 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Create Test</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
