"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSetHeader } from "@/components/layout/HeaderContext";
import FeesSummaryHeroCard from "@/components/fees/FeesSummaryHeroCard";
import GlobalReminderButton from "@/components/fees/GlobalReminderButton";
import OverdueStudentItem from "@/components/fees/OverdueStudentItem";
import { apiClient, getCurrentCenterId, getApiCache } from "@/lib/apiClient";
import { OverdueFeeStudent } from "@/types";
import AddFeeModal from "@/components/modals/AddFeeModal";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  IndianRupee,
  ShieldCheck,
  Clock,
  Loader2,
  Plus,
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

  const rawStudentId =
    typeof fee.studentId === "object" && fee.studentId !== null
      ? fee.studentId._id
      : (fee.studentId as string);

  const studentName = studentObj?.name || "Student";
  const batchName = studentObj?.batch || "General Batch";
  const parentPhone = studentObj?.parentWhatsApp || "9876543210";
  const daysLate = calculateDaysLate(fee.dueDate);

  const paidAmount = Number(fee.paidAmount) || 0;
  const remainingDue = Number(fee.amountDue) || 0;
  const totalAmount =
    fee.status === "Partial Paid"
      ? paidAmount + remainingDue
      : fee.status === "Paid"
      ? paidAmount || remainingDue
      : remainingDue;

  return {
    id: fee._id,
    feeId: fee._id,
    studentId: rawStudentId,
    name: studentName,
    batchName: `${batchName} • ${fee.title || fee.month}`,
    title: fee.title || fee.month,
    month: fee.month,
    pendingAmount: remainingDue,
    paidAmount: paidAmount,
    totalAmount: totalAmount,
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

  const activeCenterId = typeof window !== "undefined" ? getCurrentCenterId() : "";
  const cachedPending = getApiCache<ApiFee[]>("/fees", { centerId: activeCenterId, status: "Pending,Partial Paid" });
  const cachedReview = getApiCache<ApiFee[]>("/fees", { centerId: activeCenterId, status: "Verification Pending" });
  const cachedDashboard = getApiCache<{ collectedFeesThisMonth?: number }>("/dashboard/owner", { centerId: activeCenterId });

  // Data lists strictly separated by status
  const [pendingStudents, setPendingStudents] = useState<OverdueFeeStudent[]>(
    () => (cachedPending?.data ? cachedPending.data.map(mapFeeToStudent) : [])
  );
  const [reviewStudents, setReviewStudents] = useState<OverdueFeeStudent[]>(
    () => (cachedReview?.data ? cachedReview.data.map(mapFeeToStudent) : [])
  );
  const [paidStudents, setPaidStudents] = useState<OverdueFeeStudent[]>([]);
  const [collectedAmount, setCollectedAmount] = useState<number>(
    () => cachedDashboard?.data?.collectedFeesThisMonth || 0
  );
  const [loadingPaid, setLoadingPaid] = useState<boolean>(false);
  const [hasLoadedPaid, setHasLoadedPaid] = useState<boolean>(false);

  // Sub-filter for Pending Dues tab
  const [pendingFilter, setPendingFilter] = useState<"all" | "critical" | "moderate">("all");

  // Reminder & Action States
  const [sentReminders, setSentReminders] = useState<Record<string, boolean>>({});
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [isGlobalSent, setIsGlobalSent] = useState(false);
  const [isSendingBulk, setIsSendingBulk] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !cachedPending && !cachedReview);
  const [error, setError] = useState<string | null>(null);

  // Phase 2A Modal & Confirmation States
  const [isAddFeeModalOpen, setIsAddFeeModalOpen] = useState(false);
  const [cooldownConfirmFee, setCooldownConfirmFee] = useState<{
    feeId: string;
    student: OverdueFeeStudent;
    message: string;
  } | null>(null);
  const [overrideReasonInput, setOverrideReasonInput] = useState(
    "Parent requested urgent invoice link via phone"
  );
  const [isOverriding, setIsOverriding] = useState(false);

  // Synchronize dynamic badge count with persistent TopHeader
  useSetHeader({
    title: "Fee Management",
    subtitle: "Pending Dues, Reviews & Paid History",
    badgeText:
      reviewStudents.length > 0
        ? `${reviewStudents.length} Review`
        : `${pendingStudents.length} Due`,
  });

  // Lazy fetch historical paid records on demand
  const fetchPaidHistory = useCallback(async (isRefresh = false) => {
    setLoadingPaid(true);
    try {
      const activeId = getCurrentCenterId();
      const res = await apiClient<ApiFee[]>("/fees", {
        params: { centerId: activeId, status: "Paid" },
        skipCache: isRefresh,
      });
      if (res.success && Array.isArray(res.data)) {
        const rawPaid = res.data;
        setPaidStudents(rawPaid.map(mapFeeToStudent));

        const totalPaid = rawPaid.reduce(
          (sum, f) => sum + (Number(f.paidAmount || f.amountDue) || 0),
          0
        );
        setCollectedAmount(totalPaid);
        setHasLoadedPaid(true);
      }
    } catch {
      // ignore
    } finally {
      setLoadingPaid(false);
    }
  }, []);

  // Fetch active fee data on initial mount (omitting heavy historical paid records)
  const fetchFeesData = useCallback(async (isRefresh = false) => {
    if (isRefresh || (!cachedPending && !cachedReview)) {
      setLoading(true);
    }
    setError(null);
    try {
      const activeId = getCurrentCenterId();
      const [pendingRes, reviewRes, dashboardRes] = await Promise.allSettled([
        apiClient<ApiFee[]>("/fees", {
          params: { centerId: activeId, status: "Pending,Partial Paid" },
          skipCache: isRefresh,
        }),
        apiClient<ApiFee[]>("/fees", {
          params: { centerId: activeId, status: "Verification Pending" },
          skipCache: isRefresh,
        }),
        apiClient<{ collectedFeesThisMonth?: number }>("/dashboard/owner", {
          params: { centerId: activeId },
          skipCache: isRefresh,
        }),
      ]);

      // 1. Pending Dues (Strictly status === 'Pending')
      if (pendingRes.status === "fulfilled" && pendingRes.value.success && Array.isArray(pendingRes.value.data)) {
        setPendingStudents(pendingRes.value.data.map(mapFeeToStudent));
      } else if (isRefresh || !cachedPending) {
        setPendingStudents([]);
      }

      // 2. Awaiting Review (Strictly status === 'Verification Pending')
      if (reviewRes.status === "fulfilled" && reviewRes.value.success && Array.isArray(reviewRes.value.data)) {
        setReviewStudents(reviewRes.value.data.map(mapFeeToStudent));
      } else if (isRefresh || !cachedReview) {
        setReviewStudents([]);
      }

      // 3. Fast server-side total collection aggregate from dashboard endpoint
      if (dashboardRes.status === "fulfilled" && dashboardRes.value.success && dashboardRes.value.data) {
        setCollectedAmount(dashboardRes.value.data.collectedFeesThisMonth || 0);
      }

      // 4. Refresh paid history if it was already loaded before
      if (hasLoadedPaid) {
        fetchPaidHistory(isRefresh);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load fee records";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [hasLoadedPaid, fetchPaidHistory, cachedPending, cachedReview]);

  useEffect(() => {
    const run = async () => {
      await fetchFeesData();
    };
    run();
  }, [fetchFeesData]);

  // Load historical paid records only when the user navigates to the Paid tab
  useEffect(() => {
    if (activeTab === "paid" && !hasLoadedPaid && !loadingPaid) {
      const run = async () => {
        await fetchPaidHistory();
      };
      run();
    }
  }, [activeTab, hasLoadedPaid, loadingPaid, fetchPaidHistory]);

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

  // Trigger individual WhatsApp reminder (Pending tab) with 24h cooldown handling
  const handleSendIndividual = async (
    student: OverdueFeeStudent,
    forceOverride = false,
    overrideReason?: string
  ) => {
    if (!student) return;

    // Strict contract: The reminder endpoint expects a FEE ID, not a student ID
    const feeId = student.feeId || student.id;
    if (!feeId) {
      alert("Error: Fee record ID is missing.");
      return;
    }

    setSendingReminderId(feeId);

    try {
      const res = await apiClient<{
        status?: string;
        providerMessageId?: string;
        simulated?: boolean;
        message?: string;
        code?: string;
        error?: string;
      }>(`/fees/${feeId}/remind`, {
        method: "POST",
        body: {
          forceOverride,
          overrideReason:
            overrideReason ||
            (forceOverride ? "Explicit owner manual override" : undefined),
        },
      });

      if (!res.success) {
        if (
          res.code === "COOLDOWN_ACTIVE" ||
          (res.error && res.error.toLowerCase().includes("24 hours"))
        ) {
          setCooldownConfirmFee({
            feeId,
            student,
            message:
              res.error ||
              "A reminder was already sent to this parent within the last 24 hours.",
          });
          return;
        }
        throw new Error(res.error || "Failed to dispatch fee reminder.");
      }

      // Successful dispatch accepted by provider
      setSentReminders((prev) => ({
        ...prev,
        [feeId]: true,
      }));

      setCooldownConfirmFee(null);

      const toastText = res.data?.simulated
        ? `[Simulation] Fee reminder queued for ${student.name}'s parent (${student.parentPhone})!`
        : `Fee reminder accepted by WhatsApp provider for ${student.name}'s parent (${student.parentPhone})!`;

      setToastMessage(toastText);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send reminder";
      if (msg.includes("24 hours") || msg.includes("COOLDOWN_ACTIVE")) {
        setCooldownConfirmFee({
          feeId,
          student,
          message: msg,
        });
      } else {
        alert(msg);
      }
    } finally {
      setSendingReminderId(null);
      setIsOverriding(false);
    }
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
    const feeId = student.feeId || student.id;
    if (!feeId) return;

    const confirmed = window.confirm(
      `Confirm marking fee of ₹${student.pendingAmount.toLocaleString("en-IN")} for ${student.name} as Paid via Cash? This will generate an official receipt number.`
    );
    if (!confirmed) return;

    setMarkingPaidId(feeId);
    try {
      const res = await apiClient<{ receiptNumber?: string }>(`/fees/${feeId}`, {
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
    const feeId = student.feeId || student.id;
    if (!feeId) return;

    const confirmed = window.confirm(
      `Check your bank statement: Confirm receipt of ₹${student.pendingAmount.toLocaleString("en-IN")} (UTR: ${student.utrNumber || "N/A"}) for ${student.name} and approve payment?`
    );
    if (!confirmed) return;

    setApprovingId(feeId);
    try {
      await apiClient(`/fees/${feeId}`, {
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
    const feeId = student.feeId || student.id;
    if (!feeId) return;

    const confirmed = window.confirm(
      `Reject & Delete: Are you sure you want to completely remove this fee submission for ${student.name} (Amount: ₹${student.pendingAmount.toLocaleString("en-IN")}, UTR: ${student.utrNumber || "N/A"})? This will clear it from your dashboard and the parent's portal.`
    );
    if (!confirmed) return;

    setRejectingId(feeId);
    try {
      await apiClient(`/fees/${feeId}`, {
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
                onClick={() => fetchFeesData(true)}
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
              {hasLoadedPaid ? paidStudents.length : "—"}
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
                    onClick={() => fetchFeesData(true)}
                    className="tap-bounce text-slate-400 hover:text-slate-600 p-1"
                    title="Reload fees"
                    aria-label="Reload fees"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 4. Pending List Header with Add Fee trigger */}
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[14px] font-bold text-slate-900 tracking-tight">
                      Pending Students ({filteredPendingStudents.length})
                    </h2>
                    <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">
                      • Tap green icon to remind
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddFeeModalOpen(true)}
                    className="tap-bounce rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-blue-600/25 transition-all"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Fee</span>
                  </button>
                </div>

                {/* 5. Pending Students List */}
                <div className="space-y-2.5">
                  {filteredPendingStudents.length > 0 ? (
                    filteredPendingStudents.map((student) => {
                      const feeId = student.feeId || student.id;
                      return (
                        <OverdueStudentItem
                          key={feeId}
                          student={student}
                          tabType="pending"
                          onSendReminder={handleSendIndividual}
                          isReminderSent={Boolean(sentReminders[feeId])}
                          isSendingReminder={sendingReminderId === feeId}
                          onMarkPaid={handleMarkPaid}
                          isMarkingPaid={markingPaidId === feeId}
                        />
                      );
                    })
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
                        onClick={() => fetchFeesData(true)}
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
                    reviewStudents.map((student) => {
                      const feeId = student.feeId || student.id;
                      return (
                        <OverdueStudentItem
                          key={feeId}
                          student={student}
                          tabType="review"
                          onVerifyPaid={handleApprovePayment}
                          isVerifyingPaid={approvingId === feeId}
                          onRejectFee={handleRejectPayment}
                          isRejectingFee={rejectingId === feeId}
                        />
                      );
                    })
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
                        {hasLoadedPaid ? `${paidStudents.length} Records Cleared` : "Loading..."}
                      </span>
                      <button
                        onClick={() => {
                          fetchFeesData();
                          fetchPaidHistory();
                        }}
                        className="tap-bounce text-slate-400 hover:text-slate-600 p-1"
                        title="Reload history"
                        aria-label="Reload history"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${loadingPaid ? "animate-spin text-emerald-600" : ""}`} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Paid Students List */}
                <div className="space-y-2.5">
                  {loadingPaid && paidStudents.length === 0 ? (
                    <div className="rounded-3xl border border-slate-100 bg-white p-10 text-center shadow-xs">
                      <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-500">
                        Loading paid fee records...
                      </p>
                    </div>
                  ) : paidStudents.length > 0 ? (
                    paidStudents.map((student) => (
                      <OverdueStudentItem
                        key={student.feeId || student.id}
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

      {/* Add Fee Modal */}
      <AddFeeModal
        isOpen={isAddFeeModalOpen}
        onClose={() => setIsAddFeeModalOpen(false)}
        onSuccess={() => {
          setIsAddFeeModalOpen(false);
          fetchFeesData(true);
        }}
      />

      {/* 24-Hour Cooldown Confirmation Dialog */}
      {cooldownConfirmFee && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fade-in">
          <div className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xl w-full max-w-sm relative transition-all">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 text-amber-600">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 leading-snug">
                  Reminder Sent Inside 24 Hours
                </h3>
                <p className="text-[11px] text-slate-400">
                  Manual Resend Confirmation
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 my-3 leading-relaxed">
              A reminder was already sent to{" "}
              <strong className="text-slate-900">{cooldownConfirmFee.student.name}</strong>{" "}
              ({cooldownConfirmFee.student.parentPhone}) within the last 24 hours. Are you sure you want to send another reminder now?
            </p>

            <div className="mb-4">
              <label
                htmlFor="override-reason"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Audit Reason for Override
              </label>
              <input
                id="override-reason"
                type="text"
                value={overrideReasonInput}
                onChange={(e) => setOverrideReasonInput(e.target.value)}
                placeholder="e.g. Parent requested urgent invoice link via phone"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-semibold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCooldownConfirmFee(null)}
                disabled={isOverriding}
                className="tap-bounce flex-1 h-10 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async () => {
                  setIsOverriding(true);
                  await handleSendIndividual(
                    cooldownConfirmFee.student,
                    true,
                    overrideReasonInput || "Owner explicit confirmation via UI"
                  );
                }}
                disabled={isOverriding}
                className="tap-bounce flex-1 h-10 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-amber-600/25 transition-all disabled:opacity-60"
              >
                {isOverriding ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <span>Confirm Resend</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
