"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Bell,
  LogOut,
  Loader2,
  Settings,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  ChevronRight,
  X,
} from "lucide-react";
import { useHeader } from "@/components/layout/HeaderContext";
import { getAuthenticatedCenter, clearCachedCenter } from "@/lib/centerProfile";

export interface TopHeaderProps {
  title?: string;
  subtitle?: string;
  badgeText?: string;
  showNotifications?: boolean;
  showLogout?: boolean;
}

interface AlertItem {
  id: string;
  type: "warning" | "error" | "info" | "success";
  title: string;
  message: string;
  link?: string;
  time: string;
}

const ROUTE_DEFAULTS: Record<
  string,
  { title?: string; subtitle: string; badgeText?: string }
> = {
  "/": {
    subtitle: "Classes 8th - 12th • CBSE & State",
    badgeText: "Owner",
  },
  "/attendance": {
    subtitle: "Daily Attendance Checklist",
    badgeText: "Owner",
  },
  "/fees": {
    title: "Fee Management",
    subtitle: "Pending Dues, Reviews & Paid History",
    badgeText: "Due",
  },
  "/tests": {
    subtitle: "Tests & Performance Management",
    badgeText: "Owner",
  },
  "/admissions": {
    subtitle: "Admissions & Student Management",
    badgeText: "Owner",
  },
};

function computeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return "TD";
}

