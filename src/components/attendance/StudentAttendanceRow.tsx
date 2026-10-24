import { Check, X, Phone } from "lucide-react";
import { StudentAttendanceItem, AttendanceStatus } from "@/types";

interface StudentAttendanceRowProps {
  student: StudentAttendanceItem;
  status: AttendanceStatus;
  onToggleStatus: (studentId: string, status: AttendanceStatus) => void;
}

export default function StudentAttendanceRow({
  student,
  status,
  onToggleStatus,
}: StudentAttendanceRowProps) {
  const isAbsent = status === "absent";
  const isPresent = status === "present";

  return (
    <div
      className={`rounded-2xl border p-2.5 sm:p-3.5 transition-all duration-200 flex items-center justify-between gap-2 sm:gap-3 ${
        isAbsent
          ? "bg-rose-50/80 border-rose-200/90 shadow-2xs"
          : "bg-white border-slate-100 shadow-xs hover:border-slate-200"
      }`}
    >
      {/* Left: Initials Avatar + Student Details */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
        <div
          className={`h-9 w-9 sm:h-11 sm:w-11 flex-shrink-0 rounded-2xl flex items-center justify-center font-bold text-xs border shadow-2xs ${student.avatarColor}`}
        >
          {student.initials}
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[13px] sm:text-[14px] font-bold text-slate-900 tracking-tight truncate">
              {student.name}
            </h3>
            {isAbsent && (
              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-700 flex-shrink-0">
                Absent
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 text-[10px] sm:text-[11px] text-slate-500 truncate">
            <span className="font-semibold text-slate-600 flex-shrink-0">
              Roll #{student.rollNumber}
            </span>
            <span>•</span>
            <span
              className={`truncate ${
                student.attendanceRate < 90
                  ? "font-bold text-amber-600"
                  : "text-slate-500"
              }`}
            >
              {student.attendanceRate}% avg
            </span>
          </div>
        </div>
      </div>

      {/* Right: Large, Thumb-Friendly Toggle Buttons */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
        {/* Present Button */}
        <button
          type="button"
          onClick={() =>
            onToggleStatus(student.id, isPresent ? "unmarked" : "present")
          }
          aria-label={`Mark ${student.name} Present`}
          className={`tap-bounce h-9 sm:h-10 px-2 sm:px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-2xs ${
            isPresent
              ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 ring-1 ring-emerald-600 scale-[1.02]"
              : "bg-white text-slate-600 border border-slate-200 hover:border-emerald-400 hover:text-emerald-700 active:bg-emerald-50"
          }`}
        >
          <Check className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isPresent ? "stroke-[2.8]" : "stroke-[2]"}`} />
          <span className="hidden min-[370px]:inline">Present</span>
          <span className="min-[370px]:hidden font-extrabold text-[11px]">P</span>
        </button>

        {/* Absent Button */}
        <button
          type="button"
          onClick={() =>
            onToggleStatus(student.id, isAbsent ? "unmarked" : "absent")
          }
          aria-label={`Mark ${student.name} Absent`}
          className={`tap-bounce h-9 sm:h-10 px-2 sm:px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-2xs ${
            isAbsent
              ? "bg-rose-600 text-white shadow-sm shadow-rose-600/30 ring-1 ring-rose-600 scale-[1.02]"
              : "bg-white text-slate-600 border border-slate-200 hover:border-rose-400 hover:text-rose-700 active:bg-rose-50"
          }`}
        >
          <X className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isAbsent ? "stroke-[2.8]" : "stroke-[2]"}`} />
          <span className="hidden min-[370px]:inline">Absent</span>
          <span className="min-[370px]:hidden font-extrabold text-[11px]">A</span>
        </button>
      </div>
    </div>
  );
}
