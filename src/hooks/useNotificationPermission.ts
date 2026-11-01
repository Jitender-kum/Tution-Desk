"use client";

import { useState, useEffect, useCallback } from "react";

export type NotificationPermissionState =
  | "default"
  | "granted"
  | "denied"
  | "unsupported";

export interface UseNotificationPermissionReturn {
  permission: NotificationPermissionState;
  isGranted: boolean;
  isSupported: boolean;
  mounted: boolean;
  requestPermission: () => Promise<NotificationPermissionState>;
}

/**
 * Safely evaluates window.Notification.permission without causing SSR hydration mismatches.
 * Ensures initial server render matches client initial render (isGranted = false until mounted).
 */
export function useNotificationPermission(): UseNotificationPermissionReturn {
  const [permission, setPermission] =
    useState<NotificationPermissionState>("default");
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined" && "Notification" in window) {
      setIsSupported(true);
      setPermission(window.Notification.permission as NotificationPermissionState);
    } else {
      setIsSupported(false);
      setPermission("unsupported");
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        const result = await window.Notification.requestPermission();
        const state = result as NotificationPermissionState;
        setPermission(state);
        return state;
      } catch (err) {
        console.error("Failed to request notification permission:", err);
        return "denied";
      }
    }
    return "unsupported";
  }, []);

  return {
    permission,
    isGranted: mounted && permission === "granted",
    isSupported,
    mounted,
    requestPermission,
  };
}
