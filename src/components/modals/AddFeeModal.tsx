"use client";

import { useState, useEffect } from "react";
import {
  X,
  IndianRupee,
  Calendar,
  User,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { apiClient, getCurrentCenterId } from "@/lib/apiClient";

interface AddFeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface StudentOption {
  _id: string;
  name: string;
  batch: string;
}

function getCanonicalBillingMonth(monthStr: string, dueDateStr: string): string {
  const trimmed = monthStr.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = Date.parse(trimmed + " 1");
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (dueDateStr && /^\d{4}-\d{2}/.test(dueDateStr)) {
    return dueDateStr.slice(0, 7);
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function AddFeeModal({
  isOpen,
  onClose,
  onSuccess,
}: AddFeeModalProps) {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const [studentId, setStudentId] = useState("");
  const [feeType, setFeeType] = useState<"monthly_recurring" | "adhoc" | "registration">("monthly_recurring");
  const [title, setTitle] = useState("");
  const [month, setMonth] = useState("November 2026");
  const [amountDue, setAmountDue] = useState("1500");
  const [dueDate, setDueDate] = useState("2026-11-10");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState(false);

  // Reset form helper
  const resetForm = () => {
    setFeeType("monthly_recurring");
    setTitle("");
    setMonth("November 2026");
    setAmountDue("1500");
    setDueDate("2026-11-10");
    setError(null);
  };

  // Fetch real students list on mount/open
  useEffect(() => {
    if (!isOpen) return;

    async function loadStudents() {
      setLoadingStudents(true);
      setError(null);
      try {
        const res = await apiClient<StudentOption[]>("/students", {
          params: { centerId: getCurrentCenterId() },
        });

        const list = res.data || [];
        setStudents(list);

        if (list.length > 0 && !studentId) {
          setStudentId(list[0]._id);
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to load students.";
        setError(msg);
      } finally {
        setLoadingStudents(false);
      }
    }

    loadStudents();
  }, [isOpen, studentId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!studentId) {
      setError("Please select a student.");
      return;
    }

    const cleanMonth = month.trim();
    if (!cleanMonth) {
      setError("Please specify the fee month / label.");
      return;
    }

    const numAmount = Number(amountDue);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid amount greater than ₹0.");
      return;
    }

    if (!dueDate) {
      setError("Please choose a payment due date.");
      return;
    }

    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        centerId: getCurrentCenterId(),
        studentId,
        feeType,
        month: cleanMonth,
        amountDue: numAmount,
        dueDate: new Date(dueDate).toISOString(),
        status: "Pending",
      };

      if (feeType === "monthly_recurring") {
        payload.billingMonth = getCanonicalBillingMonth(cleanMonth, dueDate);
      } else {
        payload.title = title.trim() || (feeType === "registration" ? "Registration Fee" : "Ad-hoc Fee");
      }

      const res = await apiClient("/fees", {
        method: "POST",
        body: payload,
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to generate fee record.");
      }

      setSuccessToast(true);

      setTimeout(() => {
        setSuccessToast(false);
        resetForm();
        onClose();
        if (onSuccess) {
          onSuccess();
        } else {
          window.location.reload();
        }
      }, 1000);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to generate fee.";
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fade-in overflow-y-auto">
      {/* Modal Container */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xl w-full max-w-sm relative transition-all max-h-[calc(100dvh-2rem)] overflow-y-auto my-auto">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <IndianRupee className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight leading-snug">
                Generate Fee Due
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                Create new monthly invoice
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
              Fee record created successfully! Refreshing...
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
          {/* Select Student */}
          <div>
            <label
              htmlFor="fee-student"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Select Student
            </label>

            {loadingStudents ? (
              <div className="h-10 rounded-2xl bg-slate-100 flex items-center px-3.5 text-xs text-slate-400 gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <span>Loading students...</span>
              </div>
            ) : students.length > 0 ? (
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="h-4 w-4" />
                </div>
                <select
                  id="fee-student"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all cursor-pointer"
                >
                  {students.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name} ({s.batch})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                No students enrolled yet. Please add a student first!
              </div>
            )}
          </div>

          {/* Fee Type Selection */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Fee Type
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setFeeType("monthly_recurring")}
                className={`py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all text-center ${
                  feeType === "monthly_recurring"
                    ? "bg-white text-blue-600 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setFeeType("adhoc")}
                className={`py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all text-center ${
                  feeType === "adhoc"
                    ? "bg-white text-blue-600 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Ad-hoc
              </button>
              <button
                type="button"
                onClick={() => setFeeType("registration")}
                className={`py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all text-center ${
                  feeType === "registration"
                    ? "bg-white text-blue-600 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Registration
              </button>
            </div>
          </div>

          {/* Title (for Ad-hoc or Registration) */}
          {feeType !== "monthly_recurring" && (
            <div>
              <label
                htmlFor="fee-title"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Fee Description / Purpose
              </label>
              <input
                id="fee-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={feeType === "registration" ? "e.g. Admission Fee" : "e.g. Study Material / Exam Fee"}
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              />
            </div>
          )}

          {/* Month */}
          <div>
            <label
              htmlFor="fee-month"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              {feeType === "monthly_recurring" ? "Billing Cycle Month" : "Billing Month Reference"}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Calendar className="h-4 w-4" />
              </div>
              <input
                id="fee-month"
                type="text"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="e.g. November 2026"
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>

          {/* Amount Due */}
          <div>
            <label
              htmlFor="fee-amount"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Amount Due (₹)
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-bold text-xs">
                <span>₹</span>
              </div>
              <input
                id="fee-amount"
                type="number"
                value={amountDue}
                onChange={(e) => setAmountDue(e.target.value)}
                placeholder="1500"
                min="1"
                step="50"
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-8 pr-3.5 py-2.5 text-xs font-bold text-slate-900 font-mono focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label
              htmlFor="fee-due-date"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Payment Due Date
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Clock className="h-4 w-4" />
              </div>
              <input
                id="fee-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="tap-bounce flex-1 h-11 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting || successToast || students.length === 0}
              className="tap-bounce flex-1 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/25 transition-all disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <IndianRupee className="h-4 w-4" />
                  <span>Generate Fee</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
