"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSetHeader } from "@/components/layout/HeaderContext";
import { apiClient, getCurrentCenterId } from "@/lib/apiClient";
import { StudentRecord } from "@/types";
import {
  ArrowLeft,
  Phone,
  MessageCircle,
  Calendar,
  IndianRupee,
  Layers,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  Banknote,
  Receipt,
  Printer,
  X,
  ShieldCheck,
  Clock,
  PlusCircle,
  AlertCircle,
  RefreshCw,
  Building2,
  User,
} from "lucide-react";

export interface StudentFeeItem {
  _id: string;
  centerId: string;
  studentId: any;
  month: string;
  title?: string;
  amountDue: number;
  paidAmount?: number;
  dueDate?: string;
  status: "Pending" | "Paid" | "Verification Pending" | "Partial Paid";
  utrNumber?: string;
  paymentMode?: string;
  receiptNumber?: string;
  isAdvance?: boolean;
  notes?: string;
  paidDate?: string;
  paidAt?: string;
  paymentDate?: string;
  createdAt?: string;
}

interface StudentProfileProps {
  studentId: string;
  onBack?: () => void;
}

function formatCurrency(amount: number): string {
  return "₹" + (amount || 0).toLocaleString("en-IN");
}

function formatDate(dateString?: string | null): string {
  if (!dateString) return "N/A";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(dateString);
  }
}

function getCycleOrdinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function getInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (name || "").slice(0, 2).toUpperCase();
}

