"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export interface HeaderConfig {
  title?: string;
  subtitle?: string;
  badgeText?: string;
  showNotifications?: boolean;
  showLogout?: boolean;
}

interface HeaderContextType {
  headerConfig: HeaderConfig;
  setHeaderConfig: React.Dispatch<React.SetStateAction<HeaderConfig>>;
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined);

export function HeaderProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [headerConfig, setHeaderConfig] = useState<HeaderConfig>({});
  const prevPathname = useRef(pathname);

  // Clear page-specific header overrides whenever the user navigates to a new route
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      setHeaderConfig({});
    }
  }, [pathname]);

  return (
    <HeaderContext.Provider value={{ headerConfig, setHeaderConfig }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  return useContext(HeaderContext);
}

/**
 * Hook enabling any page or view to dynamically customize the persistent TopHeader.
 */
export function useSetHeader(config: HeaderConfig) {
  const context = useContext(HeaderContext);
  const setHeaderConfig = context?.setHeaderConfig;

  useEffect(() => {
    if (!setHeaderConfig) return;
    setHeaderConfig((prev) => {
      if (
        prev.title === config.title &&
        prev.subtitle === config.subtitle &&
        prev.badgeText === config.badgeText &&
        prev.showNotifications === config.showNotifications &&
        prev.showLogout === config.showLogout
      ) {
        return prev;
      }
      return {
        ...prev,
        ...config,
      };
    });
  }, [
    setHeaderConfig,
    config.title,
    config.subtitle,
    config.badgeText,
    config.showNotifications,
    config.showLogout,
  ]);
}
