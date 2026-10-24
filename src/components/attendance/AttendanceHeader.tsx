import { Calendar, ChevronDown, CheckCheck, Users } from "lucide-react";
import { QuickBatchAttendance } from "@/types";

interface AttendanceHeaderProps {
  batches: QuickBatchAttendance[];
  selectedBatchId: string;
  onSelectBatch: (id: string) => void;
  selectedDate: string;
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
  onMarkAllPresent: () => void;
}

export default function AttendanceHeader({
  batches,
  selectedBatchId,
  onSelectBatch,
  selectedDate,
  presentCount,
  absentCount,
  unmarkedCount,
  onMarkAllPresent,
}: AttendanceHeaderProps) {
  const currentBatch =
    batches.find((b) => b.id === selectedBatchId) || batches[0];

  return (
    <div className="space-y-3">
      {/* Batch Selector & Date Picker Bar */}
      <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm space-y-3">
        {/* Top: Batch Selector Dropdown */}
        <div>
          <label
            htmlFor="batch-selector"
            className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5"
          >
            Select Batch
          </label>
          <div className="relative">
            <select
              id="batch-selector"
              value={selectedBatchId}
              onChange={(e) => onSelectBatch(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-slate-200/90 bg-slate-50/70 px-3.5 py-2.5 pr-10 text-[13px] font-bold text-slate-800 shadow-2xs outline-none focus:border-[var(--primary-color)] focus:bg-white transition-all cursor-pointer"
            >
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batchName} ({batch.timeSlot})
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500">
              <ChevronDown className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Date Row + Quick 'Mark All Present' CTA */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100/80 px-2.5 py-1.5 rounded-xl border border-slate-200/60">
            <Calendar className="h-3.5 w-3.5 text-blue-600" />
            <span>{selectedDate}</span>
          </div>

          <button
            type="button"
            onClick={onMarkAllPresent}
            className="tap-bounce inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 px-2.5 py-1.5 rounded-xl transition-colors shadow-2xs"
          >
            <CheckCheck className="h-3.5 w-3.5 stroke-[2.5]" />
            Mark All Present
          </button>
        </div>
      </div>

      {/* Live Counter Badges Pill */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-2.5 text-center shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
            Present
          </span>
          <span className="text-lg font-extrabold text-emerald-700 font-mono">
            {presentCount}
          </span>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-2.5 text-center shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block">
            Absent
          </span>
          <span className="text-lg font-extrabold text-rose-700 font-mono">
            {absentCount}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5 text-center shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Unmarked
          </span>
          <span className="text-lg font-extrabold text-slate-700 font-mono">
            {unmarkedCount}
          </span>
        </div>
      </div>
    </div>
  );
}
