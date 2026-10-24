"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCheck,
  IndianRupee,
  BarChart3,
  Users,
} from "lucide-react";

interface TabItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

const TABS: TabItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    id: "attendance",
    label: "Attendance",
    href: "/attendance",
    icon: CalendarCheck,
  },
  {
    id: "fees",
    label: "Fees",
    href: "/fees",
    icon: IndianRupee,
    badge: "3",
  },
  {
    id: "tests",
    label: "Tests",
    href: "/tests",
    icon: BarChart3,
  },
  {
    id: "admissions",
    label: "Admissions",
    href: "/admissions",
    icon: Users,
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      id="mobile-bottom-nav"
      aria-label="Main Navigation"
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md sm:max-w-2xl md:max-w-4xl lg:max-w-5xl glass-surface border-t border-slate-200/80 px-2 sm:px-6 pt-1.5 pb-2.5 z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]"
    >
      <div className="grid grid-cols-5 gap-1 items-center">
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`tap-bounce relative flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all duration-200 group ${
                isActive
                  ? "text-[var(--primary-color)]"
                  : "text-slate-400 hover:text-slate-600 active:text-slate-800"
              }`}
            >
              {/* Active subtle pill glow */}
              {isActive && (
                <span className="absolute inset-0 bg-[var(--primary-light)] rounded-xl -z-10 animate-fade-in" />
              )}

              {/* Icon Container with Badge */}
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-5 h-5 transition-transform duration-200 ${
                    isActive ? "scale-110 stroke-[2.4]" : "stroke-[1.8]"
                  }`}
                />

                {tab.badge && (
                  <span className="absolute -top-1 -right-2.5 bg-rose-500 text-white text-[10px] font-bold h-4 min-w-[16px] px-1 rounded-full flex items-center justify-center shadow-xs ring-1 ring-white">
                    {tab.badge}
                  </span>
                )}
              </div>

              {/* Label */}
              <span
                className={`text-[11px] mt-1 leading-none tracking-tight transition-all ${
                  isActive ? "font-bold text-[var(--primary-color)]" : "font-medium"
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
