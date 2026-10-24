import { AlertCircle, TrendingUp, Users } from "lucide-react";

interface FeesSummaryHeroCardProps {
  totalOverdueAmount: number;
  pendingStudentsCount: number;
  collectedAmount: number;
}

export default function FeesSummaryHeroCard({
  totalOverdueAmount,
  pendingStudentsCount,
  collectedAmount,
}: FeesSummaryHeroCardProps) {
  const formatINR = (val: number) => val.toLocaleString("en-IN");
  const totalDemand = (totalOverdueAmount || 0) + (collectedAmount || 0);
  const collectionRate =
    totalDemand > 0 ? Math.round(((collectedAmount || 0) / totalDemand) * 100) : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-600 via-orange-500 to-amber-500 p-5 text-white shadow-lg shadow-orange-500/25">
      {/* Decorative ambient glass glows */}
      <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/15 blur-xl pointer-events-none" />
      <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-rose-800/20 blur-lg pointer-events-none" />

      {/* Top Header Row */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-orange-100">
          <AlertCircle className="h-4 w-4 text-orange-200 stroke-[2.3]" />
          <span className="text-[12px] font-bold uppercase tracking-wider">
            Total Overdue
          </span>
        </div>

        {/* Top-Right Semi-Transparent Glass Pill */}
        <div className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/20 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-md shadow-xs">
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          <span>{pendingStudentsCount} Students Due</span>
        </div>
      </div>

      {/* Main ₹ Amount with Bold Typography */}
      <div className="relative z-10 my-3.5">
        <div className="text-4xl font-extrabold tracking-tight text-white font-mono drop-shadow-xs">
          ₹{formatINR(totalOverdueAmount)}
        </div>
        <p className="mt-1 text-[12px] text-orange-100 font-medium">
          Requires follow-up • Class 9th, 10th &amp; 12th batches
        </p>
      </div>

      {/* Sub-Card: Collection Ratio & Progress */}
      <div className="relative z-10 rounded-2xl bg-white/15 p-3 backdrop-blur-sm border border-white/20">
        <div className="flex items-center justify-between text-xs text-white">
          <span className="flex items-center gap-1 text-orange-100 font-medium">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-200" />
            Collected: ₹{formatINR(collectedAmount)}
          </span>
          <span className="font-extrabold text-white font-mono">
            {collectionRate}% Recovered
          </span>
        </div>

        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/20">
          <div
            className="h-full rounded-full bg-white transition-all duration-500 shadow-xs"
            style={{ width: `${collectionRate}%` }}
          />
        </div>
      </div>
    </div>
  );
}