export default function StudentProfile({ studentId, onBack }: StudentProfileProps) {
  const router = useRouter();

  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [fees, setFees] = useState<StudentFeeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLedgerTab, setActiveLedgerTab] = useState<"all" | "paid" | "pending">("all");

  // Synchronize student profile header title and badge with persistent TopHeader
  useSetHeader({
    title: student ? `${student.name} • 360° Profile` : "Student Profile",
    subtitle: "Fee Ledger, Academic Attendance & Portal Management",
    badgeText: student?.batch || "Student",
  });

  // Modal 1: Record Cash Payment Form
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [amountInput, setAmountInput] = useState<string>("");
  const [feeType, setFeeType] = useState<"Regular Monthly Fee" | "Advance Payment">(
    "Regular Monthly Fee"
  );
  const [notesInput, setNotesInput] = useState<string>("");
  const [isSubmittingCash, setIsSubmittingCash] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);

  // Modal 2: View Digital Slip Modal
  const [selectedReceiptFee, setSelectedReceiptFee] = useState<StudentFeeItem | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Fetch Student Profile & Fee Ledger
  const fetchStudentData = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);

    try {
      const [studentRes, feesRes] = await Promise.allSettled([
        apiClient<StudentRecord>(`/students/${studentId}`),
        apiClient<StudentFeeItem[]>("/fees", { params: { studentId } }),
      ]);

      if (studentRes.status === "fulfilled" && studentRes.value.success && studentRes.value.data) {
        setStudent(studentRes.value.data);
      } else {
        throw new Error("Failed to load student details");
      }

      if (feesRes.status === "fulfilled" && feesRes.value.success && Array.isArray(feesRes.value.data)) {
        setFees(feesRes.value.data);
      } else {
        setFees([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading student profile";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchStudentData();
  }, [fetchStudentData]);

  // Handle Opening Cash Payment Modal with Monthly Fee prefilled
  const handleOpenCashModal = (type: "Regular Monthly Fee" | "Advance Payment" = "Regular Monthly Fee") => {
    setFeeType(type);
    setAmountInput(student?.monthlyFee ? String(student.monthlyFee) : "");
    setNotesInput("");
    setCashError(null);
    setIsCashModalOpen(true);
  };

  // Submit Manual Cash Payment
  const handleSubmitCashPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amountInput);

    if (isNaN(numAmount) || numAmount <= 0) {
      setCashError("Please enter a valid amount greater than ₹0.");
      return;
    }

    setIsSubmittingCash(true);
    setCashError(null);

    try {
      const res = await apiClient<StudentFeeItem>("/fees/manual-collection", {
        method: "POST",
        body: {
          studentId,
          centerId: student?.centerId || getCurrentCenterId(),
          amount: numAmount,
          type: feeType,
          notes: notesInput.trim(),
        },
      });

      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to record manual cash payment.");
      }

      const newFee = res.data;
      const rcptNum = newFee.receiptNumber || "";

      setToastMessage(
        `Recorded ₹${numAmount} cash payment! (Receipt: ${rcptNum})`
      );
      setTimeout(() => setToastMessage(null), 4500);

      setIsCashModalOpen(false);
      await fetchStudentData();

      // Automatically offer to view the generated receipt slip
      setSelectedReceiptFee(newFee);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record payment";
      setCashError(msg);
    } finally {
      setIsSubmittingCash(false);
    }
  };

  // Ledger Metrics Calculations
  const metrics = useMemo(() => {
    const totalPaid = fees
      .filter((f) => f.status === "Paid")
      .reduce((sum, f) => sum + (Number(f.paidAmount || f.amountDue) || 0), 0);

    const pendingTotal = fees
      .filter((f) => f.status === "Pending" || f.status === "Verification Pending")
      .reduce((sum, f) => sum + (Number(f.amountDue) || 0), 0);

    const advanceCount = fees.filter(
      (f) =>
        f.isAdvance ||
        /advance/i.test(f.title || "") ||
        /advance/i.test(f.month || "")
    ).length;

    return { totalPaid, pendingTotal, advanceCount };
  }, [fees]);

  // Filtered Fees List based on active tab
  const filteredFees = useMemo(() => {
    if (activeLedgerTab === "paid") {
      return fees.filter((f) => f.status === "Paid");
    }
    if (activeLedgerTab === "pending") {
      return fees.filter(
        (f) => f.status === "Pending" || f.status === "Verification Pending"
      );
    }
    return fees;
  }, [fees, activeLedgerTab]);

  return (
    <div className="flex flex-col min-h-full relative bg-slate-50/50 pb-24 w-full max-w-full overflow-x-hidden">

      {/* Floating Success Toast */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 w-[92%] max-w-sm z-50 animate-bounce">
          <div className="rounded-2xl bg-slate-900 text-white p-3.5 shadow-xl flex items-center gap-2.5 border border-slate-700">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="flex-1 text-xs font-semibold leading-snug">
              {toastMessage}
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="w-full max-w-full overflow-x-hidden px-4 space-y-4 max-w-5xl mx-auto">
        {/* Back Link */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (onBack) {
                onBack();
              } else {
                router.push("/admissions");
              }
            }}
            className="tap-bounce inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Admissions</span>
          </button>

          <button
            type="button"
            onClick={fetchStudentData}
            className="tap-bounce inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 p-1.5"
            title="Refresh Ledger"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-xs space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
            <p className="text-xs font-bold text-slate-600">
              Loading 360° student profile and fee ledger...
            </p>
          </div>
        ) : error || !student ? (
          /* Error State */
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center space-y-3 shadow-xs">
            <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
            <div>
              <h3 className="text-sm font-bold text-rose-900">
                Failed to Load Student Profile
              </h3>
              <p className="text-xs text-rose-700 mt-1">{error || "Student not found"}</p>
            </div>
            <button
              type="button"
              onClick={fetchStudentData}
              className="tap-bounce inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white font-bold text-xs shadow-xs"
            >
              Try Again
            </button>
          </div>
        ) : (
          <>
            {/* 1. Header Profile Banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full p-4 sm:p-5 bg-white rounded-2xl shadow-sm border border-slate-200/90">
              {/* Avatar & Core Identity */}
              <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-black text-sm sm:text-base shadow-xs flex-shrink-0">
                  {getInitials(student.name)}
                </div>

                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight truncate">
                      {student.name}
                    </h1>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                        student.isActive !== false
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      {student.isActive !== false ? "Active Student" : "Inactive"}
                    </span>
                    <span className="flex items-center gap-1 text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100 text-xs">
                      <Layers className="w-3 h-3 text-indigo-600" />
                      {student.batch}
                    </span>
                  </div>

                  {/* Group personal details neatly using a flex container with wrapping */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-xs sm:text-sm text-slate-600">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-slate-800 font-semibold">
                        +91 {student.parentWhatsApp}
                      </span>
                      <div className="flex items-center gap-1">
                        <a
                          href={`https://wa.me/91${student.parentWhatsApp}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors"
                          title="Chat on WhatsApp"
                        >
                          <MessageCircle className="w-3 h-3" />
                        </a>
                        <a
                          href={`tel:+91${student.parentWhatsApp}`}
                          className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center transition-colors"
                          title="Call parent"
                        >
                          <Phone className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                    <span className="hidden sm:inline text-slate-300">•</span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      Joined: {formatDate(student.joiningDate)}
                    </span>
                    <span className="hidden sm:inline text-slate-300">•</span>
                    <span className="text-xs text-slate-500">
                      Billing Cycle: {getCycleOrdinal(student.billingCycleDate || 5)} of month
                    </span>
                  </div>
                </div>
              </div>

              {/* Group the action buttons in their own container */}
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto pt-2 md:pt-0">
                <button
                  type="button"
                  onClick={() => handleOpenCashModal("Regular Monthly Fee")}
                  className="tap-bounce flex-1 md:flex-initial min-w-[140px] h-10 px-3 sm:px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25 transition-all cursor-pointer whitespace-nowrap"
                >
                  <Banknote className="w-4 h-4 text-emerald-100 stroke-[2.4]" />
                  <span>Record Cash Payment</span>
                </button>

                <a
                  href={`/p/${student._id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-bounce flex-1 md:flex-initial min-w-[110px] h-10 px-3 sm:px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  title="Open parent-facing VIP mobile portal"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                  <span>Parent Portal</span>
                </a>
              </div>
            </div>

            {/* 2. Top Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Metric 1: Total Collected */}
              <div className="rounded-2xl border border-emerald-100 bg-white p-3.5 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Total Collected
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-emerald-700 mt-0.5">
                  {formatCurrency(metrics.totalPaid)}
                </div>
                <span className="text-[10px] font-semibold text-emerald-600 block mt-0.5">
                  Settled &amp; Archived
                </span>
              </div>

              {/* Metric 2: Pending Dues */}
              <div className="rounded-2xl border border-amber-100 bg-white p-3.5 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Pending Dues
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-amber-700 mt-0.5">
                  {formatCurrency(metrics.pendingTotal)}
                </div>
                <span className="text-[10px] font-semibold text-amber-600 block mt-0.5">
                  {metrics.pendingTotal > 0 ? "Awaiting Payment" : "All Clear"}
                </span>
              </div>

              {/* Metric 3: Monthly Fee Rate */}
              <div className="rounded-2xl border border-blue-100 bg-white p-3.5 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Monthly Rate
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-blue-700 mt-0.5">
                  {formatCurrency(student.monthlyFee || 0)}
                </div>
                <span className="text-[10px] font-semibold text-slate-500 block mt-0.5">
                  Due {getCycleOrdinal(student.billingCycleDate || 5)} monthly
                </span>
              </div>

              {/* Metric 4: Advance Receipts */}
              <div className="rounded-2xl border border-purple-100 bg-white p-3.5 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Advance Receipts
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-purple-700 mt-0.5">
                  {metrics.advanceCount}
                </div>
                <span className="text-[10px] font-semibold text-purple-600 block mt-0.5">
                  Pre-paid Records
                </span>
              </div>
            </div>

            {/* 3. Task 1: 360-Degree Fee & Payment History Ledger */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
              {/* Ledger Header & Tab Navigation */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-emerald-600 stroke-[2.3]" />
                    <span>Fee &amp; Payment History</span>
                  </h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Complete 360° financial ledger for {student.name}
                  </p>
                </div>

                {/* Sub-Tabs */}
                <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setActiveLedgerTab("all")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      activeLedgerTab === "all"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    All ({fees.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveLedgerTab("paid")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      activeLedgerTab === "paid"
                        ? "bg-white text-emerald-700 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Paid ({fees.filter((f) => f.status === "Paid").length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveLedgerTab("pending")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      activeLedgerTab === "pending"
                        ? "bg-white text-amber-700 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Pending ({fees.filter((f) => f.status !== "Paid").length})
                  </button>
                </div>
              </div>

              {/* Ledger Records Table / Cards */}
              {filteredFees.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center space-y-2">
                  <Receipt className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">
                    No fee records found in this category
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Record offline cash collections or review online submissions for this student.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleOpenCashModal()}
                    className="tap-bounce mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-2xs"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Record Cash Payment</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredFees.map((fee) => {
                    const isAdvance = Boolean(
                      fee.isAdvance ||
                        /advance/i.test(fee.title || "") ||
                        /advance/i.test(fee.month || "")
                    );
                    const isCash = Boolean(
                      fee.paymentMode && /cash/i.test(fee.paymentMode)
                    );
                    const isPaid = fee.status === "Paid";
                    const isVerificationPending = fee.status === "Verification Pending";

                    const dateDisplay = formatDate(
                      fee.paidAt || fee.paidDate || fee.paymentDate || fee.dueDate || fee.createdAt
                    );

                    const receiptNo =
                      fee.receiptNumber ||
                      (isCash ? `RCPT-${fee._id.slice(-6).toUpperCase()}` : "");

                    return (
                      <div
                        key={fee._id}
                        className="py-3.5 flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 hover:bg-slate-50/80 px-2 rounded-2xl transition-colors w-full"
                      >
                        {/* Left: Description, Type & Date */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border shadow-2xs ${
                              isPaid
                                ? isCash
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                          >
                            {isCash ? (
                              <Banknote className="w-5 h-5 stroke-[2.2]" />
                            ) : (
                              <IndianRupee className="w-4.5 h-4.5 stroke-[2.4]" />
                            )}
                          </div>

                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-xs font-bold text-slate-900 tracking-tight">
                                {fee.title || fee.month}
                              </h3>

                              {/* Fee Type Badge: Advance vs Regular */}
                              {isAdvance ? (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-2xs">
                                  <Sparkles className="w-3 h-3" />
                                  Advance
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                  Regular Fee
                                </span>
                              )}

                              {/* Payment Mode Badge */}
                              {isCash ? (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300">
                                  <Banknote className="w-3 h-3 text-emerald-700" />
                                  Cash
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                                  Online / UPI
                                </span>
                              )}

                              {/* Status Badge */}
                              <span
                                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold border ${
                                  isPaid
                                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                    : isVerificationPending
                                    ? "bg-amber-100 text-amber-900 border-amber-300 animate-pulse"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                {isPaid ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Clock className="w-3 h-3" />
                                )}
                                {fee.status}
                              </span>
                            </div>

                            {/* Date + Receipt/UTR Meta */}
                            <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500 font-medium break-all">
                              <span>Date: {dateDisplay}</span>

                              {/* Receipt Number */}
                              {receiptNo ? (
                                <>
                                  <span className="text-slate-300">•</span>
                                  <span className="font-mono font-bold text-emerald-900 select-all break-all">
                                    Receipt: {receiptNo}
                                  </span>
                                </>
                              ) : fee.utrNumber ? (
                                <>
                                  <span className="text-slate-300">•</span>
                                  <span className="font-mono text-slate-700 select-all break-all">
                                    UTR: {fee.utrNumber}
                                  </span>
                                </>
                              ) : null}

                              {fee.notes && (
                                <>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-slate-500 italic truncate max-w-xs break-words">
                                    &quot;{fee.notes}&quot;
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Amount & Actions */}
                        <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 w-full sm:w-auto">
                          <div className="text-left sm:text-right">
                            <div className="text-sm font-black font-mono text-slate-900 tracking-tight">
                              {formatCurrency(fee.amountDue)}
                            </div>
                            <span className="text-[10px] text-slate-400 font-semibold block">
                              {isPaid ? "Settled" : "Balance Due"}
                            </span>
                          </div>

                          {/* Task 1.4: View Receipt slip functionality */}
                          {isPaid ? (
                            <button
                              type="button"
                              onClick={() => setSelectedReceiptFee(fee)}
                              className="tap-bounce h-8 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-95 text-slate-800 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                              title="View official digital receipt slip"
                            >
                              <Receipt className="w-3.5 h-3.5 text-emerald-600 stroke-[2.2]" />
                              <span>View Receipt</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenCashModal("Regular Monthly Fee")}
                              className="tap-bounce h-8 px-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1 shadow-2xs"
                              title="Settle due with cash"
                            >
                              <Banknote className="w-3.5 h-3.5 text-emerald-700" />
                              <span>Mark Paid</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: Task 2: Record Cash Payment Modal (Owner Side)    */}
      {/* ========================================================= */}
      {isCashModalOpen && student && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-5 text-white relative">
              <button
                type="button"
                onClick={() => setIsCashModalOpen(false)}
                className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 active:scale-90 flex items-center justify-center text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2 text-emerald-100 text-xs font-bold uppercase tracking-wider">
                <Banknote className="w-4 h-4" />
                Record Cash Collection
              </div>
              <h2 className="text-xl font-black mt-1 tracking-tight text-white">
                {student.name}
              </h2>
              <p className="text-xs text-emerald-100/90 mt-0.5">
                Generate instant verified offline receipt &amp; update ledger
              </p>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitCashPayment} className="p-5 space-y-4">
              {cashError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{cashError}</span>
                </div>
              )}

              {/* Amount Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Amount Collected (₹) *
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 font-bold text-sm">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="e.g. 2000"
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-mono font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>

                {/* Amount Quick Presets */}
                <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                  {student.monthlyFee > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmountInput(String(student.monthlyFee))}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                    >
                      Monthly Rate (₹{student.monthlyFee})
                    </button>
                  )}
                  {[1000, 2000, 3000, 5000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAmountInput(String(amt))}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                    >
                      ₹{amt.toLocaleString("en-IN")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fee Type Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Fee Type *
                </label>
                <select
                  value={feeType}
                  onChange={(e) =>
                    setFeeType(
                      e.target.value as "Regular Monthly Fee" | "Advance Payment"
                    )
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="Regular Monthly Fee">Regular Monthly Fee</option>
                  <option value="Advance Payment">Advance Payment</option>
                </select>
              </div>

              {/* Notes / Remarks */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Notes / Remarks (Optional)
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="e.g. November 2026 tuition fee or Exam prep advance"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder:text-slate-400"
                />
              </div>

              {/* Form Actions */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCashModalOpen(false)}
                  disabled={isSubmittingCash}
                  className="tap-bounce flex-1 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSubmittingCash || !amountInput.trim()}
                  className="tap-bounce flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/25 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingCash ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 stroke-[2.2]" />
                  )}
                  <span>Generate Receipt &amp; Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: Task 1.4: View Digital Receipt Slip Modal         */}
      {/* ========================================================= */}
      {selectedReceiptFee && student && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden relative">
            {/* Slip Top Header */}
            <div className="bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 p-5 text-white relative">
              <button
                type="button"
                onClick={() => setSelectedReceiptFee(null)}
                className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 active:scale-90 flex items-center justify-center text-white transition-all cursor-pointer"
                aria-label="Close receipt modal"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2 text-emerald-100 text-xs font-bold uppercase tracking-wider">
                <Receipt className="w-4 h-4" />
                Official Fee Receipt
              </div>
              <h2 className="text-xl font-black mt-1 tracking-tight text-white">
                Tuition Center Ledger
              </h2>
              <p className="text-xs text-emerald-100/90 mt-0.5">
                Verified Payment Acknowledgement Slip
              </p>
            </div>

            {/* Slip Details Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* Receipt Number & Status */}
              <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-200">
                <div>
                  <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 block">
                    Receipt Number
                  </span>
                  <span className="font-mono font-black text-slate-900 text-sm select-all">
                    {selectedReceiptFee.receiptNumber ||
                      (selectedReceiptFee.paymentMode &&
                      /cash/i.test(selectedReceiptFee.paymentMode)
                        ? `RCPT-${selectedReceiptFee._id.slice(-6).toUpperCase()}`
                        : selectedReceiptFee.utrNumber ||
                          `RCPT-${selectedReceiptFee._id.slice(-6).toUpperCase()}`)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 block">
                    Status
                  </span>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                    <ShieldCheck className="w-3 h-3" />
                    PAID &amp; CLEARED
                  </span>
                </div>
              </div>

              {/* Data Grid */}
              <div className="grid grid-cols-2 gap-3 text-slate-600">
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    Student Name
                  </span>
                  <p className="font-bold text-slate-900 text-xs truncate">
                    {student.name}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Date Paid
                  </span>
                  <p className="font-bold text-slate-900 text-xs">
                    {formatDate(
                      selectedReceiptFee.paidAt ||
                        selectedReceiptFee.paidDate ||
                        selectedReceiptFee.paymentDate ||
                        selectedReceiptFee.createdAt
                    )}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Description
                  </span>
                  <p className="font-bold text-slate-900 text-xs truncate">
                    {selectedReceiptFee.title || selectedReceiptFee.month}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <Building2 className="w-3 h-3" />
                    Payment Mode
                  </span>
                  <p className="font-bold text-slate-900 text-xs flex items-center gap-1">
                    {selectedReceiptFee.paymentMode &&
                    /cash/i.test(selectedReceiptFee.paymentMode) ? (
                      <>
                        <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                        Cash Collection
                      </>
                    ) : (
                      <>
                        <IndianRupee className="w-3.5 h-3.5 text-blue-600" />
                        Online / UPI
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* UTR / Ref Number if Online */}
              {selectedReceiptFee.utrNumber && (
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 font-mono text-xs flex items-center justify-between">
                  <span className="font-sans font-bold text-slate-400 text-[10px] uppercase">
                    Bank UTR Ref:
                  </span>
                  <span className="font-bold text-slate-800 select-all">
                    {selectedReceiptFee.utrNumber}
                  </span>
                </div>
              )}

              {/* Highlighted Amount */}
              <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-center space-y-0.5">
                <span className="text-[10px] uppercase font-extrabold tracking-wider text-emerald-800">
                  Total Amount Received
                </span>
                <div className="text-3xl font-black font-mono text-emerald-900 tracking-tight">
                  {formatCurrency(selectedReceiptFee.amountDue)}
                </div>
                <p className="text-[10px] text-emerald-700 font-medium">
                  Official automated entry from center ledger
                </p>
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="tap-bounce flex-1 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-slate-600" />
                  <span>Print Slip</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedReceiptFee(null)}
                  className="tap-bounce flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Done</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
