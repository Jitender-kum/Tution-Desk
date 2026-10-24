import Link from "next/link";
import { AlertCircle, ArrowUpRight, TrendingUp } from "lucide-react";
import { DashboardMetrics } from "@/types";

interface PendingFeesHeroCardProps {
  metrics: DashboardMetrics;
}

export default function PendingFeesHeroCard({
  metrics,
}: PendingFeesHeroCardProps) {
  const formatINR = (val: number) => val.toLocaleString("en-IN");

  const totalFeeDemand =
    (metrics.collectedFeesThisMonth || 0) + (metrics.pendingFeesTotal || 0);
  const collectedPercentage =
    totalFeeDemand > 0
      ? Math.round(((metrics.collectedFeesThisMonth || 0) / totalFeeDemand) * 100)
      : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-blue-500 to-blue-400 p-5 text-white shadow-lg shadow-blue-500/25">
      {/* Decorative ambient background accents */}
      <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/10 blur-xl pointer-events-none" />
      <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-blue-700/30 blur-lg pointer-events-none" />

      {/* Top Header Row */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-blue-100">
          <AlertCircle className="h-4 w-4 text-blue-200" />
          <span className="text-[12px] font-bold uppercase tracking-wider">
            Pending Fees
          </span>
        </div>

        {/* Top-Right Semi-Transparent Pill */}
        <div className="flex items-center gap-1 rounded-full border border-white/25 bg-white/20 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
          {metrics.overdueCount ?? 0} Overdue
        </div>
      </div>

      {/* Main ₹ Amount with Large White Typography */}
      <div className="relative z-10 my-3">
        <div className="flex items-baseline">
          <span className="text-4xl font-extrabold tracking-tight text-white font-mono drop-shadow-xs">
            ₹{formatINR(metrics.pendingFeesTotal)}
          </span>
        </div>
        <p className="mt-1 text-[12px] text-blue-100 font-medium">
          Due across Class 10 & 12 batches this month
        </p>
      </div>

      {/* Bottom Sub-stats: Collected amount & progress bar */}
      <div className="relative z-10 mt-4 rounded-2xl bg-white/15 p-3 backdrop-blur-sm border border-white/15">
        <div className="flex items-center justify-between text-xs text-white">
          <span className="flex items-center gap-1 text-blue-100">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
            Collected so far:
          </span>
          <span className="font-bold text-white font-mono">
            ₹{formatINR(metrics.collectedFeesThisMonth)} ({collectedPercentage}%)
          </span>
        </div>

        {/* Minimalist Progress Track */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/20">
          <div
            className="h-full rounded-full bg-white transition-all duration-500 shadow-xs"
            style={{ width: `${collectedPercentage}%` }}
          />
        </div>
      </div>

      {/* Quick link to Fees screen */}
      <div className="relative z-10 mt-3 flex items-center justify-between text-xs">
        <span className="text-blue-100/90 text-[11px]">
          Target: 100% recovery by 28th
        </span>
        <Link
          href="/fees"
          className="tap-bounce inline-flex items-center gap-1 font-bold text-white hover:text-blue-100"
        >
          View Overdue List <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
