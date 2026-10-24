import { IndianRupee, CheckCircle2, UserPlus, Award } from "lucide-react";
import { RecentActivityItem } from "@/types";

interface RecentActivityCardProps {
  activities: RecentActivityItem[];
}

export default function RecentActivityCard({
  activities,
}: RecentActivityCardProps) {
  const getIcon = (type: RecentActivityItem["type"]) => {
    switch (type) {
      case "fee":
        return <IndianRupee className="w-4 h-4 text-emerald-600" />;
      case "attendance":
        return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      case "enquiry":
        return <UserPlus className="w-4 h-4 text-purple-600" />;
      case "test":
        return <Award className="w-4 h-4 text-amber-600" />;
    }
  };

  const getBg = (type: RecentActivityItem["type"]) => {
    switch (type) {
      case "fee":
        return "bg-emerald-50 border-emerald-100 text-emerald-600";
      case "attendance":
        return "bg-blue-50 border-blue-100 text-blue-600";
      case "enquiry":
        return "bg-purple-50 border-purple-100 text-purple-600";
      case "test":
        return "bg-amber-50 border-amber-100 text-amber-600";
    }
  };

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4.5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">
          Recent Activity
        </h2>
        <span className="text-[11px] font-semibold text-slate-400">
          Live stream
        </span>
      </div>

      {!activities || activities.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          No recent activity to display yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {activities.map((item) => (
            <div key={item.id} className="py-3 flex items-center gap-3">
              <div
                className={`h-9 w-9 rounded-2xl flex items-center justify-center border shadow-2xs flex-shrink-0 ${getBg(
                  item.type
                )}`}
              >
                {getIcon(item.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-bold text-slate-800 truncate">
                    {item.title}
                  </p>
                  {item.amount && (
                    <span className="text-[12px] font-extrabold text-emerald-600 font-mono">
                      +₹{item.amount.toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-[11px] text-slate-500 truncate">
                    {item.subtitle}
                  </p>
                  <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap pl-2">
                    {item.time}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