export default function TopHeader(props: TopHeaderProps) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const headerContext = useHeader();
  const config = headerContext?.headerConfig || {};

  const isParentPortal =
    pathname.startsWith("/p/") || pathname === "/login" || pathname === "/parent";
  const isSettingsPage = pathname === "/settings";

  const routeDefault = ROUTE_DEFAULTS[pathname];

  const title = props.title ?? config.title ?? routeDefault?.title;
  const subtitle =
    props.subtitle ??
    config.subtitle ??
    routeDefault?.subtitle ??
    "Classes 8th - 12th • CBSE & State";
  const badgeText = props.badgeText ?? config.badgeText ?? routeDefault?.badgeText;
  const showNotifications =
    props.showNotifications ?? config.showNotifications ?? true;
  const showLogout = props.showLogout ?? config.showLogout ?? true;

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [centerName, setCenterName] = useState("Loading...");
  const [initials, setInitials] = useState("");

  // Notifications State
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 1. Fetch authenticated Center Profile (cached & deduplicated, skipped on public parent portal)
  useEffect(() => {
    if (isParentPortal) return;

    getAuthenticatedCenter()
      .then((center) => {
        if (center?.name) {
          const name = center.name;
          setCenterName(name);
          setInitials(computeInitials(name));
        } else {
          setCenterName("Tuition Center");
          setInitials("TC");
        }
      })
      .catch(() => {
        setCenterName("Tuition Center");
        setInitials("TC");
      });
  }, [isParentPortal]);

  // 2. Fetch Dynamic Smart Notifications (skipped on public parent portal)
  useEffect(() => {
    if (!showNotifications || isParentPortal) return;

    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.alerts)) {
          setAlerts(data.alerts);
          setUnreadCount(data.unreadCount ?? data.alerts.length);
        }
      })
      .catch(() => {});
  }, [showNotifications, isParentPortal]);

  // 3. Click-outside listener for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isDropdownOpen]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      clearCachedCenter();
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } catch {
      // ignore
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  // If in Settings, hide header without unmounting to retain state in memory
  if (isSettingsPage) {
    return <div className="hidden" aria-hidden="true" />;
  }

  const displayTitle =
    title &&
    title !== "Aroven Classes" &&
    title !== "Apex Tutorials" &&
    title !== "Aroven"
      ? title
      : centerName;

  const resolvedInitials =
    initials ||
    (displayTitle && displayTitle !== "Loading..."
      ? computeInitials(displayTitle)
      : "TD");

  return (
    <header className="sticky top-0 z-40 glass-surface border-b border-slate-200/80 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* Brand Avatar / Dynamic Center Initials */}
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-color)] text-white flex items-center justify-center font-bold text-sm shadow-sm shadow-blue-500/20 ring-2 ring-blue-100 flex-shrink-0">
          {resolvedInitials || (
            <span className="w-3.5 h-3.5 rounded-full bg-white/40 animate-pulse" />
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="font-bold text-slate-900 text-[15px] truncate leading-tight">
              {displayTitle === "Loading..." ? (
                <span className="inline-block w-24 h-4 bg-slate-200 rounded animate-pulse" />
              ) : (
                displayTitle
              )}
            </h1>
            {badgeText && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--primary-light)] text-[var(--primary-color)]">
                {badgeText}
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-500 truncate leading-tight mt-0.5">
            {subtitle}
          </p>
        </div>
      </div>

      {!isParentPortal && (
        <div className="flex items-center gap-2 relative" ref={dropdownRef}>
          <Link
            href="/settings"
            aria-label="Settings & WhatsApp"
            title="WhatsApp Integration & Settings"
            className="tap-bounce w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:border-slate-300 shadow-xs transition-colors"
          >
            <Settings className="w-4 h-4 stroke-[2]" />
          </Link>

          {showNotifications && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                aria-label="Notifications"
                aria-expanded={isDropdownOpen}
                className={`tap-bounce relative w-9 h-9 rounded-xl border flex items-center justify-center transition-all shadow-xs ${
                  isDropdownOpen
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                <Bell className="w-4 h-4 stroke-[2]" />

                {/* Dynamic Red Dot Badge if unread alerts exist */}
                {alerts.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-black text-white ring-2 ring-white animate-pulse">
                    {unreadCount > 0 ? unreadCount : alerts.length}
                  </span>
                )}
              </button>

              {/* Smart Notifications Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute right-0 top-11 w-[calc(100vw-2rem)] max-w-xs sm:max-w-none sm:w-88 rounded-3xl border border-slate-200/90 bg-white p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                  {/* Dropdown Header */}
                  <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-extrabold text-slate-900">
                        Center Alerts
                      </span>
                      {alerts.length > 0 && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 border border-rose-200/60">
                          {alerts.length} New
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(false)}
                      className="h-6 w-6 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Alerts List */}
                  <div className="max-h-80 overflow-y-auto no-scrollbar divide-y divide-slate-100 pt-1">
                    {alerts.length === 0 ? (
                      <div className="py-6 text-center space-y-1.5">
                        <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <p className="text-xs font-bold text-slate-800">
                          All Caught Up!
                        </p>
                        <p className="text-[11px] text-slate-400">
                          No pending alerts or urgent notices.
                        </p>
                      </div>
                    ) : (
                      alerts.map((alert) => {
                        const isWarning = alert.type === "warning";
                        const isError = alert.type === "error";
                        const isSuccess = alert.type === "success";

                        const iconBg = isError
                          ? "bg-rose-50 text-rose-600 border-rose-200"
                          : isWarning
                          ? "bg-amber-50 text-amber-600 border-amber-200"
                          : isSuccess
                          ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                          : "bg-blue-50 text-blue-600 border-blue-200";

                        const Icon = isError
                          ? AlertCircle
                          : isWarning
                          ? AlertTriangle
                          : isSuccess
                          ? CheckCircle2
                          : Info;

                        const content = (
                          <div className="flex items-start gap-2.5 p-2 rounded-2xl hover:bg-slate-50 transition-colors cursor-pointer group">
                            <div
                              className={`h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 border shadow-2xs mt-0.5 ${iconBg}`}
                            >
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <h4 className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                                  {alert.title}
                                </h4>
                                <span className="text-[10px] text-slate-400 font-medium flex-shrink-0">
                                  {alert.time}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                                {alert.message}
                              </p>
                            </div>
                            {alert.link && (
                              <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-600 self-center flex-shrink-0" />
                            )}
                          </div>
                        );

                        if (alert.link) {
                          return (
                            <Link
                              key={alert.id}
                              href={alert.link}
                              onClick={() => setIsDropdownOpen(false)}
                            >
                              {content}
                            </Link>
                          );
                        }

                        return <div key={alert.id}>{content}</div>;
                      })
                    )}
                  </div>

                  {/* Dropdown Footer */}
                  {alerts.length > 0 && (
                    <div className="border-t border-slate-100 pt-2 px-1 text-center">
                      <button
                        type="button"
                        onClick={() => setAlerts([])}
                        className="text-[11px] font-bold text-slate-400 hover:text-slate-600"
                      >
                        Clear all notifications
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showLogout && (
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              aria-label="Sign out"
              title="Sign out of TuitionDesk"
              className="tap-bounce w-9 h-9 rounded-xl bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 flex items-center justify-center text-slate-500 hover:text-rose-600 shadow-xs transition-colors"
            >
              {isLoggingOut ? (
                <Loader2 className="w-4 h-4 animate-spin text-rose-600" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
