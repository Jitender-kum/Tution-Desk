import Link from "next/link";
import {
  CalendarCheck,
  Send,
  ClipboardList,
  ChevronRight,
  Loader2,
} from "lucide-react";

interface QuickActionsProps {
  onSendFeeReminders?: () => void;
  isSendingReminders?: boolean;
  overdueCount?: number;
}

export default function QuickActions({
  onSendFeeReminders,
  isSendingReminders = false,
  overdueCount,
}: QuickActionsProps) {
  const actions = [
    {
      id: "attendance",
      title: "Mark Today's Attendance",
      subtitle: "Live batch roll-call & attendance",
      icon: CalendarCheck,
      href: "/attendance",
      bgColor: "bg-blue-600 active:bg-blue-700 shadow-md shadow-blue-600/20",
      iconBg: "bg-white/20",
      textColor: "text-white",
      subtextColor: "text-blue-100",
    },
    {
      id: "fees",
      title: isSendingReminders ? "Sending Reminders..." : "Send Fee Reminders",
      subtitle: isSendingReminders
        ? "Connecting to WhatsApp & dispatching..."
        : `${overdueCount ?? 0} overdue parents via 1-tap WhatsApp`,
      icon: isSendingReminders ? Loader2 : Send,
      href: "/fees",
      bgColor:
        "bg-orange-500 hover:bg-orange-600 active:bg-orange-700 shadow-md shadow-orange-500/20",
      iconBg: "bg-white/20",
      textColor: "text-white",
      subtextColor: "text-orange-100",
      isButton: Boolean(onSendFeeReminders),
      onClick: onSendFeeReminders,
    },
    {
      id: "tests",
      title: "Enter Test Marks",
      subtitle: "Classroom test marks & rankings",
      icon: ClipboardList,
      href: "/tests",
      bgColor: "bg-emerald-600 active:bg-emerald-700 shadow-md shadow-emerald-600/20",
      iconBg: "bg-white/20",
      textColor: "text-white",
      subtextColor: "text-emerald-100",
    },
  ];

  return (
    <div className="space-y-2.5">
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-500 px-0.5">
        Quick Actions
      </h2>

      <div className="space-y-2.5">
        {actions.map((act) => {
          const Icon = act.icon;

          if (act.isButton) {
            return (
              <button
                key={act.id}
                type="button"
                onClick={act.onClick}
                disabled={isSendingReminders}
                className={`tap-bounce flex w-full items-center justify-between rounded-2xl p-4 transition-transform text-left ${act.bgColor} disabled:opacity-75`}
              >
                {/* Left Side: Solid/Translucent Icon Container + Bold White Text */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl backdrop-blur-xs ${act.iconBg}`}
                  >
                    <Icon
                      className={`h-5 w-5 text-white ${
                        isSendingReminders && act.id === "fees"
                          ? "animate-spin"
                          : "stroke-[2.2]"
                      }`}
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span
                      className={`text-[15px] font-bold tracking-tight truncate leading-snug ${act.textColor}`}
                    >
                      {act.title}
                    </span>
                    <span
                      className={`text-[12px] font-medium truncate mt-0.5 ${act.subtextColor}`}
                    >
                      {act.subtitle}
                    </span>
                  </div>
                </div>

                {/* Right Side: Arrow (>) or Spinner */}
                <div className="flex-shrink-0 pl-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
                    {isSendingReminders && act.id === "fees" ? (
                      <Loader2 className="h-4 w-4 text-white animate-spin" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-white stroke-[2.5]" />
                    )}
                  </div>
                </div>
              </button>
            );
          }

          return (
            <Link
              key={act.id}
              href={act.href}
              className={`tap-bounce flex w-full items-center justify-between rounded-2xl p-4 transition-transform ${act.bgColor}`}
            >
              {/* Left Side: Solid/Translucent Icon Container + Bold White Text */}
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl backdrop-blur-xs ${act.iconBg}`}
                >
                  <Icon className="h-5 w-5 text-white stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span
                    className={`text-[15px] font-bold tracking-tight truncate leading-snug ${act.textColor}`}
                  >
                    {act.title}
                  </span>
                  <span
                    className={`text-[12px] font-medium truncate mt-0.5 ${act.subtextColor}`}
                  >
                    {act.subtitle}
                  </span>
                </div>
              </div>

              {/* Right Side: Arrow (>) */}
              <div className="flex-shrink-0 pl-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
                  <ChevronRight className="h-5 w-5 text-white stroke-[2.5]" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
