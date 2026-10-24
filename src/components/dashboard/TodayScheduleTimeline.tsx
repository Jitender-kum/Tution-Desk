import Link from "next/link";
import { Clock, Users, ArrowRight } from "lucide-react";
import { QuickBatchAttendance } from "@/types";

interface TodayScheduleTimelineProps {
  batches: QuickBatchAttendance[];
}

export default function TodayScheduleTimeline({
  batches,
}: TodayScheduleTimelineProps) {
  const getStatusPill = (status: QuickBatchAttendance["timelineStatus"]) => {
    switch (status) {
      case "ongoing":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 shadow-2xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Ongoing
          </span>
        );
      case "upcoming":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
            Upcoming
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            Completed
          </span>
        );
    }
  };

  const getNodeStyle = (status: QuickBatchAttendance["timelineStatus"]) => {
    switch (status) {
      case "ongoing":
        return "bg-emerald-500 ring-4 ring-emerald-100";
      case "upcoming":
        return "bg-blue-500 ring-4 ring-blue-100";
      case "completed":
        return "bg-slate-300 ring-4 ring-slate-100";
    }
  };

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4.5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">
            Today&apos;s Schedule
          </h2>
          <p className="text-[12px] text-slate-500">
            Vertical batch timeline for today
          </p>
        </div>
        <Link
          href="/attendance"
          className="tap-bounce text-[12px] font-bold text-[var(--primary-color)] flex items-center gap-0.5 hover:underline"
        >
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Vertical Timeline Container */}
      {!batches || batches.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400">
          No scheduled batches for today.
        </div>
      ) : (
        <div className="relative pl-6 space-y-4">
          {batches.map((batch, index) => {
            const isLast = index === batches.length - 1;

            return (
              <div key={batch.id} className="relative group">
                {/* Vertical dotted connecting line on the left */}
                {!isLast && (
                  <div className="absolute -left-[19px] top-4 bottom-[-16px] w-[2px] border-l-2 border-dashed border-slate-300" />
                )}

                {/* Timeline Dot Node */}
                <div
                  className={`absolute -left-[24px] top-1.5 h-3 w-3 rounded-full transition-transform group-hover:scale-125 ${getNodeStyle(
                    batch.timelineStatus
                  )}`}
                />

                {/* Batch Card */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 transition-all hover:bg-slate-50 hover:shadow-xs">
                  {/* Top: Time & Status Pill */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>{batch.timeSlot}</span>
                    </div>
                    {getStatusPill(batch.timelineStatus)}
                  </div>

                  {/* Middle: Batch Title & Subject / Room */}
                  <div className="mt-2">
                    <h3 className="text-[14px] font-extrabold text-slate-900 tracking-tight">
                      {batch.batchName}
                    </h3>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      {batch.subject} •{" "}
                      <span className="font-semibold text-slate-600">
                        {batch.room || "Main Hall"}
                      </span>
                    </p>
                  </div>

                  {/* Bottom: Attendance status & Quick Action */}
                  <div className="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-2.5">
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
                      <Users className="h-3.5 w-3.5 text-slate-400" />
                      <span>
                        {batch.markedStudents}/{batch.totalStudents} Students Marked
                      </span>
                    </div>

                    {batch.timelineStatus === "ongoing" ? (
                      <Link
                        href={`/attendance?batch=${batch.id}`}
                        className="tap-bounce rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95"
                      >
                        Mark Live
                      </Link>
                    ) : batch.timelineStatus === "completed" ? (
                      <span className="text-[11px] font-bold text-slate-500">
                        Recorded ✓
                      </span>
                    ) : (
                      <Link
                        href={`/attendance?batch=${batch.id}`}
                        className="tap-bounce rounded-lg bg-[var(--primary-color)] px-3 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-[var(--primary-dark)] active:scale-95"
                      >
                        Pre-mark
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
