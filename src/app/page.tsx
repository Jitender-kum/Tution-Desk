"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import TopHeader from "@/components/layout/TopHeader";
import PendingFeesHeroCard from "@/components/dashboard/PendingFeesHeroCard";
import StatsRow from "@/components/dashboard/StatsRow";
import QuickActions from "@/components/dashboard/QuickActions";
import TodayScheduleTimeline from "@/components/dashboard/TodayScheduleTimeline";
import RecentActivityCard from "@/components/dashboard/RecentActivityCard";
import { apiClient } from "@/lib/apiClient";
import {
  DashboardMetrics,
  QuickBatchAttendance,
  RecentActivityItem,
} from "@/types";

interface OwnerDashboardData {
  totalStudents: number;
  totalBatches: number;
  pendingFeesTotal: number;
  overdueCount: number;
  todayAttendance: number;
  todayPresentCount: number;
  collectedFeesThisMonth: number;
  pendingTestsCount: number;
  attendanceTodayPercentage: number;
  batches: QuickBatchAttendance[];
  recentActivities: RecentActivityItem[];
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "Recently";
  const date = new Date(dateString);
  const diffInMinutes = Math.floor(
    (Date.now() - date.getTime()) / (1000 * 60)
  );

  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [centerInfo, setCenterInfo] = useState({
    name: "Tuition Center",
    ownerName: "Owner",
    tagline: "Excellence in Coaching & Mentorship",
  });

  const [metrics, setMetrics] = useState<DashboardMetrics>({
    collectedFeesThisMonth: 0,
    pendingFeesTotal: 0,
    totalActiveStudents: 0,
    totalBatchesToday: 0,
    pendingTestsCount: 0,
    newEnquiriesCount: 0,
    attendanceTodayPercentage: 100,
    overdueCount: 0,
    todayAttendance: 0,
  });

  const [isSendingReminders, setIsSendingReminders] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [batches, setBatches] = useState<QuickBatchAttendance[]>([]);
  const [activities, setActivities] = useState<RecentActivityItem[]>([]);

  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Fetch real aggregated metrics from the dedicated Owner Dashboard API
      const dashboardRes = await apiClient<OwnerDashboardData>("/dashboard/owner");

      if (dashboardRes.success && dashboardRes.data) {
        const d = dashboardRes.data;

        setMetrics({
          collectedFeesThisMonth: d.collectedFeesThisMonth || 0,
          pendingFeesTotal: d.pendingFeesTotal || 0,
          totalActiveStudents: d.totalStudents || 0,
          totalBatchesToday: d.totalBatches || 0,
          pendingTestsCount: d.pendingTestsCount || 0,
          newEnquiriesCount: d.totalStudents || 0,
          attendanceTodayPercentage: d.attendanceTodayPercentage ?? 100,
          overdueCount: d.overdueCount || 0,
          todayAttendance: d.todayAttendance || 0,
        });

        // Map live batches to timeline
        const mappedBatches: QuickBatchAttendance[] = (d.batches || []).map((b, idx) => ({
          id: b.id || `batch_${idx + 1}`,
          batchName: b.batchName || "Batch",
          subject: b.subject || "Regular Session",
          timeSlot: (b as any).timing || b.timeSlot || "05:00 PM - 06:15 PM",
          room: b.room || `Room ${idx + 1}`,
          totalStudents: b.totalStudents || 0,
          markedStudents: b.markedStudents || 0,
          status: b.status || "pending",
          timelineStatus: idx === 0 ? "ongoing" : "upcoming",
        }));
        setBatches(mappedBatches);

        // Format relative times on recent activities
        const formattedActivities = (d.recentActivities || []).map((a) => ({
          ...a,
          time: formatRelativeTime(a.time),
        }));
        setActivities(formattedActivities);
      }

