import { HomeworkItem } from "@/types";
import { BookOpen, Calendar, CheckCircle2, MessageSquareText, Clock } from "lucide-react";

interface RecentHomeworkListProps {
  items: HomeworkItem[];
}

export default function RecentHomeworkList({ items }: RecentHomeworkListProps) {
  const getSubjectColor = (subject: string, status: string) => {
    if (status === "note") return "bg-purple-50 text-purple-700 border-purple-200";
    if (subject === "Mathematics") return "bg-blue-50 text-blue-700 border-blue-200";
    if (subject === "Science") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    return "bg-amber-50 text-amber-700 border-amber-200";
  };

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4.5 shadow-sm space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-[var(--primary-color)]" />
            Recent Homework &amp; Notes
          </h2>
          <p className="text-[11px] text-slate-500">
            Assigned tasks &amp; weekly teacher feedback
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
          {items.length} items
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {items.map((item) => {
          const isNote = item.status === "note";
          const isSubmitted = item.status === "submitted";

          return (
            <div key={item.id} className="py-3 space-y-1.5">
              {/* Top row: Subject Tag + Due Date / Status */}
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold border ${getSubjectColor(
                    item.subject,
                    item.status
                  )}`}
                >
                  {isNote ? (
                    <MessageSquareText className="h-2.5 w-2.5" />
                  ) : (
                    <BookOpen className="h-2.5 w-2.5" />
                  )}
                  {item.subject}
                </span>

                {isNote ? (
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
                    Teacher Note
                  </span>
                ) : isSubmitted ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Submitted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60">
                    <Clock className="h-2.5 w-2.5" /> Pending
                  </span>
                )}
              </div>

              {/* Title & Description */}
              <div>
                <h3 className="text-[13px] font-bold text-slate-900 leading-snug">
                  {item.title}
                </h3>
                <p className="text-[12px] text-slate-600 mt-0.5 leading-relaxed">
                  {item.description}
                </p>
              </div>

              {/* Teacher & Due Date Footer */}
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-0.5">
                <span>By: {item.teacherName}</span>
                <span className="flex items-center gap-1 font-semibold text-slate-600">
                  <Calendar className="h-2.5 w-2.5 text-slate-400" />
                  {item.dueDate}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
