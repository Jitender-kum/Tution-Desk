import { TrendingUp, TrendingDown, Trophy, Award } from "lucide-react";
import { StudentTestProfile } from "@/types";

interface PerformanceOverviewCardsProps {
  profile: StudentTestProfile;
}

export default function PerformanceOverviewCards({
  profile,
}: PerformanceOverviewCardsProps) {
  const isPositiveTrend = profile.trendPercentage >= 0;

  // Format rank with ordinal suffix: 1st, 2nd, 3rd, 4th...
  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* 1. Latest Test Score Card */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Latest Score
          </span>

          {/* Subtle Green/Red Trend Arrow */}
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-extrabold border ${
              isPositiveTrend
                ? "bg-emerald-50 text-emerald-700 border-emerald-200/70"
                : "bg-rose-50 text-rose-700 border-rose-200/70"
            }`}
          >
            {isPositiveTrend ? (
              <TrendingUp className="h-3 w-3 stroke-[2.5]" />
            ) : (
              <TrendingDown className="h-3 w-3 stroke-[2.5]" />
            )}
            {isPositiveTrend ? `+${profile.trendPercentage}%` : `${profile.trendPercentage}%`}
          </span>
        </div>

        <div className="my-2">
          <div className="text-2xl font-extrabold tracking-tight text-slate-900 font-mono">
            {profile.latestScore}
            <span className="text-sm font-bold text-slate-400 ml-1">
              /{profile.latestTotal}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500 truncate">
            {profile.tests[profile.tests.length - 1]?.testName || "Latest Exam"}
          </p>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] font-semibold text-slate-400">
          <span>Passing: 40/100</span>
          <span className="text-emerald-600 font-bold">Passed (A)</span>
        </div>
      </div>

      {/* 2. Current Batch Rank Card with Small Trophy / Medal Icon */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Batch Rank
          </span>

          {/* Trophy Icon Badge */}
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-600 border border-amber-200/60 shadow-2xs">
            <Trophy className="h-3.5 w-3.5 stroke-[2.3]" />
          </div>
        </div>

        <div className="my-2">
          <div className="text-2xl font-extrabold tracking-tight text-slate-900 font-mono">
            {getOrdinal(profile.currentRank)}
            <span className="text-sm font-bold text-slate-400 ml-1">
              /{profile.totalBatchStudents}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
            Top {Math.round((profile.currentRank / profile.totalBatchStudents) * 100)}% in class
          </p>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] font-semibold text-slate-400">
          <span>Batch Size: 30</span>
          <span className="text-purple-600 font-bold">Percentile 87</span>
        </div>
      </div>
    </div>
  );
}