      // 2. Fetch authenticated center info for header display
      fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((meData) => {
          if (meData?.center?.name) {
            setCenterInfo((prev) => ({
              ...prev,
              name: meData.center.name,
              ownerName: meData.center.ownerName || prev.ownerName,
            }));
          }
        })
        .catch(() => {});
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load dashboard data";
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Handle Bulk WhatsApp Fee Reminders (The Orange Action)
  const handleSendFeeReminders = async () => {
    setIsSendingReminders(true);
    try {
      const res = await apiClient<{ sentCount: number }>("/fees/remind-all", {
        method: "POST",
      });

      const count = res.data?.sentCount || metrics.overdueCount || 0;
      setToastMessage(`Sent ${count} WhatsApp fee reminders successfully!`);
      setTimeout(() => setToastMessage(null), 4500);

      // Re-fetch dashboard data
      fetchDashboardData(true);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to dispatch reminders";
      alert(msg);
    } finally {
      setIsSendingReminders(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* Mobile Top Header with Center Branding */}
      <TopHeader
        title={centerInfo.name}
        subtitle={centerInfo.tagline}
        badgeText="Owner"
      />

      {/* Main Content Area */}
      <div className="p-4 space-y-4.5 pb-6">
        {/* Welcome Section with Refresh Button */}
        <div className="flex items-center justify-between px-0.5">
          <div>
            <p className="text-[12px] font-semibold text-slate-500">
              Welcome back,
            </p>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              {centerInfo.ownerName}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchDashboardData(true)}
              disabled={loading || refreshing}
              className="tap-bounce flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors shadow-2xs disabled:opacity-50"
              title="Refresh live data"
              aria-label="Refresh live data"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-blue-600" : ""}`}
              />
            </button>
            <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-700 border border-blue-200/60 shadow-2xs">
              {metrics.totalBatchesToday} Batches Today
            </span>
          </div>
        </div>

        {/* Error Alert with Retry */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-3 shadow-sm">
            <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <p className="font-bold">Backend Connection Issue</p>
              <p className="mt-0.5 text-rose-700">{error}</p>
              <button
                onClick={() => fetchDashboardData()}
                className="mt-2 font-bold underline text-rose-900 hover:text-rose-950"
              >
                Click here to retry
              </button>
            </div>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading ? (
          <div className="space-y-4 animate-pulse">
            {/* Hero Card Skeleton */}
            <div className="h-44 rounded-3xl bg-slate-200/80 p-5 flex flex-col justify-between">
              <div className="flex justify-between items-center">
                <div className="h-4 w-28 bg-slate-300 rounded-md" />
                <div className="h-6 w-20 bg-slate-300 rounded-full" />
              </div>
              <div className="space-y-2">
                <div className="h-9 w-40 bg-slate-300 rounded-lg" />
                <div className="h-3 w-52 bg-slate-300 rounded-md" />
              </div>
              <div className="h-10 w-full bg-slate-300/80 rounded-xl" />
            </div>

            {/* Stats Row Skeleton */}
            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 rounded-2xl bg-slate-200/80 p-3 flex flex-col justify-between"
                >
                  <div className="h-7 w-7 rounded-xl bg-slate-300" />
                  <div className="space-y-1.5">
                    <div className="h-5 w-10 bg-slate-300 rounded" />
                    <div className="h-3 w-16 bg-slate-300 rounded" />
                  </div>
                </div>
              ))}
            </div>

            {/* Actions / Content Skeleton */}
            <div className="h-36 rounded-3xl bg-slate-200/70 p-4 flex items-center justify-center text-slate-400 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <span className="text-xs font-semibold text-slate-500">
                Loading dashboard records...
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* 1. Main Vibrant Gradient Card: 'Pending Fees' */}
            <PendingFeesHeroCard metrics={metrics} />

            {/* 2. Stats Row: 3 separate cards side-by-side (Students, Batches, Tests) */}
            <StatsRow metrics={metrics} />

            {/* 3. Quick Actions: Large, solid-colored rectangular blocks */}
            <QuickActions
              onSendFeeReminders={handleSendFeeReminders}
              isSendingReminders={isSendingReminders}
              overdueCount={metrics.overdueCount}
            />

            {/* 4. Today's Schedule: Vertical timeline with connected line */}
            <TodayScheduleTimeline batches={batches} />

            {/* 5. Live Recent Activity Feed */}
            <RecentActivityCard activities={activities} />
          </>
        )}
      </div>

      {/* Floating Success Toast */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 w-[92%] max-w-sm z-50 animate-bounce">
          <div className="rounded-2xl bg-slate-900 text-white p-3.5 shadow-xl flex items-center gap-2.5 border border-slate-700">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <div className="flex-1 text-xs font-semibold leading-snug">
              {toastMessage}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
