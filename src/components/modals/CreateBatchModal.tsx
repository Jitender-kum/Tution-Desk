"use client";

import { useState } from "react";
import {
  X,
  Layers,
  BookOpen,
  Clock,
  Loader2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { apiClient, CURRENT_CENTER_ID } from "@/lib/apiClient";
import { BatchRecord } from "@/types";

interface CreateBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (batch: BatchRecord) => void;
}

const QUICK_SUGGESTIONS = [
  "Class 10 - Science",
  "Class 10 - Mathematics",
  "Class 9 - Foundation",
  "Class 12 - Physics",
  "Class 11 - Chemistry",
];

const QUICK_TIMINGS = [
  "4:00 PM - 5:30 PM (Mon, Wed, Fri)",
  "5:30 PM - 7:00 PM (Tue, Thu, Sat)",
  "6:00 PM - 7:30 PM (Daily)",
  "9:00 AM - 11:00 AM (Weekend)",
];

export default function CreateBatchModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateBatchModalProps) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [timing, setTiming] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setError("Please enter a batch name.");
      return;
    }

    setLoading(true);

    try {
      const res = await apiClient<BatchRecord>("/batches", {
        method: "POST",
        body: {
          centerId: CURRENT_CENTER_ID,
          name: cleanName,
          subject: subject.trim() || undefined,
          timing: timing.trim() || undefined,
        },
      });

      onSuccess(res.data);
      setName("");
      setSubject("");
      setTiming("");
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to create batch.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden my-6">
        {/* Accent Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500" />

        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/25 ring-2 ring-indigo-100">
              <Layers className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                Create New Batch
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Organize class schedules and student admissions
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Field 1: Batch Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Batch Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Layers className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Class 10 - Science"
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all"
              />
            </div>

            {/* Quick Suggestions */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-[10px] text-slate-400 font-medium">Quick:</span>
              {QUICK_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setName(sug)}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[10px] font-semibold transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {/* Field 2: Subject */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Subject(s) <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <BookOpen className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Science & Physics, Mathematics"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all"
              />
            </div>
          </div>

          {/* Field 3: Timings */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Class Timings <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Clock className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={timing}
                onChange={(e) => setTiming(e.target.value)}
                placeholder="e.g. 4:00 PM - 5:30 PM (Mon, Wed, Fri)"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all"
              />
            </div>

            {/* Quick Timings */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-[10px] text-slate-400 font-medium">Schedule:</span>
              {QUICK_TIMINGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTiming(t)}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium transition-colors"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
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
                  <span>Create Batch</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
