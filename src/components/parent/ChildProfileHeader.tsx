import { HeartHandshake, ShieldCheck, User } from "lucide-react";

interface ChildProfileHeaderProps {
  childName: string;
  batchName: string;
  rollNumber: string;
  initials: string;
  avatarColor: string;
}

export default function ChildProfileHeader({
  childName,
  batchName,
  rollNumber,
  initials,
  avatarColor,
}: ChildProfileHeaderProps) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4.5 shadow-sm space-y-3">
      {/* Top Banner Row */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <HeartHandshake className="h-3.5 w-3.5 text-blue-600" />
          Parent Portal
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-100/70">
          <ShieldCheck className="h-3 w-3 stroke-[2.3]" />
          Verified Enrollment
        </span>
      </div>

      {/* Child Profile Information */}
      <div className="flex items-center gap-3.5 pt-1">
        <div
          className={`h-13 w-13 flex-shrink-0 rounded-2xl flex items-center justify-center font-extrabold text-base border-2 shadow-sm ${avatarColor}`}
        >
          {initials}
        </div>

        <div className="flex flex-col min-w-0">
          <h1 className="text-lg font-extrabold text-slate-900 tracking-tight leading-tight truncate">
            {childName}&apos;s Progress
          </h1>
          <p className="text-[12px] font-medium text-slate-500 truncate mt-0.5">
            {batchName}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-block text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.2 rounded-md">
              Roll #{rollNumber}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              Academic Year 2026-27
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
