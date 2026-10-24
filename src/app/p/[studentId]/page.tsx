"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import TopHeader from "@/components/layout/TopHeader";
import ChildProfileHeader from "@/components/parent/ChildProfileHeader";
import AttendanceProgressCard from "@/components/parent/AttendanceProgressCard";
import FeeActionCard from "@/components/parent/FeeActionCard";
import FeeHistoryCard from "@/components/parent/FeeHistoryCard";
import {
  Award,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Phone,
  MessageCircle,
  Calendar,
  Sparkles,
  GraduationCap,
} from "lucide-react";

interface ApiStudent {
  _id: string;
  centerId: string;
  name: string;
  batch: string;
  parentWhatsApp: string;
  isActive: boolean;
  monthlyFee?: number;
  billingCycleDate?: number;
}

interface ApiCenter {
  name: string;
  ownerName: string;
  phone: string;
  upiId: string;
}

interface ApiAttendanceStats {
  percentage: number;
  totalClasses: number;
  attended: number;
  missed: number;
  history?: Array<{
    id: string;
    date: string;
    batch: string;
    status: string;
  }>;
}

interface ApiFees {
  feeId?: string | null;
  amountDue?: number;
  pendingAmount: number;
  dueDate: string | null;
  daysLate: number;
  status: "Pending" | "Paid" | "Verification Pending";
  utrNumber?: string;
  month?: string;
  history?: Array<{
    id: string;
    month: string;
    title?: string;
    amountDue: number;
    dueDate?: string | null;
    status: string;
    utrNumber?: string;
    receiptNumber?: string;
    paymentDate?: string | null;
    paidDate?: string | null;
    paidAt?: string | null;
    paymentMode?: string;
    createdAt?: string | null;
  }>;
}

interface ApiTestResult {
  id: string;
  title: string;
  batch: string;
  date: string;
  maxMarks: number;
  marksObtained: number;
  percentage: number;
  isAbsent?: boolean;
}

interface ParentPortalPayload {
  student: ApiStudent;
  center: ApiCenter;
  attendanceStats: ApiAttendanceStats;
  fees: ApiFees;
  testResults: ApiTestResult[];
}

function getInitials(name: string): string {
  if (!name) return "ST";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDate(dateString?: string | null): string {
  if (!dateString) return "Upcoming";
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(dateString);
  }
}

