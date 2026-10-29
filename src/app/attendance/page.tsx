"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import AttendanceHeader from "@/components/attendance/AttendanceHeader";
import StudentAttendanceRow from "@/components/attendance/StudentAttendanceRow";
import StickySaveBar from "@/components/attendance/StickySaveBar";
import { apiClient, getCurrentCenterId } from "@/lib/apiClient";
import {
  AttendanceStatus,
  QuickBatchAttendance,
  StudentAttendanceItem,
} from "@/types";
import { CheckCircle2, AlertCircle, Users, RefreshCw } from "lucide-react";

interface ApiStudent {
  _id: string;
  centerId: string;
  name: string;
  batch: string;
  parentWhatsApp: string;
  isActive: boolean;
  createdAt: string;
}

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-purple-100 text-purple-700 border-purple-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function AttendancePage() {
  const [allStudents, setAllStudents] = useState<ApiStudent[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [attendanceMap, setAttendanceMap] = useState<
    Record<string, AttendanceStatus>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [notificationToast, setNotificationToast] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [todayFormatted, setTodayFormatted] = useState("");

  useEffect(() => {
    setTodayFormatted(
      new Date().toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    );
  }, []);

  // Fetch all students from backend
  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<ApiStudent[]>("/students", {
        params: { centerId: getCurrentCenterId() },
      });

      const students = res.data || [];
      setAllStudents(students);

      // Extract unique batches
      const uniqueBatches = Array.from(
        new Set(students.map((s) => s.batch).filter(Boolean))
      );

      // Check URL query param ?batch=...
      const urlParams = new URLSearchParams(window.location.search);
      const urlBatch = urlParams.get("batch");

      let initialBatch = uniqueBatches[0] || "Default Batch";
      if (urlBatch && uniqueBatches.includes(urlBatch)) {
        initialBatch = urlBatch;
      }
      setSelectedBatchId(initialBatch);

      // Initialize students in initial batch to unmarked
      const initialMap: Record<string, AttendanceStatus> = {};
      students
        .filter((s) => s.batch === initialBatch)
        .forEach((s) => {
          initialMap[s._id] = "unmarked";
        });
      setAttendanceMap(initialMap);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load students";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  // Compute batches list for AttendanceHeader
  const batchOptions: QuickBatchAttendance[] = useMemo(() => {
    const batchMap = new Map<string, number>();
    allStudents.forEach((s) => {
      if (s.batch) {
        batchMap.set(s.batch, (batchMap.get(s.batch) || 0) + 1);
      }
    });

    if (batchMap.size === 0) {
      return [
        {
          id: selectedBatchId || "default",
          batchName: selectedBatchId || "All Students",
          subject: "Regular Session",
          timeSlot: "04:30 PM - 05:45 PM",
          totalStudents: allStudents.length,
          markedStudents: 0,
          status: "pending",
          timelineStatus: "ongoing",
        },
      ];
    }

    return Array.from(batchMap.entries()).map(([batchName, count], idx) => ({
      id: batchName,
      batchName,
      subject: "Regular Session",
      timeSlot: idx === 0 ? "04:30 PM - 05:45 PM" : "06:00 PM - 07:15 PM",
      totalStudents: count,
      markedStudents: 0,
      status: "pending",
      timelineStatus: idx === 0 ? "ongoing" : "upcoming",
    }));
  }, [allStudents, selectedBatchId]);

  // Handle batch selection
  const handleSelectBatch = (batchId: string) => {
    setSelectedBatchId(batchId);
    setIsSaved(false);

    // Populate unmarked for students in the newly selected batch
    setAttendanceMap((prev) => {
      const next = { ...prev };
      allStudents
        .filter((s) => s.batch === batchId)
        .forEach((s) => {
          if (!next[s._id]) {
            next[s._id] = "unmarked";
          }
        });
      return next;
    });
  };

  // Filter students for current batch and map to StudentAttendanceItem
  const currentBatchStudents: StudentAttendanceItem[] = useMemo(() => {
    const filtered = allStudents.filter(
      (s) => !selectedBatchId || s.batch === selectedBatchId
    );

    return filtered.map((s, idx) => ({
      id: s._id,
      name: s.name,
      rollNumber: String(idx + 1).padStart(2, "0"),
      avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
      initials: getInitials(s.name),
      parentPhone: s.parentWhatsApp,
      attendanceRate: 95,
    }));
  }, [allStudents, selectedBatchId]);

  // Toggle individual student status (stable callback reference for React.memo)
  const handleToggleStatus = useCallback(
    (studentId: string, newStatus: AttendanceStatus) => {
      setIsSaved(false);
      setAttendanceMap((prev) => ({
        ...prev,
        [studentId]: newStatus,
      }));
    },
    []
  );

  // Mark all students in current batch present
  const handleMarkAllPresent = useCallback(() => {
    setIsSaved(false);
    setAttendanceMap((prev) => {
      const updated: Record<string, AttendanceStatus> = {};
      currentBatchStudents.forEach((std) => {
        updated[std.id] = "present";
      });
      return { ...prev, ...updated };
    });
  }, [currentBatchStudents]);

  // Live counts
  const presentCount = currentBatchStudents.filter(
    (s) => attendanceMap[s.id] === "present"
  ).length;

  const absentCount = currentBatchStudents.filter(
    (s) => attendanceMap[s.id] === "absent"
  ).length;

  const unmarkedCount =
    currentBatchStudents.length - (presentCount + absentCount);


  // Save to MongoDB /api/attendance
  const handleSaveAndNotify = async () => {
    if (saving || isSaved) return;

    const markedStudents = currentBatchStudents.filter(
      (s) =>
        attendanceMap[s.id] === "present" || attendanceMap[s.id] === "absent"
    );

    if (markedStudents.length === 0) {
      setNotificationToast("Please mark at least one student before saving.");
      setTimeout(() => setNotificationToast(null), 3000);
      return;
    }

    setSaving(true);
    try {
      const todayDate = new Date().toISOString();

      // Post attendance record for each marked student with individual settlement
      const results = await Promise.allSettled(
        markedStudents.map((s) =>
          apiClient("/attendance", {
            method: "POST",
            body: {
              centerId: getCurrentCenterId(),
              studentId: s.id,
              date: todayDate,
              batch: selectedBatchId,
              status: attendanceMap[s.id] === "absent" ? "Absent" : "Present",
            },
          })
        )
      );

      const successfulCount = results.filter((r) => r.status === "fulfilled").length;
      const failedCount = results.filter((r) => r.status === "rejected").length;

      if (failedCount === 0) {
        setIsSaved(true);
        setNotificationToast(
          absentCount > 0
            ? `Attendance saved! WhatsApp absentee alerts dispatched to ${absentCount} parent(s).`
            : `Attendance saved for ${markedStudents.length} student(s)! All parents notified.`
        );
      } else if (successfulCount > 0) {
        setIsSaved(true);
        setNotificationToast(
          `Partially saved: ${successfulCount} student(s) saved, ${failedCount} failed. Please retry failed entries.`
        );
      } else {
        throw new Error(`Failed to save attendance records for all ${failedCount} students.`);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to save attendance";
      setNotificationToast(`Error: ${msg}`);
    } finally {
      setSaving(false);
      setTimeout(() => {
        setNotificationToast(null);
      }, 4500);
    }
  };

  return (
    <div className="flex flex-col min-h-full relative">

      {/* Floating Save Toast Notification */}
      {notificationToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 w-[90%] max-w-sm z-50 animate-bounce">
          <div className="rounded-2xl bg-slate-900 text-white p-3.5 shadow-xl flex items-center gap-2.5 border border-slate-700">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="flex-1 text-xs font-semibold leading-snug">
              {notificationToast}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-4 space-y-4 pb-36">
        {/* Error Alert */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-3 shadow-sm">
            <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <p className="font-bold">Failed to load students</p>
              <p className="mt-0.5 text-rose-700">{error}</p>
              <button
                onClick={fetchStudents}
                className="mt-2 font-bold underline text-rose-900 hover:text-rose-950"
              >
                Click here to retry
              </button>
            </div>
          </div>
        )}

        {/* Batch & Date Header Controls */}
        <AttendanceHeader
          batches={batchOptions}
          selectedBatchId={selectedBatchId}
          onSelectBatch={handleSelectBatch}
          selectedDate={todayFormatted || "Today"}
          presentCount={presentCount}
          absentCount={absentCount}
          unmarkedCount={unmarkedCount}
          onMarkAllPresent={handleMarkAllPresent}
        />

        {/* Attendance List Header */}
        <div className="flex items-center justify-between px-0.5 pt-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-bold text-slate-900 tracking-tight">
              Student Checklist ({currentBatchStudents.length})
            </h2>
            <span className="text-[11px] font-semibold text-slate-400">
              Tap P or A to toggle
            </span>
          </div>
          <button
            onClick={fetchStudents}
            className="tap-bounce text-slate-400 hover:text-slate-600 p-1"
            title="Reload students"
            aria-label="Reload students"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Loading Skeleton */}
        {loading ? (
          <div className="space-y-2.5 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-100 bg-white p-3.5 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-2xl bg-slate-200" />
                  <div className="space-y-1.5">
                    <div className="h-4 w-28 bg-slate-200 rounded" />
                    <div className="h-3 w-36 bg-slate-200 rounded" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-10 w-18 bg-slate-200 rounded-xl" />
                  <div className="h-10 w-18 bg-slate-200 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : currentBatchStudents.length > 0 ? (
          /* Student Checklist Rows */
          <div className="space-y-2.5">
            {currentBatchStudents.map((student) => {
              const status = attendanceMap[student.id] || "unmarked";
              return (
                <StudentAttendanceRow
                  key={student.id}
                  student={student}
                  status={status}
                  onToggleStatus={handleToggleStatus}
                />
              );
            })}
          </div>
        ) : (
          /* Empty State */
          <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-xs">
            <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-700">
              No students found in this batch
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Select another batch or enroll students in our center.
            </p>
          </div>
        )}
      </div>

      {/* Sticky Bottom Save Action Bar */}
      {currentBatchStudents.length > 0 && (
        <StickySaveBar
          presentCount={presentCount}
          absentCount={absentCount}
          unmarkedCount={unmarkedCount}
          onSave={handleSaveAndNotify}
          isSaved={isSaved}
        />
      )}
    </div>
  );
}
