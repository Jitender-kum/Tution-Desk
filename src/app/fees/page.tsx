"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import TopHeader from "@/components/layout/TopHeader";
import FeesSummaryHeroCard from "@/components/fees/FeesSummaryHeroCard";
import GlobalReminderButton from "@/components/fees/GlobalReminderButton";
import OverdueStudentItem from "@/components/fees/OverdueStudentItem";
import { apiClient, CURRENT_CENTER_ID } from "@/lib/apiClient";
import { OverdueFeeStudent } from "@/types";
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  IndianRupee,
  ShieldCheck,
  Clock,
  Sparkles,
} from "lucide-react";

interface ApiStudentRef {
  _id: string;
  name: string;
  batch?: string;
  parentWhatsApp?: string;
}

interface ApiFee {
  _id: string;
  centerId: string;
  studentId: ApiStudentRef | string;
  month: string;
  title?: string;
  amountDue: number;
  paidAmount?: number;
  dueDate: string;
  status: "Pending" | "Paid" | "Verification Pending" | "Partial Paid";
  utrNumber?: string;
  paymentMode?: string;
  paidDate?: string;
  paidAt?: string;
  receiptNumber?: string;
  createdAt?: string;
}

type FeeTab = "pending" | "review" | "paid";

const AVATAR_COLORS = [
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-purple-100 text-purple-700 border-purple-200",
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function calculateDaysLate(dueDateString?: string): number {
  if (!dueDateString) return 0;
  const due = new Date(dueDateString);
  const now = new Date();
  const dueMidnight = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate()
  );
  const nowMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const diffTime = nowMidnight.getTime() - dueMidnight.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

function mapFeeToStudent(fee: ApiFee, idx: number): OverdueFeeStudent {
  const studentObj =
    typeof fee.studentId === "object" && fee.studentId !== null
      ? fee.studentId
      : null;

  const studentName = studentObj?.name || "Student";
  const batchName = studentObj?.batch || "General Batch";
  const parentPhone = studentObj?.parentWhatsApp || "9876543210";
  const daysLate = calculateDaysLate(fee.dueDate);

  return {
    id: fee._id,
    name: studentName,
    batchName: `${batchName} • ${fee.title || fee.month}`,
    title: fee.title || fee.month,
    month: fee.month,
    pendingAmount: Number(fee.amountDue) || 0,
    daysLate: daysLate,
    parentName: `Parent of ${studentName}`,
    parentPhone: parentPhone,
    dueDate: fee.dueDate
      ? new Date(fee.dueDate).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "Due Soon",
    paidDate: fee.paidDate
      ? new Date(fee.paidDate).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : undefined,
    avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    initials: getInitials(studentName),
    status: fee.status,
    utrNumber: fee.utrNumber,
    paymentMode: fee.paymentMode,
    receiptNumber: fee.receiptNumber,
    paidAt: fee.paidAt,
  };
}

export default function FeesPage() {
  // Tab Navigation State
  const [activeTab, setActiveTab] = useState<FeeTab>("pending");

  // Data lists strictly separated by status
  const [pendingStudents, setPendingStudents] = useState<OverdueFeeStudent[]>([]);
  const [reviewStudents, setReviewStudents] = useState<OverdueFeeStudent[]>([]);
  const [paidStudents, setPaidStudents] = useState<OverdueFeeStudent[]>([]);
  const [collectedAmount, setCollectedAmount] = useState<number>(0);

  // Sub-filter for Pending Dues tab
  const [pendingFilter, setPendingFilter] = useState<"all" | "critical" | "moderate">("all");

  // Reminder & Action States
  const [sentReminders, setSentReminders] = useState<Record<string, boolean>>({});
  const [isGlobalSent, setIsGlobalSent] = useState(false);
  const [isSendingBulk, setIsSendingBulk] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch fee data strictly separated by status
  const fetchFeesData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingRes, reviewRes, paidRes] = await Promise.allSettled([
        apiClient<ApiFee[]>("/fees", {
          params: { centerId: CURRENT_CENTER_ID, status: "Pending" },
        }),
        apiClient<ApiFee[]>("/fees", {
          params: { centerId: CURRENT_CENTER_ID, status: "Verification Pending" },
        }),
        apiClient<ApiFee[]>("/fees", {
          params: { centerId: CURRENT_CENTER_ID, status: "Paid" },
        }),
      ]);

      // 1. Pending Dues (Strictly status === 'Pending')
      if (pendingRes.status === "fulfilled" && pendingRes.value.success && Array.isArray(pendingRes.value.data)) {
        setPendingStudents(pendingRes.value.data.map(mapFeeToStudent));
      } else {
        setPendingStudents([]);
      }

      // 2. Awaiting Review (Strictly status === 'Verification Pending')
      if (reviewRes.status === "fulfilled" && reviewRes.value.success && Array.isArray(reviewRes.value.data)) {
        setReviewStudents(reviewRes.value.data.map(mapFeeToStudent));
      } else {
        setReviewStudents([]);
      }

      // 3. Paid History (Strictly status === 'Paid')
      if (paidRes.status === "fulfilled" && paidRes.value.success && Array.isArray(paidRes.value.data)) {
        const rawPaid = paidRes.value.data;
        setPaidStudents(rawPaid.map(mapFeeToStudent));

        const totalPaid = rawPaid.reduce(
          (sum, f) => sum + (Number(f.paidAmount || f.amountDue) || 0),
          0
        );
        setCollectedAmount(totalPaid);
      } else {
        setPaidStudents([]);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load fee records";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeesData();
  }, [fetchFeesData]);

  // TASK 1: Ensure TOTAL OVERDUE sum calculation ONLY includes fees where status === 'Pending'.
  // Verification Pending and Advance Payments are strictly excluded!
  const totalOverdue = useMemo(() => {
    return pendingStudents.reduce(
      (acc, curr) => acc + (curr?.pendingAmount || 0),
      0
    );
  }, [pendingStudents]);

  // Sub-filtering within Pending Dues tab
  const filteredPendingStudents = useMemo(() => {
    return pendingStudents.filter((std) => {
      if (pendingFilter === "critical") return std.daysLate >= 7;
      if (pendingFilter === "moderate") return std.daysLate < 7;
      return true;
    });
  }, [pendingStudents, pendingFilter]);

  const criticalCount = useMemo(() => {
    return pendingStudents.filter((s) => s.daysLate >= 7).length;
  }, [pendingStudents]);

  const moderateCount = useMemo(() => {
    return pendingStudents.filter((s) => s.daysLate < 7).length;
  }, [pendingStudents]);

  // Trigger individual WhatsApp reminder (Pending tab)
  const handleSendIndividual = (student: OverdueFeeStudent) => {
    if (!student) return;

    setSentReminders((prev) => ({
      ...prev,
      [student.id]: true,
    }));

    setToastMessage(
      `WhatsApp UPI payment link sent to ${student.name}'s parent (${student.parentPhone})!`
    );

    setTimeout(() => {
      setToastMessage(null), 4000;
    });
  };

  // Trigger global WhatsApp reminder to all pending students
  const handleSendAll = async () => {
    if (pendingStudents.length === 0) return;
    setIsSendingBulk(true);

    try {
      const res = await apiClient<{ sentCount: number }>("/fees/remind-all", {
        method: "POST",
      });

      setIsGlobalSent(true);
      const updated: Record<string, boolean> = {};
      pendingStudents.forEach((s) => {
        if (s?.id) {
          updated[s.id] = true;
        }
      });
      setSentReminders(updated);

      const count = res.data?.sentCount ?? pendingStudents.length;
      setToastMessage(
        `Sent ${count} WhatsApp fee reminders successfully with VIP portal links!`
      );
      setTimeout(() => setToastMessage(null), 4500);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to send reminders";
      alert(msg);
    } finally {
      setIsSendingBulk(false);
    }
  };

  // Handle Mark as Paid (Cash for Pending dues)
  const handleMarkPaid = async (student: OverdueFeeStudent) => {
    if (!student) return;

    const confirmed = window.confirm(
      `Confirm marking fee of ₹${student.pendingAmount.toLocaleString("en-IN")} for ${student.name} as Paid via Cash? This will generate an official receipt number.`
    );
    if (!confirmed) return;

    setMarkingPaidId(student.id);
    try {
      const res = await apiClient<{ receiptNumber?: string }>(`/fees/${student.id}`, {
        method: "PUT",
        body: { status: "Paid", paymentMode: "Cash" },
      });

      const receiptNum = res.data?.receiptNumber;
      const rcptText = receiptNum ? ` (Receipt: ${receiptNum})` : "";
      setToastMessage(
        `Fee of ₹${student.pendingAmount.toLocaleString("en-IN")} for ${student.name} marked as Paid via Cash!${rcptText}`
      );
      setTimeout(() => setToastMessage(null), 4500);

      await fetchFeesData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to mark fee as paid";
      alert(msg);
    } finally {
      setMarkingPaidId(null);
    }
  };

  // Handle Approve & Mark Paid (Awaiting Review tab)
  const handleApprovePayment = async (student: OverdueFeeStudent) => {
    if (!student) return;

    const confirmed = window.confirm(
      `Check your bank statement: Confirm receipt of ₹${student.pendingAmount.toLocaleString("en-IN")} (UTR: ${student.utrNumber || "N/A"}) for ${student.name} and approve payment?`
    );
    if (!confirmed) return;

    setApprovingId(student.id);
    try {
      await apiClient(`/fees/${student.id}`, {
        method: "PUT",
        body: { paymentMode: "Online/UPI" },
      });

      setToastMessage(
        `Payment approved! Fee of ₹${student.pendingAmount.toLocaleString("en-IN")} for ${student.name} moved to Paid History.`
      );
      setTimeout(() => setToastMessage(null), 4000);

      await fetchFeesData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to approve fee payment";
      alert(msg);
    } finally {
      setApprovingId(null);
    }
  };

  // Handle Reject & Delete (Awaiting Review tab)
  const handleRejectPayment = async (student: OverdueFeeStudent) => {
    if (!student) return;

    const confirmed = window.confirm(
      `Reject & Delete: Are you sure you want to completely remove this fee submission for ${student.name} (Amount: ₹${student.pendingAmount.toLocaleString("en-IN")}, UTR: ${student.utrNumber || "N/A"})? This will clear it from your dashboard and the parent's portal.`
    );
    if (!confirmed) return;

    setRejectingId(student.id);
    try {
      await apiClient(`/fees/${student.id}`, {
        method: "DELETE",
      });

      setToastMessage(
        `Submission rejected and deleted for ${student.name}.`
      );
      setTimeout(() => setToastMessage(null), 4000);

      await fetchFeesData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to reject and delete fee";
      alert(msg);
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <div className="flex flex-col min-h-full relative">
      {/* Top Header */}
      <TopHeader
        title="Fee Management"
        subtitle="Pending Dues, Reviews & Paid History"
        badgeText={
          reviewStudents.length > 0
            ? `${reviewStudents.length} Review`
            : `${pendingStudents.length} Due`
        }
      />

      {/* Floating Toast Notification */}
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

      {/* Main Content Area */}
      <div className="p-4 space-y-4 pb-24">
        {/* Error Alert */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-3 shadow-sm">
            <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <p className="font-bold">Backend Connection Issue</p>
              <p className="mt-0.5 text-rose-700">{error}</p>
              <button
                onClick={fetchFeesData}
                className="mt-2 font-bold underline text-rose-900 hover:text-rose-950"
              >
                Click here to retry
              </button>
            </div>
          </div>
        )}

        {/* TASK 2: Clear 3-Tab Structure */}
        <div className="p-1 rounded-2xl bg-slate-100 border border-slate-200/80 grid grid-cols-3 gap-1">
          {/* Tab 1: Pending Dues */}
          <button
            type="button"
            onClick={() => setActiveTab("pending")}
            className={`tap-bounce py-2.5 px-1 sm:px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
              activeTab === "pending"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Clock className={`h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 ${activeTab === "pending" ? "text-rose-600" : "text-slate-400"}`} />
            <span className="truncate sm:hidden">Pending</span>
            <span className="truncate hidden sm:inline">Pending Dues</span>
            <span
              className={`px-1 sm:px-1.5 py-0.2 rounded-full text-[10px] font-extrabold flex-shrink-0 ${
                activeTab === "pending"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {pendingStudents.length}
            </span>
          </button>

          {/* Tab 2: Awaiting Review */}
          <button
            type="button"
            onClick={() => setActiveTab("review")}
            className={`tap-bounce py-2.5 px-1 sm:px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
              activeTab === "review"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className={`h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 ${activeTab === "review" ? "text-amber-600" : "text-slate-400"}`} />
            <span className="truncate sm:hidden">Review</span>
            <span className="truncate hidden sm:inline">Awaiting Review</span>
            <span
              className={`px-1 sm:px-1.5 py-0.2 rounded-full text-[10px] font-extrabold flex-shrink-0 ${
                reviewStudents.length > 0
                  ? "bg-amber-500 text-white animate-pulse"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {reviewStudents.length}
            </span>
          </button>

          {/* Tab 3: Paid History */}
          <button
            type="button"
            onClick={() => setActiveTab("paid")}
            className={`tap-bounce py-2.5 px-1 sm:px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
              activeTab === "paid"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <CheckCircle2 className={`h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 ${activeTab === "paid" ? "text-emerald-600" : "text-slate-400"}`} />
            <span className="truncate sm:hidden">Paid</span>
            <span className="truncate hidden sm:inline">Paid History</span>
            <span
              className={`px-1 sm:px-1.5 py-0.2 rounded-full text-[10px] font-extrabold flex-shrink-0 ${
                activeTab === "paid"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {paidStudents.length}
            </span>
          </button>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-44 rounded-3xl bg-slate-200/80 p-5 flex flex-col justify-between" />
            <div className="h-12 w-full rounded-2xl bg-slate-200" />
            <div className="h-20 rounded-2xl border border-slate-100 bg-white p-3.5" />
          </div>
        ) : (
          <>
            {/* ========================================================= */}
            {/* TAB 1: PENDING DUES                                       */}
            {/* Red hero card & WhatsApp button ONLY in this tab!        */}
            {/* ========================================================= */}
            {activeTab === "pending" && (
              <div className="space-y-4 animate-fade-in">
                {/* 1. Red Overdue Hero Card (ONLY Pending status) */}
                <FeesSummaryHeroCard
                  totalOverdueAmount={totalOverdue}
                  pendingStudentsCount={pendingStudents.length}
                  collectedAmount={collectedAmount}
                />

                {/* 2. Bulk WhatsApp Reminder Button */}
                <GlobalReminderButton
                  pendingCount={pendingStudents.length}
                  onSendAll={handleSendAll}
                  isSent={isGlobalSent}
                  isSending={isSendingBulk}
                />

                {/* 3. Sub-filter Chips for Pending Dues */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                    <button
                      type="button"
                      onClick={() => setPendingFilter("all")}
                      className={`tap-bounce rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                        pendingFilter === "all"
                          ? "bg-slate-900 text-white shadow-xs"
                          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      All ({pendingStudents.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setPendingFilter("critical")}
                      className={`tap-bounce rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                        pendingFilter === "critical"
                          ? "bg-rose-600 text-white shadow-xs"
                          : "bg-rose-50 text-rose-700 border border-rose-200/80 hover:bg-rose-100"
                      }`}
                    >
                      Critical &gt;7 Days ({criticalCount})
                    </button>

                    <button
                      type="button"
                      onClick={() => setPendingFilter("moderate")}
                      className={`tap-bounce rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                        pendingFilter === "moderate"
                          ? "bg-amber-600 text-white shadow-xs"
                          : "bg-amber-50 text-amber-800 border border-amber-200/80 hover:bg-amber-100"
                      }`}
                    >
                      &lt;7 Days ({moderateCount})
                    </button>
                  </div>

                  <button
                    onClick={fetchFeesData}
                    className="tap-bounce text-slate-400 hover:text-slate-600 p-1"
                    title="Reload fees"
                    aria-label="Reload fees"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 4. Pending List Header */}
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-[14px] font-bold text-slate-900 tracking-tight">
                    Pending Students ({filteredPendingStudents.length})
                  </h2>
                  <span className="text-[11px] font-semibold text-slate-400">
                    Tap green icon to remind
                  </span>
                </div>

                {/* 5. Pending Students List */}
                <div className="space-y-2.5">
                  {filteredPendingStudents.length > 0 ? (
                    filteredPendingStudents.map((student) => (
                      <OverdueStudentItem
                        key={student.id}
                        student={student}
                        tabType="pending"
                        onSendReminder={handleSendIndividual}
                        isReminderSent={Boolean(sentReminders[student.id])}
                        onMarkPaid={handleMarkPaid}
                        isMarkingPaid={markingPaidId === student.id}
                      />
                    ))
                  ) : (
                    <div className="rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xs">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center mb-2">
                        <IndianRupee className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-bold text-slate-800">
                        No pending fees found!
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        All students in this category have cleared their dues.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================= */}
            {/* TAB 2: AWAITING REVIEW (Incoming Payments to Verify)      */}
            {/* Advance payments & UTR claims with Approve & Mark Paid    */}
            {/* ========================================================= */}
            {activeTab === "review" && (
              <div className="space-y-4 animate-fade-in">
                {/* Distinct Header: Incoming Payments to Verify */}
                <div className="rounded-3xl border border-amber-300 bg-gradient-to-br from-amber-500/10 via-amber-50 to-orange-50/60 p-5 shadow-xs">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/25">
                        <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
                      </div>
                      <div>
                        <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                          Incoming Payments to Verify
                        </h2>
                        <p className="text-xs text-slate-600 font-medium mt-0.5">
                          Review parent UTR submissions and advance payments before marking paid
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        {reviewStudents.length} {reviewStudents.length === 1 ? "Payment" : "Payments"} Awaiting Approval
                      </span>
                      <button
                        onClick={fetchFeesData}
                        className="tap-bounce text-slate-400 hover:text-slate-600 p-1"
                        title="Reload verifications"
                        aria-label="Reload verifications"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Review Students List */}
                <div className="space-y-2.5">
                  {reviewStudents.length > 0 ? (
                    reviewStudents.map((student) => (
                      <OverdueStudentItem
                        key={student.id}
                        student={student}
                        tabType="review"
                        onVerifyPaid={handleApprovePayment}
                        isVerifyingPaid={approvingId === student.id}
                        onRejectFee={handleRejectPayment}
                        isRejectingFee={rejectingId === student.id}
                      />
                    ))
                  ) : (
                    <div className="rounded-3xl border border-slate-100 bg-white p-10 text-center shadow-xs">
                      <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center mb-3">
                        <ShieldCheck className="w-6 h-6 stroke-[2.2]" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-800">
                        All Clear! No Payments Awaiting Review
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                        When parents submit UTR transaction numbers or advance fee payments via their VIP portal, they will appear here for you to verify against your bank statement.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================= */}
            {/* TAB 3: PAID HISTORY                                       */}
            {/* Completed & Settled fees records                         */}
            {/* ========================================================= */}
            {activeTab === "paid" && (
              <div className="space-y-4 animate-fade-in">
                {/* Distinct Header: Paid Fee History */}
                <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-500/10 via-emerald-50 to-teal-50/60 p-5 shadow-xs">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/25">
                        <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
                      </div>
                      <div>
                        <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                          Paid Fee History
                        </h2>
                        <p className="text-xs text-slate-600 font-medium mt-0.5">
                          Total Collection: <span className="font-bold text-emerald-800 font-mono">₹{collectedAmount.toLocaleString("en-IN")}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        {paidStudents.length} Records Cleared
                      </span>
                      <button
                        onClick={fetchFeesData}
                        className="tap-bounce text-slate-400 hover:text-slate-600 p-1"
                        title="Reload history"
                        aria-label="Reload history"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Paid Students List */}
                <div className="space-y-2.5">
                  {paidStudents.length > 0 ? (
                    paidStudents.map((student) => (
                      <OverdueStudentItem
                        key={student.id}
                        student={student}
                        tabType="paid"
                      />
                    ))
                  ) : (
                    <div className="rounded-3xl border border-slate-100 bg-white p-10 text-center shadow-xs">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
                        <IndianRupee className="w-6 h-6" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-800">
                        No Paid Fee Records Yet
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                        Fees marked as paid or approved from the review queue will appear here.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