export default function ParentMagicLinkPage() {
  const routeParams = useParams();
  const studentId =
    typeof routeParams?.studentId === "string"
      ? routeParams.studentId
      : Array.isArray(routeParams?.studentId)
      ? routeParams.studentId[0]
      : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<ParentPortalPayload | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Fetch real Parent Portal data on mount from backend API
  const loadPortalData = useCallback(async () => {
    if (!studentId) {
      setError("No student ID specified in link.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const backendUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

      const res = await fetch(`${backendUrl}/parent/${studentId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load student portal records");
      }

      setData(json.data);
      if (json.data.fees?.status === "Paid" || json.data.fees?.pendingAmount === 0) {
        setIsPaid(true);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Unable to load student information";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData]);

  const handlePaymentSuccess = () => {
    setIsPaid(true);
    setToastMessage(
      "Payment Successful! Official e-receipt generated and sent to WhatsApp."
    );
    setTimeout(() => setToastMessage(null), 4500);
  };

  // 1. Loading Skeleton State
  if (loading) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <TopHeader
          title="Tuition Desk"
          subtitle="VIP Parent Portal • Live Progress"
          badgeText="Verified Parent"
          showLogout={false}
        />
        <div className="p-4 space-y-4 max-w-lg mx-auto w-full animate-pulse">
          {/* Header Profile Skeleton */}
          <div className="h-28 rounded-3xl bg-slate-200/90 p-4 flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-slate-300" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-36 bg-slate-300 rounded" />
              <div className="h-3 w-48 bg-slate-300 rounded" />
            </div>
          </div>

          {/* Fee Card Skeleton */}
          <div className="h-40 rounded-3xl bg-slate-200/80 p-5 space-y-3">
            <div className="h-4 w-28 bg-slate-300 rounded" />
            <div className="h-8 w-44 bg-slate-300 rounded-lg" />
            <div className="h-10 w-full bg-slate-300/80 rounded-xl" />
          </div>

          {/* Attendance Skeleton */}
          <div className="h-32 rounded-3xl bg-slate-200/80 p-4 flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-32 bg-slate-300 rounded" />
              <div className="h-3 w-40 bg-slate-300 rounded" />
            </div>
            <div className="h-20 w-20 rounded-full bg-slate-300" />
          </div>

          {/* Tests Skeleton */}
          <div className="h-36 rounded-3xl bg-slate-200/80 p-4 flex flex-col justify-center items-center gap-2 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span className="text-xs font-semibold text-slate-500">
              Loading student progress...
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Error State (e.g. 404 Student Not Found)
  if (error || !data || !data.student) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <TopHeader
          title="Tuition Desk"
          subtitle="VIP Parent Portal"
          badgeText="Link Status"
          showLogout={false}
        />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-lg space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100">
              <AlertCircle className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-900">
                Portal Record Not Found
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                {error ||
                  "The requested student magic link is invalid or may have expired."}
              </p>
            </div>
            <button
              onClick={() => loadPortalData()}
              className="tap-bounce w-full h-11 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center shadow-md shadow-blue-600/20"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { student, center, attendanceStats, fees, testResults } = data;

  const studentName = student.name || "Student";
  const batchName = student.batch || "Regular Batch";
  const initials = getInitials(studentName);
  const formattedDueDate = formatDate(fees.dueDate);
  const upiId = center?.upiId || "tuitiondesk@upi";

  return (
    <div className="flex flex-col min-h-full relative bg-slate-50/50">
      {/* Top Header */}
      <TopHeader
        title={center?.name || "Tuition Center"}
        subtitle="VIP Parent Portal • Live Progress"
        badgeText="Verified Parent"
        showLogout={false}
      />

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

      {/* Main Content Area */}
      <div className="p-4 space-y-4 pb-24 max-w-lg mx-auto w-full">
        {/* 1. Header & Profile Card: Real Student & Batch */}
        <ChildProfileHeader
          childName={studentName}
          batchName={batchName}
          rollNumber={student._id.slice(-4).toUpperCase()}
          initials={initials}
          avatarColor="bg-blue-100 text-blue-700 border-blue-200"
        />

        {/* 2. Crucial Fee Action Card (Real fee from MongoDB) */}
        <FeeActionCard
          feeId={fees.feeId}
          studentId={student._id}
          centerId={student.centerId}
          amount={fees.pendingAmount}
          dueDate={formattedDueDate}
          daysLate={fees.daysLate}
          upiId={center?.upiId || upiId}
          centerName={center?.name || "Tuition Center"}
          status={fees.status}
          utrNumber={fees.utrNumber}
          onPaymentSuccess={() => {
            handlePaymentSuccess();
            loadPortalData();
          }}
          onUtrSubmitted={(utr) => {
            setToastMessage(`Payment reference ${utr} submitted for verification!`);
            setTimeout(() => setToastMessage(null), 4500);
            loadPortalData();
          }}
          onAdvancePaymentSuccess={() => {
            setToastMessage(
              "Advance payment submitted successfully! Awaiting center verification."
            );
            setTimeout(() => setToastMessage(null), 4500);
            loadPortalData();
          }}
          isPaid={isPaid || fees.status === "Paid"}
        />

        {/* 2.5 Fee Payment History (Paid Receipts Archive) */}
        <FeeHistoryCard
          history={fees.history}
          studentName={student?.name}
          centerName={center?.name}
        />

        {/* 3. Core Metric: Overall Attendance % */}
        <AttendanceProgressCard
          percentage={attendanceStats.percentage}
          totalClasses={attendanceStats.totalClasses}
          attended={attendanceStats.attended}
          missed={attendanceStats.missed}
        />

        {/* 4. Performance & Test Results (Real Test Marks from MongoDB) */}
        <div className="rounded-3xl border border-slate-100 bg-white p-4.5 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center">
                <Award className="h-4 w-4 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-slate-900 tracking-tight">
                  Recent Test Marks
                </h3>
                <p className="text-[11px] text-slate-500">
                  Evaluated classroom tests &amp; quizzes
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
              <GraduationCap className="h-3 w-3" />
              {testResults.length} Tests
            </span>
          </div>

          {testResults.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center space-y-1.5">
              <Sparkles className="h-5 w-5 text-slate-400 mx-auto" />
              <p className="text-xs font-semibold text-slate-700">
                No Tests Recorded Yet
              </p>
              <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                Evaluated test scores and performance ratings will appear here
                once published by the center.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 pt-1">
              {testResults.map((test) => {
                const isGreat = test.percentage >= 80;
                const isPassing = test.percentage >= 50;

                const badgeBg = test.isAbsent
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : isGreat
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : isPassing
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-amber-50 text-amber-700 border-amber-200";

                return (
                  <div
                    key={test.id}
                    className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 space-y-2 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <h4 className="text-[13px] font-bold text-slate-900 leading-snug">
                          {test.title}
                        </h4>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            {formatDate(test.date)}
                          </span>
                          <span>•</span>
                          <span>{test.batch}</span>
                        </div>
                      </div>

                      {/* Marks & Percentage Badge */}
                      <div className="text-right flex-shrink-0">
                        {test.isAbsent ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${badgeBg}`}
                          >
                            Absent
                          </span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-xs font-extrabold text-slate-900 font-mono">
                              <span className="text-[14px]">
                                {test.marksObtained}
                              </span>
                              <span className="text-slate-400 font-normal">
                                /{test.maxMarks}
                              </span>
                            </span>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${badgeBg}`}
                            >
                              {test.percentage}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress track */}
                    {!test.isAbsent && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isGreat
                              ? "bg-emerald-500"
                              : isPassing
                              ? "bg-blue-500"
                              : "bg-amber-500"
                          }`}
                          style={{
                            width: `${Math.min(100, Math.max(0, test.percentage))}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 5. Direct Teacher Connect Card */}
        <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm space-y-2.5">
          <h3 className="text-[13px] font-bold text-slate-800">
            Have questions about {studentName}&apos;s progress?
          </h3>
          <p className="text-[11px] text-slate-500">
            You can reach out directly to tuition head{" "}
            {center?.ownerName || "the Center Head"}.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <a
              href={`tel:+91${center?.phone || "9876543210"}`}
              className="tap-bounce flex-1 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Phone className="h-3.5 w-3.5 text-slate-600" />
              Call Center
            </a>
            <a
              href={`https://wa.me/91${center?.phone || "9876543210"}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-bounce flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
