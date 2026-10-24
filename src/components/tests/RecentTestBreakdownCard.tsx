import { TestScoreItem } from "@/types";
import { CheckCircle2, ChevronRight } from "lucide-react";

interface RecentTestBreakdownCardProps {
  tests: TestScoreItem[];
}

export default function RecentTestBreakdownCard({
  tests,
}: RecentTestBreakdownCardProps) {
  // Show most recent first
  const reversed = [...tests].reverse();

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-bold text-slate-900 tracking-tight">
          Test History &amp; Breakdown
        </h3>
        <span className="text-[11px] font-semibold text-slate-400">
          Last 6 Tests
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {reversed.map((t) => {
          const percent = Math.round((t.score / t.totalMarks) * 100);
          const isDistinction = percent >= 80;

          return (
            <div
              key={t.id}
              className="py-2.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="h-8 w-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs font-mono flex-shrink-0">
                  {t.testCode}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-800 truncate leading-tight">
                    {t.testName}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {t.date} • {t.subject}
                  </p>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <div className="text-[14px] font-extrabold text-slate-900 font-mono">
                  {t.score}/{t.totalMarks}
                </div>
                <span
                  className={`inline-block text-[10px] font-bold px-1.5 py-0.2 rounded ${
                    isDistinction
                      ? "text-emerald-700 bg-emerald-50"
                      : "text-blue-700 bg-blue-50"
                  }`}
                >
                  {percent}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
