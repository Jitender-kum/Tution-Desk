import { ChevronDown, GraduationCap } from "lucide-react";
import { StudentTestProfile } from "@/types";

interface StudentSelectorCardProps {
  profiles: StudentTestProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
}

export default function StudentSelectorCard({
  profiles,
  selectedProfileId,
  onSelectProfile,
}: StudentSelectorCardProps) {
  const currentProfile =
    profiles.find((p) => p.id === selectedProfileId) || profiles[0];

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
          <GraduationCap className="h-3.5 w-3.5 text-blue-600" />
          Select Student
        </span>
        <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100/60">
          Roll #{currentProfile.rollNumber}
        </span>
      </div>

      {/* Styled Interactive Dropdown */}
      <div className="relative">
        <div className="flex items-center justify-between rounded-2xl border border-slate-200/90 bg-slate-50/70 p-3 shadow-2xs transition-all hover:bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center font-bold text-xs border shadow-2xs ${currentProfile.avatarColor}`}
            >
              {currentProfile.initials}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[14px] font-bold text-slate-900 truncate tracking-tight">
                {currentProfile.name}
              </span>
              <span className="text-[12px] font-medium text-slate-500 truncate">
                {currentProfile.batchName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 text-slate-500 pr-1 flex-shrink-0">
            <span className="text-xs font-semibold text-slate-400">Switch</span>
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>

        {/* Native mobile-friendly overlaid select */}
        <select
          value={selectedProfileId}
          onChange={(e) => onSelectProfile(e.target.value)}
          aria-label="Select student for test performance"
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.batchName} (Roll #{p.rollNumber})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
