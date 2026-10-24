import { Users, Layers, ClipboardCheck } from "lucide-react";
import { DashboardMetrics } from "@/types";

interface StatsRowProps {
  metrics: DashboardMetrics;
}

export default function StatsRow({ metrics }: StatsRowProps) {
  const stats = [
    {
      id: "students",
      label: "Total Students",
      value: metrics.totalActiveStudents,
      icon: Users,
      iconBg: "bg-blue-50 text-blue-600 border-blue-100/80",
    },
    {
      id: "batches",
      label: "Total Batches",
      value: metrics.totalBatchesToday,
      icon: Layers,
      iconBg: "bg-emerald-50 text-emerald-600 border-emerald-100/80",
    },
    {
      id: "tests",
      label: "Pending Tests",
      value: metrics.pendingTestsCount,
      icon: ClipboardCheck,
      iconBg: "bg-amber-50 text-amber-600 border-amber-100/80",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.id}
            className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
          >
            {/* Top row: Small Icon */}
            <div className="flex items-center justify-between">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-xl border shadow-2xs ${stat.iconBg}`}
              >
                <Icon className="h-3.5 w-3.5 stroke-[2.2]" />
              </div>
            </div>

            {/* Bottom row: Value & Label */}
            <div className="mt-2.5">
              <div className="text-xl font-extrabold tracking-tight text-slate-900 font-mono leading-none">
                {stat.value}
              </div>
              <p className="mt-1 text-[11px] font-semibold text-slate-500 leading-tight line-clamp-1">
                {stat.label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
