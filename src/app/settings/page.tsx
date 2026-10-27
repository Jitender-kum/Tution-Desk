"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  CheckCircle2,
  QrCode,
  Wifi,
  WifiOff,
  RefreshCw,
  Send,
  Smartphone,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  Clock,
  MessageSquare,
  Activity,
  Server,
  Zap,
  LogOut,
  Building2,
  FileText,
  Save,
  CreditCard,
  IndianRupee,
  X,
} from "lucide-react";
import { getCurrentCenterId } from "@/lib/apiClient";

interface MicroserviceStatus {
  status: "connected" | "qr_ready" | "disconnected" | "initializing" | "loading";
  qr: string | null;
  qrGeneratedAt?: number | null;
  ready: boolean;
  service?: string;
  timestamp?: string;
  error?: string;
}

export default function SettingsPage() {
  const [centerId, setCenterId] = useState<string>("");
  const [statusData, setStatusData] = useState<MicroserviceStatus>({
    status: "loading",
    qr: null,
    ready: false,
  });
  const [isOffline, setIsOffline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const lastQrTimestampRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Track mount state and abort any active polling/fetch on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Periodically refresh current time while QR is displayed to keep freshness counter live
  useEffect(() => {
    if (statusData.status !== "qr_ready") return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 3000);
    return () => clearInterval(interval);
  }, [statusData.status]);

  const isLocalEnv =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  // Quick test message state
  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Messaging Templates state (Task 3)
  const [welcomeMessageTemplate, setWelcomeMessageTemplate] = useState<string>(
    "Welcome to our center! 🎉\n\nDear Parent, your child {{studentName}} has been successfully enrolled.\nTrack their daily attendance, view performance, and pay fees seamlessly using your personalized VIP portal:\n🔗 {{magicLink}}\n\nNo app installation required."
  );
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveStatus, setTemplateSaveStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // UPI Payment Settings State
  const [upiId, setUpiId] = useState<string>("");
  const [confirmUpiId, setConfirmUpiId] = useState<string>("");
  const [upiSaving, setUpiSaving] = useState(false);
  const [upiSaveStatus, setUpiSaveStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // 1. Resolve current owner centerId
  useEffect(() => {
    const localId = getCurrentCenterId();
    if (localId) {
      setCenterId(localId);
    }

    // Verify against authenticated user session
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.center?.centerId) {
          setCenterId(data.center.centerId);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch center settings (welcomeMessageTemplate & upiId) when centerId is resolved
  useEffect(() => {
    if (!centerId) return;

    fetch("/api/centers/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.data?.welcomeMessageTemplate) {
          setWelcomeMessageTemplate(data.data.welcomeMessageTemplate);
        }
        if (data?.data?.upiId !== undefined) {
          const loadedUpi = data.data.upiId || "";
          setUpiId(loadedUpi);
          setConfirmUpiId(loadedUpi);
        }
      })
      .catch((err) => {
        console.warn("Could not fetch welcome template or upiId:", err);
      });
  }, [centerId]);

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId) return;

    setTemplateSaving(true);
    setTemplateSaveStatus(null);

    try {
      const res = await fetch("/api/centers/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          welcomeMessageTemplate,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setTemplateSaveStatus({
          type: "success",
          message:
            "Messaging template saved successfully! New admissions will receive this customized message.",
        });
      } else {
        throw new Error(data?.error || "Failed to save template.");
      }
    } catch (err: unknown) {
      setTemplateSaveStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save template.",
      });
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleSaveUpiId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId) return;

    setUpiSaving(true);
    setUpiSaveStatus(null);

    try {
      const res = await fetch("/api/centers/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upiId: upiId.trim(),
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setUpiSaveStatus({
          type: "success",
          message:
            "Receiving UPI ID saved successfully! Parents will now pay and scan directly to this VPA.",
        });
      } else {
        throw new Error(data?.error || "Failed to save UPI ID.");
      }
    } catch (err: unknown) {
      setUpiSaveStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save UPI ID.",
      });
    } finally {
      setUpiSaving(false);
    }
  };

  const handleInsertPlaceholder = (placeholder: string) => {
    setWelcomeMessageTemplate((prev) => {
      if (prev.includes(placeholder)) return prev;
      return `${prev} ${placeholder}`;
    });
  };

  // 2. Poll center-specific status: http://localhost:3005/status/:centerId
  const fetchStatus = useCallback(
    async (isManualTrigger = false) => {
      if (!centerId || !isMountedRef.current) return;

      // Prevent overlapping status requests unless manually requested
      if (isFetchingRef.current && !isManualTrigger) {
        return;
      }

      // Abort any prior in-flight request before launching new one
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingRef.current = true;

      try {
        const res = await fetch("/api/whatsapp/status", {
          cache: "no-store",
          signal: controller.signal,
        });

        const data = await res.json().catch(() => null);

        if (!isMountedRef.current) return;

        if (!res.ok) {
          throw new Error(data?.error || `HTTP error ${res.status}`);
        }

        let resolvedStatus:
          | "connected"
          | "qr_ready"
          | "disconnected"
          | "initializing" = "disconnected";

        if (data?.status === "connected" || data?.ready === true) {
          resolvedStatus = "connected";
          setIsInitializing(false);
          setIsRegenerating(false);
        } else if (data?.status === "qr_ready" && data?.qr) {
          // Prevent stale in-flight polling responses from overwriting a newer QR
          if (
            data.qrGeneratedAt &&
            lastQrTimestampRef.current &&
            data.qrGeneratedAt < lastQrTimestampRef.current
          ) {
            return;
          }
          if (data.qrGeneratedAt) {
            lastQrTimestampRef.current = data.qrGeneratedAt;
          }
          resolvedStatus = "qr_ready";
          setIsInitializing(false);
          setIsRegenerating(false);
        } else if (data?.status === "initializing") {
          resolvedStatus = "initializing";
        } else if (data?.status) {
          resolvedStatus = data.status;
          setIsInitializing(false);
          setIsRegenerating(false);
        } else {
          setIsInitializing(false);
          setIsRegenerating(false);
        }

        setStatusData({
          status: resolvedStatus,
          qr: data?.qr || null,
          qrGeneratedAt: data?.qrGeneratedAt || null,
          ready: Boolean(data?.ready || resolvedStatus === "connected"),
          service: data?.service,
          timestamp: data?.timestamp,
          error: data?.error || undefined,
        });
        setIsOffline(false);
        setLastPolled(new Date());
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") {
          // Clean abortion on component unmount or newer request, do not update state
          return;
        }
        setIsOffline(true);
        setIsInitializing(false);
        setIsRegenerating(false);
        setStatusData((prev) => ({
          ...prev,
          status: "disconnected",
          qr: null,
          qrGeneratedAt: null,
          ready: false,
          error:
            err instanceof Error
              ? err.message
              : "WhatsApp service is currently unreachable",
        }));
        setLastPolled(new Date());
      } finally {
        isFetchingRef.current = false;
      }
    },
    [centerId]
  );

  // Initial status fetch once centerId is resolved
  useEffect(() => {
    if (!centerId) return;
    fetchStatus(true);
  }, [centerId, fetchStatus]);

  // Chained adaptive polling loop:
  // - Polls every 3s while initializing or awaiting QR code scan (qr_ready)
  // - Polls every 15s when connected (keep-alive heartbeat)
  // - Halts polling when disconnected (unless actively initializing) or when an error occurred
  useEffect(() => {
    if (!centerId) return;

    let isEffectActive = true;

    // If an error occurred or session is disconnected while not actively pairing, do not poll
    if (
      statusData.error ||
      (statusData.status === "disconnected" && !isInitializing && !isRegenerating)
    ) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      return () => {
        isEffectActive = false;
      };
    }

    const pollIntervalMs =
      isInitializing ||
      isRegenerating ||
      statusData.status === "initializing" ||
      statusData.status === "qr_ready"
        ? 3000
        : statusData.status === "connected"
        ? 15000
        : null;

    if (!pollIntervalMs) return;

    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      if (!isEffectActive || !isMountedRef.current) return;
      await fetchStatus();
    }, pollIntervalMs);

    return () => {
      isEffectActive = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [
    centerId,
    fetchStatus,
    isInitializing,
    isRegenerating,
    statusData.status,
    statusData.error,
  ]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchStatus(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Explicitly generate fresh QR code for this center
  const generateQRCode = async () => {
    if (!centerId || isInitializing || isRegenerating) return;
    setIsInitializing(true);
    try {
      const res = await fetch("/api/whatsapp/init", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          data?.error || `Failed to initialize: HTTP ${res.status}`
        );
      }
      // Immediate poll to pick up updated status from server
      await fetchStatus(true);
    } catch (err: unknown) {
      console.error("Failed to generate QR code:", err);
      setIsInitializing(false);
      setStatusData((prev) => ({
        ...prev,
        error:
          err instanceof Error
            ? err.message
            : "Failed to initialize WhatsApp service",
      }));
    }
  };

  // Safe reconnect and fresh QR generation for unlinked session
  const handleRegenerateQR = async () => {
    if (!centerId || isRegenerating || isInitializing) return;
    setIsRegenerating(true);
    try {
      const res = await fetch("/api/whatsapp/reconnect", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data?.error || `Failed to regenerate QR: HTTP ${res.status}`
        );
      }

      // If backend already has new QR, update state
      if (data?.qr) {
        if (data.qrGeneratedAt) {
          lastQrTimestampRef.current = data.qrGeneratedAt;
        }
        setStatusData((prev) => ({
          ...prev,
          status: "qr_ready",
          qr: data.qr,
          qrGeneratedAt: data.qrGeneratedAt || Date.now(),
          ready: false,
          error: undefined,
        }));
        setIsRegenerating(false);
      } else {
        // Awaiting fresh QR generation from newly spawned client
        setStatusData((prev) => ({
          ...prev,
          status: "initializing",
          error: undefined,
        }));
      }

      setIsInitializing(true);
      await fetchStatus(true);
    } catch (err: unknown) {
      console.error("Failed to regenerate QR code:", err);
      setIsRegenerating(false);
      setStatusData((prev) => ({
        ...prev,
        error:
          err instanceof Error
            ? err.message
            : "Failed to regenerate WhatsApp QR code",
      }));
    }
  };

  // Cancel QR pairing and return to disconnected overview without deleting credentials
  const handleCancelQR = () => {
    setIsInitializing(false);
    setIsRegenerating(false);
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setStatusData((prev) => ({
      ...prev,
      status: "disconnected",
      qr: null,
      qrGeneratedAt: null,
      ready: false,
      error: undefined,
    }));
  };

  // Disconnect & Relink WhatsApp button
  const handleDisconnectAndRelink = async () => {
    if (!centerId) return;
    setIsDisconnecting(true);
    try {
      // 1. Call proxy logout for this center
      await fetch("/api/whatsapp/logout", {
        method: "POST",
      });

      // 2. Clear local status so owner can explicitly generate QR
      setStatusData({
        status: "disconnected",
        qr: null,
        ready: false,
      });
      setIsInitializing(false);

      // 3. Re-poll status
      await fetchStatus();
    } catch (err) {
      console.error("Failed to disconnect WhatsApp:", err);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone || testPhone.length < 10) {
      setTestResult({
        type: "error",
        message: "Please enter a valid 10-digit WhatsApp phone number.",
      });
      return;
    }

    setTestSending(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/whatsapp/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: testPhone,
          message: `👋 Hello from our center WhatsApp Automation!\n\nYour center's dedicated WhatsApp engine (Center: ${centerId}) is configured and running smoothly. System timestamp: ${new Date().toLocaleTimeString(
            "en-IN"
          )}`,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setTestResult({
          type: "success",
          message: `✅ Test ping sent successfully to +91 ${testPhone}!`,
        });
        setTestPhone("");
      } else {
        setTestResult({
          type: "error",
          message:
            data?.error ||
            "Failed to send test message. Check if WhatsApp is linked.",
        });
      }
    } catch (err: unknown) {
      setTestResult({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Could not reach WhatsApp microservice.",
      });
    } finally {
      setTestSending(false);
    }
  };

  const isConnected = statusData.status === "connected" || statusData.ready;
  const isQrReady = statusData.status === "qr_ready" && Boolean(statusData.qr);
  const isInitState = isInitializing || statusData.status === "initializing";

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 px-4 sm:px-6 py-6 pb-36 animate-fade-in">
      {/* Top Header / Breadcrumb */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3.5">
          <Link
            href="/"
            className="tap-bounce w-10 h-10 rounded-2xl bg-white border border-slate-200/90 flex items-center justify-center text-slate-600 hover:text-slate-900 shadow-xs hover:border-slate-300 transition-all"
            title="Return to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Settings &amp; Integrations
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                MULTI-TENANT
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Dedicated WhatsApp Engine for Center:{" "}
              <strong className="text-slate-700 font-mono">
                {centerId || "Loading..."}
              </strong>
            </p>
          </div>
        </div>

        {/* Polling heartbeat indicator */}
        <button
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="tap-bounce flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:border-slate-300 shadow-xs transition-all disabled:opacity-50"
          title="Manual refresh status"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-slate-400 ${
              isRefreshing ? "animate-spin text-blue-600" : ""
            }`}
          />
          <span>{isRefreshing ? "Checking..." : "Refresh Status"}</span>
        </button>
      </div>

      {/* Real-time Status Banner Card */}
      <div className="glass-card p-5 sm:p-6 rounded-3xl border border-slate-200/90 shadow-sm relative overflow-hidden backdrop-blur-md">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs transition-all ${
                isConnected
                  ? "bg-emerald-500 text-white shadow-emerald-500/20 ring-4 ring-emerald-50"
                  : isQrReady
                  ? "bg-amber-500 text-white shadow-amber-500/20 ring-4 ring-amber-50"
                  : isInitState
                  ? "bg-blue-600 text-white shadow-blue-500/20 ring-4 ring-blue-50"
                  : isOffline
                  ? "bg-rose-100 text-rose-600 ring-4 ring-rose-50"
                  : "bg-slate-200 text-slate-600 ring-4 ring-slate-100"
              }`}
            >
              {isConnected ? (
                <Wifi className="w-6 h-6 animate-pulse" />
              ) : isQrReady ? (
                <QrCode className="w-6 h-6" />
              ) : isInitState ? (
                <RefreshCw className="w-6 h-6 animate-spin" />
              ) : (
                <WifiOff className="w-6 h-6" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  WhatsApp Automation Engine
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wide uppercase ${
                    isConnected
                      ? "bg-emerald-100 text-emerald-800"
                      : isQrReady
                      ? "bg-amber-100 text-amber-800 animate-pulse"
                      : isInitState
                      ? "bg-blue-100 text-blue-800 animate-pulse"
                      : isOffline
                      ? "bg-rose-100 text-rose-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isConnected
                        ? "bg-emerald-500 animate-pulse"
                        : isQrReady
                        ? "bg-amber-500"
                        : isInitState
                        ? "bg-blue-500 animate-pulse"
                        : isOffline
                        ? "bg-rose-500"
                        : "bg-slate-400"
                    }`}
                  />
                  {isConnected
                    ? "Active & Connected"
                    : isQrReady
                    ? "Awaiting QR Scan"
                    : isInitState
                    ? "Generating QR..."
                    : isOffline
                    ? "Microservice Offline"
                    : "Disconnected"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {lastPolled
                    ? `Polled at ${lastPolled.toLocaleTimeString("en-IN")}`
                    : "Connecting to microservice..."}
                </span>
                <span className="text-slate-300">•</span>
                <span className="flex items-center gap-1 font-mono text-[11px]">
                  <Server className="w-3 h-3 text-slate-400" />
                  session-{centerId || "default"}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Content based on State */}

      {/* 1. CONNECTED STATE */}
      {isConnected && (
        <div className="flex flex-col gap-6">
          <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-white/90 border-2 border-emerald-500/30 shadow-md shadow-emerald-500/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-36 h-36 bg-emerald-400/15 rounded-full blur-2xl -z-10" />

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/25 flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="text-lg sm:text-xl font-black text-emerald-950 tracking-tight">
                  WhatsApp Engine is Active and Connected
                </h3>
                <p className="text-xs sm:text-sm text-emerald-800/90 leading-relaxed font-medium">
                  Your tuition center’s WhatsApp business account is paired and
                  active. Student admission welcomes, fee reminders, and test
                  results will be dispatched exclusively from this number.
                </p>
              </div>
            </div>

            {/* Microservice Specs Row */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 border-t border-emerald-200/60">
              <div className="bg-white/90 backdrop-blur-xs p-3 rounded-2xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Session Mode
                </span>
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1 mt-1 truncate">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  LocalAuth Isolated
                </span>
              </div>
              <div className="bg-white/90 backdrop-blur-xs p-3 rounded-2xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Center Client
                </span>
                <span className="text-xs font-bold text-slate-800 mt-1 font-mono truncate block">
                  {centerId}
                </span>
              </div>
              <div className="bg-white/90 backdrop-blur-xs p-3 rounded-2xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Microservice Port
                </span>
                <span className="text-xs font-bold text-slate-800 mt-1 font-mono block">
                  :3005
                </span>
              </div>
              <div className="bg-white/90 backdrop-blur-xs p-3 rounded-2xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Status Health
                </span>
                <span className="text-xs font-extrabold text-emerald-700 mt-1 flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-emerald-600" />
                  Live &amp; Ready
                </span>
              </div>
            </div>

            {/* Disconnect & Relink Button */}
            <div className="mt-5 pt-4 border-t border-emerald-200/60 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-emerald-900 font-medium">
                <Building2 className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" />
                <span>
                  Scoped to Center:{" "}
                  <code className="font-mono font-bold bg-white/70 px-2 py-0.5 rounded-md border border-emerald-200">
                    {centerId}
                  </code>
                </span>
              </div>

              <button
                type="button"
                onClick={handleDisconnectAndRelink}
                disabled={isDisconnecting}
                className="tap-bounce flex items-center gap-2 px-4 py-2 w-auto flex-shrink-0 rounded-xl border border-rose-300 hover:border-rose-400 bg-white hover:bg-rose-50 text-rose-600 font-bold text-xs transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
                title="Disconnect this WhatsApp number and scan a new QR code"
              >
                {isDisconnecting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                ) : (
                  <LogOut className="w-3.5 h-3.5 text-rose-600" />
                )}
                <span>
                  {isDisconnecting
                    ? "Disconnecting..."
                    : "Disconnect & Relink WhatsApp"}
                </span>
              </button>
            </div>
          </div>

          {/* Quick Test Message Tool */}
          <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 stroke-[2.2]" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-slate-900">
                    Send a Live Test Message
                  </h4>
                  <p className="text-xs text-slate-500">
                    Verify this center’s WhatsApp dispatch by sending a test
                    ping to any mobile number.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                Live Center Gateway
              </span>
            </div>

            <form onSubmit={handleSendTestMessage} className="w-full">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full mt-2">
                <div className="relative flex-1 w-full min-w-0">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none select-none">
                    +91
                  </span>
                  <input
                    type="tel"
                    maxLength={10}
                    value={testPhone}
                    onChange={(e) =>
                      setTestPhone(e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="Enter 10-digit mobile number"
                    className="w-full pl-11 pr-3.5 py-2.5 text-xs sm:text-sm rounded-2xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-blue-100 focus:border-blue-600 transition-all font-mono font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal"
                  />
                </div>
                <button
                  type="submit"
                  disabled={testSending || testPhone.length < 10}
                  className="tap-bounce h-10 sm:h-11 px-4 sm:px-6 w-full sm:w-auto flex-shrink-0 whitespace-nowrap rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] text-white text-xs font-bold flex items-center justify-center gap-1.5 sm:gap-2 shadow-md shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  {testSending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5 stroke-[2.2]" />
                      <span>Send Test Ping</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {testResult && (
              <div
                className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 animate-fade-in ${
                  testResult.type === "success"
                    ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                    : "bg-rose-50 text-rose-900 border border-rose-200"
                }`}
              >
                {testResult.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
                )}
                <span className="font-semibold leading-relaxed">
                  {testResult.message}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. QR READY STATE - USER SCANS QR CODE IN UI */}
      {isQrReady && statusData.qr && (
        <div className="glass-card p-7 rounded-3xl border border-amber-200/80 shadow-md bg-gradient-to-b from-amber-50/40 via-white to-white space-y-6">
          <div className="text-center max-w-md mx-auto space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
              <QrCode className="w-3.5 h-3.5" />
              Pair Center: {centerId}
            </div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">
              Scan QR Code to Connect WhatsApp
            </h3>
            <p className="text-xs text-slate-500">
              Point your phone’s camera at this QR code to connect your
              coaching center’s WhatsApp number.
            </p>
          </div>

          {/* QR Code Presentation */}
          <div className="flex flex-col items-center justify-center">
            <div className="p-6 bg-white rounded-3xl shadow-lg shadow-slate-200/60 border-2 border-slate-200/80 relative">
              <QRCodeSVG
                value={statusData.qr}
                size={240}
                level="M"
                includeMargin={true}
              />
              <div className="mt-3 flex flex-col items-center justify-center gap-1 text-[11px] text-slate-500 font-semibold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span>
                    Live QR Code
                    {statusData.qrGeneratedAt && (
                      <span className="text-slate-400 font-normal">
                        {" "}• Generated{" "}
                        {Math.max(
                          0,
                          Math.floor(
                            (currentTime - statusData.qrGeneratedAt) / 1000
                          )
                        ) < 5
                          ? "just now"
                          : `${Math.max(
                              0,
                              Math.floor(
                                (currentTime - statusData.qrGeneratedAt) / 1000
                              )
                            )}s ago`}
                      </span>
                    )}
                  </span>
                </div>
                {statusData.qrGeneratedAt &&
                  Math.floor(
                    (currentTime - statusData.qrGeneratedAt) / 1000
                  ) > 50 && (
                    <span className="text-[10px] text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/80">
                      If scanning shows &quot;Could not link&quot;, click Regenerate below.
                    </span>
                  )}
              </div>
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80 space-y-3 max-w-md mx-auto">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-blue-600" />
              How to Link:
            </h4>
            <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside pl-1 leading-relaxed">
              <li>
                Open <strong className="text-slate-800">WhatsApp</strong> on
                your phone.
              </li>
              <li>
                Tap <strong className="text-slate-800">Settings</strong> (iOS)
                or the <strong className="text-slate-800">Three Dots</strong>{" "}
                (Android).
              </li>
              <li>
                Select{" "}
                <strong className="text-slate-800">Linked Devices</strong>, then
                tap{" "}
                <strong className="text-slate-800">Link a Device</strong>.
              </li>
              <li>Point your camera at this QR code to complete pairing.</li>
            </ol>
          </div>

          {/* Action Buttons: Regenerate QR Code & Cancel */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleRegenerateQR}
              disabled={isRegenerating || isInitializing}
              className="tap-bounce inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white text-xs font-bold transition-all shadow-md shadow-amber-500/20 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRegenerating ? "animate-spin" : ""
                }`}
              />
              <span>
                {isRegenerating
                  ? "Regenerating QR Code..."
                  : "Regenerate QR Code"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleCancelQR}
              disabled={isRegenerating}
              className="tap-bounce inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. DISCONNECTED / MICROSERVICE OFFLINE STATE */}
      {!isConnected && !isQrReady && (
        <div className="glass-card p-8 rounded-3xl border border-slate-200 shadow-sm space-y-5 text-center">
          {isOffline ? (
            /* Show offline UI. If in local development, provide the terminal command. If in production, provide a production-aware message and status error. */
            <>
              <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto shadow-inner border border-rose-100">
                <WifiOff className="w-7 h-7 stroke-[1.8]" />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <h3 className="text-lg font-black text-slate-900 tracking-tight">
                  WhatsApp Engine is Offline
                </h3>
                {isLocalEnv ? (
                  <p className="text-xs text-slate-500 leading-relaxed font-medium">
                    The WhatsApp microservice on port 3005 is not responding. If
                    not running, please start it in your terminal:
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed font-medium">
                    The cloud WhatsApp service is temporarily unreachable or
                    restarting. Please wait a moment and check status again.
                  </p>
                )}
              </div>

              {isLocalEnv ? (
                <div className="p-4 bg-slate-900 text-slate-200 rounded-2xl font-mono text-xs max-w-sm mx-auto text-left shadow-inner">
                  <p className="text-slate-400 text-[10px] mb-1 font-semibold uppercase tracking-wider">
                    # Terminal command:
                  </p>
                  <code className="text-emerald-400">cd whatsapp-server</code>
                  <br />
                  <code className="text-blue-300">node index.js</code>
                </div>
              ) : statusData.error ? (
                <div className="p-3 bg-rose-50/80 border border-rose-100 text-rose-700 rounded-2xl text-xs max-w-md mx-auto">
                  <p className="font-semibold">{statusData.error}</p>
                </div>
              ) : null}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="tap-bounce inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all shadow-2xs disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isRefreshing ? "animate-spin text-blue-600" : ""
                    }`}
                  />
                  <span>Check Status Again</span>
                </button>
              </div>
            </>
          ) : (
            /* Microservice is responding but status is disconnected or null */
            <>
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner border border-blue-100">
                <QrCode className="w-7 h-7 stroke-[1.8]" />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <h3 className="text-lg font-black text-slate-900 tracking-tight">
                  Link Center WhatsApp Account
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  Your WhatsApp automation engine is ready. Generate a fresh QR
                  code to pair your coaching center’s WhatsApp business account.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={generateQRCode}
                  disabled={isInitState}
                  className="tap-bounce inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-blue-500/25 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                >
                  {isInitState ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Generating Secure QR...</span>
                    </>
                  ) : (
                    <>
                      <QrCode className="w-4 h-4 stroke-[2.2]" />
                      <span>Generate QR Code to Link WhatsApp</span>
                    </>
                  )}
                </button>
              </div>

              {statusData.error && (
                <div className="p-3.5 rounded-2xl bg-rose-50 text-rose-800 text-xs font-medium max-w-md mx-auto border border-rose-200 flex items-center gap-2 text-left">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
                  <span className="leading-relaxed">{statusData.error}</span>
                </div>
              )}

              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="tap-bounce inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${
                      isRefreshing ? "animate-spin text-blue-600" : ""
                    }`}
                  />
                  <span>Refresh Status</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 4. MESSAGING TEMPLATES SECTION (Task 3) */}
      <div className="glass-card p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-sm space-y-5 bg-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                Messaging Templates
              </h3>
              <p className="text-xs text-slate-500">
                Customize automated WhatsApp notification messages sent to parents.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
            Admission Welcome
          </span>
        </div>

        <form onSubmit={handleSaveTemplate} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <label
                htmlFor="welcome-template"
                className="text-xs font-bold text-slate-700 uppercase tracking-wider block"
              >
                Student Admission Welcome Template
              </label>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>Click to insert:</span>
                <button
                  type="button"
                  onClick={() => handleInsertPlaceholder("{{studentName}}")}
                  className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-blue-600 font-mono font-bold text-[10px] transition-colors"
                  title="Insert student name placeholder"
                >
                  {"{{studentName}}"}
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertPlaceholder("{{magicLink}}")}
                  className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-blue-600 font-mono font-bold text-[10px] transition-colors"
                  title="Insert VIP Parent portal link placeholder"
                >
                  {"{{magicLink}}"}
                </button>
              </div>
            </div>

            <textarea
              id="welcome-template"
              rows={6}
              value={welcomeMessageTemplate}
              onChange={(e) => {
                setWelcomeMessageTemplate(e.target.value);
                if (templateSaveStatus) setTemplateSaveStatus(null);
              }}
              placeholder="Enter custom welcome message template..."
              className="w-full p-3.5 text-xs sm:text-sm rounded-2xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-blue-100 focus:border-blue-600 font-mono transition-all text-slate-900 leading-relaxed resize-y"
            />

            <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5 leading-relaxed">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span>
                Use <code>{"{{studentName}}"}</code> and <code>{"{{magicLink}}"}</code> as placeholders. The system will auto-replace them.
              </span>
            </p>
          </div>

          {/* Live Preview Box */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Live Preview (Parent View)
            </span>
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-sans shadow-2xs leading-relaxed">
              {welcomeMessageTemplate
                ? welcomeMessageTemplate
                    .replace(/\{\{studentName\}\}/g, "Aarav Sharma")
                    .replace(
                      /\{\{magicLink\}\}/g,
                      "http://localhost:3000/p/sample-id"
                    )
                : "No template provided."}
            </div>
          </div>

          {templateSaveStatus && (
            <div
              className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 animate-fade-in ${
                templateSaveStatus.type === "success"
                  ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                  : "bg-rose-50 text-rose-900 border border-rose-200"
              }`}
            >
              {templateSaveStatus.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
              )}
              <span className="font-semibold leading-relaxed">
                {templateSaveStatus.message}
              </span>
            </div>
          )}

          <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end w-full">
            <button
              type="submit"
              disabled={templateSaving || !welcomeMessageTemplate.trim()}
              className="tap-bounce h-11 px-6 w-auto flex-shrink-0 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {templateSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Template...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Save Template</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* 5. PAYMENT SETUP SECTION (Task 1: Fail-Safe Double Confirmation) */}
      <div className="glass-card p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-sm space-y-5 bg-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
              <CreditCard className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                Payment Setup (UPI Gateway)
              </h3>
              <p className="text-xs text-slate-500">
                Configure your tuition center’s receiving UPI ID / VPA with fail-safe double confirmation.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
            <IndianRupee className="w-3 h-3" />
            Zero MDR Gateway
          </span>
        </div>

        {(() => {
          const isUpiMatch = Boolean(
            upiId.trim() &&
            confirmUpiId.trim() &&
            upiId.trim() === confirmUpiId.trim()
          );
          const isUpiMismatch = Boolean(
            confirmUpiId.trim() &&
            upiId.trim() !== confirmUpiId.trim()
          );

          return (
            <form onSubmit={handleSaveUpiId} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Field 1: Enter UPI ID */}
                <div>
                  <label
                    htmlFor="center-upi-id"
                    className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5"
                  >
                    Enter UPI ID
                  </label>
                  <div className="relative">
                    <input
                      id="center-upi-id"
                      type="text"
                      value={upiId}
                      onChange={(e) => {
                        setUpiId(e.target.value.trim());
                        if (upiSaveStatus) setUpiSaveStatus(null);
                      }}
                      placeholder="e.g. 9876543210@paytm"
                      className="w-full px-4 py-3 text-sm rounded-2xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-emerald-100 focus:border-emerald-600 font-mono font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal transition-all"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Primary receiving Virtual Payment Address (VPA)
                  </p>
                </div>

                {/* Field 2: Confirm UPI ID */}
                <div>
                  <label
                    htmlFor="center-confirm-upi-id"
                    className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5"
                  >
                    Confirm UPI ID
                  </label>
                  <div className="relative">
                    <input
                      id="center-confirm-upi-id"
                      type="text"
                      value={confirmUpiId}
                      onChange={(e) => {
                        setConfirmUpiId(e.target.value.trim());
                        if (upiSaveStatus) setUpiSaveStatus(null);
                      }}
                      placeholder="Re-enter UPI ID exactly"
                      className={`w-full px-4 py-3 text-sm rounded-2xl border font-mono font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal transition-all focus:outline-hidden focus:ring-4 ${
                        isUpiMismatch
                          ? "border-rose-400 bg-rose-50/40 focus:ring-rose-100 focus:border-rose-500"
                          : isUpiMatch
                          ? "border-emerald-400 bg-emerald-50/30 focus:ring-emerald-100 focus:border-emerald-600"
                          : "border-slate-200 bg-slate-50/50 focus:bg-white focus:ring-emerald-100 focus:border-emerald-600"
                      }`}
                    />
                  </div>

                  {/* Match Feedback */}
                  {isUpiMismatch ? (
                    <p className="text-[11px] text-rose-600 font-bold mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                      UPI IDs do not match. Please verify carefully to prevent wrong transfers.
                    </p>
                  ) : isUpiMatch ? (
                    <p className="text-[11px] text-emerald-700 font-bold mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      UPI IDs match verified! Ready to save.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Re-type the exact same UPI ID to prevent typo errors
                    </p>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-slate-600 flex items-start gap-2 leading-relaxed bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Fail-Safe Protection:</strong> Both input fields must match character-by-character before saving. This prevents irreversible tuition fee deposits being routed to mistyped bank accounts.
                </span>
              </div>

              {upiSaveStatus && (
                <div
                  className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 animate-fade-in ${
                    upiSaveStatus.type === "success"
                      ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                      : "bg-rose-50 text-rose-900 border border-rose-200"
                  }`}
                >
                  {upiSaveStatus.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
                  )}
                  <span className="font-semibold leading-relaxed">
                    {upiSaveStatus.message}
                  </span>
                </div>
              )}

              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end w-full">
                <button
                  type="submit"
                  disabled={upiSaving || !isUpiMatch}
                  className="tap-bounce h-11 px-6 w-auto flex-shrink-0 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  {upiSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Payment Setup...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 stroke-[2.2]" />
                      <span>Save Payment Setup</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          );
        })()}
      </div>

      {/* Automations Showcase Section */}
      <div className="space-y-3.5 pt-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Active Automation Workflows
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Card 1 */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-blue-200 hover:shadow-xs transition-all space-y-2">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">
              🎉
            </div>
            <h4 className="text-xs font-bold text-slate-900">
              Admission Welcome
            </h4>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Fires instantly when adding a new student. Sends the unique VIP
              Parent Portal magic link.
            </p>
          </div>

          {/* Card 2 */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-emerald-200 hover:shadow-xs transition-all space-y-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm">
              💰
            </div>
            <h4 className="text-xs font-bold text-slate-900">Fee Reminders</h4>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Recurring automated reminders for pending tuition fees with
              amount, due date, and pay links.
            </p>
          </div>

          {/* Card 3 */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-purple-200 hover:shadow-xs transition-all space-y-2">
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-sm">
              📊
            </div>
            <h4 className="text-xs font-bold text-slate-900">
              Test Mark Reports
            </h4>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Dispatches scores, rank analysis, and encouraging remarks to
              parents after tests are entered.
            </p>
          </div>
        </div>
      </div>

      {/* Privacy & Security Guarantee Note */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-xs font-bold text-slate-800">
            End-to-End Encrypted &amp; Multi-Tenant Isolated
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            WhatsApp session credentials are kept strictly in your local
            microservice directory (<code>.wwebjs_auth/session-{centerId}</code>).
            Each center operates on its own dedicated browser session.
          </p>
        </div>
      </div>
    </div>
  );
}
