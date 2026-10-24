import { Send, CheckCircle2 } from "lucide-react";

interface StickySaveBarProps {
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
  onSave: () => void;
  isSaved: boolean;
}

export default function StickySaveBar({
  presentCount,
  absentCount,
  unmarkedCount,
  onSave,
  isSaved,
}: StickySaveBarProps) {
  return (
    <div
      className="fixed bottom-16 sm:bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-md sm:max-w-2xl md:max-w-4xl lg:max-w-5xl px-4 py-2.5 glass-surface border-t border-slate-200/80 z-40 shadow-[0_-4px_16px_rgba(0,0,0,0.05)]"
      style={{ bottom: "64px" }}
    >
      <button
        type="button"
        onClick={onSave}
        disabled={isSaved}
        className={`tap-bounce w-full h-12 rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 transition-all shadow-md ${
          isSaved
            ? "bg-emerald-600 text-white shadow-emerald-600/30 cursor-default"
            : "bg-[var(--primary-color)] hover:bg-[var(--primary-dark)] active:scale-[0.98] text-white shadow-blue-600/25"
        }`}
      >
        {isSaved ? (
          <>
            <CheckCircle2 className="h-5 w-5 stroke-[2.4]" />
            <span>Attendance Saved &amp; Parents Notified!</span>
          </>
        ) : (
          <>
            <Send className="h-4 w-4 stroke-[2.3]" />
            <span>Save &amp; Notify Parents</span>
            {absentCount > 0 && (
              <span className="ml-1 text-[11px] bg-white/20 px-2 py-0.5 rounded-full font-semibold">
                {absentCount} {absentCount === 1 ? "Absentee" : "Absentees"}
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}
