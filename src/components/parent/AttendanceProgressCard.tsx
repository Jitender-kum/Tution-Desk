import { CalendarCheck2, CheckCircle2, AlertCircle } from "lucide-react";

interface AttendanceProgressCardProps {
  percentage: number;
  totalClasses: number;
  attended: number;
  missed: number;
}

export default function AttendanceProgressCard({
  percentage,
  totalClasses,
  attended,
  missed,
}: AttendanceProgressCardProps) {
  // SVG Circular progress math
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const isGoodStanding = percentage >= 85;

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4.5 shadow-sm space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
          <CalendarCheck2 className="h-4 w-4 text-[var(--primary-color)]" />
          Attendance Overview
        </h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold border ${
            isGoodStanding
              ? "bg-emerald-50 text-emerald-700 border-emerald-200/70"
              : "bg-amber-50 text-amber-800 border-amber-200/70"
          }`}
        >
          {isGoodStanding ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <AlertCircle className="h-3 w-3" />
          )}
          {isGoodStanding ? "Regular" : "Needs Attention"}
        </span>
      </div>

      {/* Circular Progress Ring + Stats Layout */}
      <div className="flex items-center gap-5 pt-1">
        {/* Circular Progress Indicator */}
        <div className="relative flex h-24 w-24 flex-shrink-0 items-center justify-center">
          <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 96 96">
            {/* Background Track */}
            <circle
              cx="48"
              cy="48"
              r={radius}
              className="text-slate-100"
              strokeWidth="8"
              stroke="currentColor"
              fill="transparent"
            />
            {/* Animated Progress Fill */}
            <circle
              cx="48"
              cy="48"
              r={radius}
              className={`transition-all duration-700 ${
                isGoodStanding ? "text-emerald-500" : "text-amber-500"
              }`}
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              stroke="currentColor"
              fill="transparent"
            />
          </svg>

          {/* Center Percentage Display */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xl font-extrabold text-slate-900 font-mono tracking-tight leading-none">
              {percentage}%
            </span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
              Overall
            </span>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div className="flex-1 space-y-2">
          <div>
            <div className="text-[13px] font-bold text-slate-800">
              {attended} of {totalClasses} Classes
            </div>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              Eligible for all weekly tests &amp; doubt clearing sessions.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {attended} Present
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              {missed} Absent
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
