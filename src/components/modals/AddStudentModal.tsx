"use client";

import { useState } from "react";
import {
  X,
  UserPlus,
  User,
  Users,
  Phone,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { apiClient, CURRENT_CENTER_ID } from "@/lib/apiClient";

interface AddStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const PRESET_BATCHES = [
  "Class 10 - Science",
  "Class 10 - Mathematics",
  "Class 12 - Physics",
  "Class 12 - Chemistry",
  "Class 9 - Science",
  "Class 8 - Foundation",
];

export default function AddStudentModal({
  isOpen,
  onClose,
  onSuccess,
}: AddStudentModalProps) {
  const [name, setName] = useState("");
  const [batch, setBatch] = useState("Class 10 - Science");
  const [customBatch, setCustomBatch] = useState("");
  const [isCustomBatch, setIsCustomBatch] = useState(false);
  const [parentPhone, setParentPhone] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const finalBatch = (isCustomBatch ? customBatch : batch).trim();
    const cleanPhone = parentPhone.trim().replace(/\s+/g, "");

    if (!cleanName) {
      setError("Please enter the student's full name.");
      return;
    }

    if (!finalBatch) {
      setError("Please specify or select a batch.");
      return;
    }

    if (!cleanPhone || cleanPhone.length < 10) {
      setError("Please enter a valid 10-digit Parent WhatsApp number.");
      return;
    }

    setLoading(true);

    try {
      const res = await apiClient("/students", {
        method: "POST",
        body: {
          centerId: CURRENT_CENTER_ID,
          name: cleanName,
          batch: finalBatch,
          parentWhatsApp: cleanPhone,
          isActive: true,
        },
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to create student.");
      }

      setSuccessToast(true);

      setTimeout(() => {
        setSuccessToast(false);
        onClose();
        if (onSuccess) {
          onSuccess();
        } else {
          window.location.reload();
        }
      }, 1200);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to add student.";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fade-in">
      {/* Modal Container */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-2xl w-full max-w-sm relative transition-all">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight leading-snug">
                Enroll New Student
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                Add to center database
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="tap-bounce h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Success Alert */}
        {successToast && (
          <div className="my-4 rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 text-emerald-800 flex items-center gap-2.5 text-xs animate-fade-in">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
            <span className="font-bold">
              Student enrolled successfully! Refreshing...
            </span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="my-4 rounded-2xl bg-rose-50 border border-rose-200 p-3 text-rose-800 flex items-start gap-2.5 text-xs">
            <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <span className="font-semibold">{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 pt-4">
          {/* Student Name */}
          <div>
            <label
              htmlFor="student-name"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Student Full Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <User className="h-4 w-4" />
              </div>
              <input
                id="student-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aarav Patel"
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>

          {/* Batch Selector */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="batch-select"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-500"
              >
                Batch / Class
              </label>
              <button
                type="button"
                onClick={() => setIsCustomBatch(!isCustomBatch)}
                className="text-[10px] font-bold text-blue-600 hover:underline"
              >
                {isCustomBatch ? "Select Preset" : "+ Custom Batch"}
              </button>
            </div>

            {isCustomBatch ? (
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Users className="h-4 w-4" />
                </div>
                <input
                  id="custom-batch"
                  type="text"
                  value={customBatch}
                  onChange={(e) => setCustomBatch(e.target.value)}
                  placeholder="e.g. Class 11 - JEE Advanced"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                />
              </div>
            ) : (
              <select
                id="batch-select"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              >
                {PRESET_BATCHES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Parent WhatsApp */}
          <div>
            <label
              htmlFor="parent-phone"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Parent WhatsApp Number
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-bold text-xs">
                <Phone className="h-3.5 w-3.5 mr-1" />
                <span>+91</span>
              </div>
              <input
                id="parent-phone"
                type="tel"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                placeholder="9876543210"
                maxLength={10}
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-14 pr-3.5 py-2.5 text-xs font-bold text-slate-900 font-mono focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              Used for VIP Parent Portal magic links and fee reminders.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="tap-bounce flex-1 h-11 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={loading || successToast}
              className="tap-bounce flex-1 h-11 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/25 transition-all disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  <span>Add Student</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
