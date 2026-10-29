"use client";

import { usePathname } from "next/navigation";
import BottomNav from "@/components/layout/BottomNav";
import TopHeader from "@/components/layout/TopHeader";
import { HeaderProvider } from "@/components/layout/HeaderContext";

interface NavigationWrapperProps {
  children: React.ReactNode;
}

export default function NavigationWrapper({
  children,
}: NavigationWrapperProps) {
  const pathname = usePathname();
  const isAuthOrParentPage =
    pathname === "/login" || pathname.startsWith("/p/");

  // Auth & Parent Magic Link pages: Render standalone minimal screen without navigation
  if (isAuthOrParentPage) {
    return <main className="w-full min-h-screen bg-gray-50">{children}</main>;
  }

  // Full App Layout: Persistent TopHeader + main content + BottomNav
  return (
    <HeaderProvider>
      <div className="w-full max-w-md sm:max-w-2xl md:max-w-4xl lg:max-w-5xl min-h-screen bg-[var(--bg-app)] flex flex-col relative shadow-xl border-x border-slate-200/60 pb-20">
        <TopHeader />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <BottomNav />
      </div>
    </HeaderProvider>
  );
}
