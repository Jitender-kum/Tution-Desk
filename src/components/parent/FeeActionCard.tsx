"use client";

import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle,
  QrCode,
  CheckCircle2,
  ShieldCheck,
  X,
  Smartphone,
  ExternalLink,
  Clock,
  Loader2,
  Copy,
  Check,
  Sparkles,
  CreditCard,
  IndianRupee,
} from "lucide-react";

interface FeeActionCardProps {
  feeId?: string | null;
  studentId?: string;
  centerId?: string;
  amount: number;
  dueDate: string;
  daysLate: number;
  upiId: string;
  centerName?: string;
  status?: "Pending" | "Paid" | "Verification Pending";
  utrNumber?: string;
  onPaymentSuccess?: () => void;
  onUtrSubmitted?: (utr: string) => void;
  onAdvancePaymentSuccess?: () => void;
  isPaid?: boolean;
}

const QUICK_ADVANCE_AMOUNTS = [1000, 2000, 3000, 5000];

export default function FeeActionCard({
  feeId,
  studentId,
  centerId,
  amount,
  dueDate,
  daysLate,
  upiId = "9876543210@paytm",
  centerName = "Tuition Center",
  status = "Pending",
  utrNumber: initialUtr = "",
  onPaymentSuccess,
  onUtrSubmitted,
  onAdvancePaymentSuccess,
  isPaid = false,
}: FeeActionCardProps) {
  // Regular Payment Modal States
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<
    "Pending" | "Paid" | "Verification Pending"
  >(isPaid ? "Paid" : status);
  const [utrInput, setUtrInput] = useState("");
  const [savedUtr, setSavedUtr] = useState(initialUtr);
  const [submittingUtr, setSubmittingUtr] = useState(false);
  const [utrError, setUtrError] = useState<string | null>(null);
  const [copiedVpa, setCopiedVpa] = useState(false);

  // Real-Time Polling & Buried Fallback States (Regular Payment)
  const [regularPaymentSuccess, setRegularPaymentSuccess] = useState(false);
  const [regularDelayedButtonVisible, setRegularDelayedButtonVisible] = useState(false);
  const [showManualUtrInput, setShowManualUtrInput] = useState(false);

  // Pre-flight Payment Gateway Health Check (Cold-Start Fix for Render deployment)
  const [gatewayPinging, setGatewayPinging] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  const pingServer = async (): Promise<boolean> => {
    const rawGatewayUrl =
      process.env.NEXT_PUBLIC_PAYMENT_GATEWAY_URL ||
      process.env.NEXT_PUBLIC_YOUPI_URL ||
      (typeof window !== "undefined" && window.location.hostname === "localhost"
        ? "http://localhost:6100"
        : "");

    const targetUrl = rawGatewayUrl
      ? `${rawGatewayUrl.replace(/\/+$/, "")}/health`
      : "/api/health";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const res = await fetch(targetUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);
      return res.status === 200;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  };

  const handlePayFees = async () => {
    if (gatewayPinging) return;
    setGatewayError(null);
    setGatewayPinging(true);

    try {
      const isAlive = await pingServer();
      if (isAlive) {
        setRegularPaymentSuccess(false);
        setShowUpiModal(true);
      } else {
        setGatewayError("Server temporarily busy, please try after some time.");
      }
    } catch {
      setGatewayError("Server temporarily busy, please try after some time.");
    } finally {
      setGatewayPinging(false);
    }
  };

  // Advance Payment Modal States
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceAmountInput, setAdvanceAmountInput] = useState<string>("3000");
  const [createdAdvanceFee, setCreatedAdvanceFee] = useState<{
    _id: string;
    amountDue: number;
  } | null>(null);
  const [advanceCreating, setAdvanceCreating] = useState(false);
  const [advancePaymentSuccess, setAdvancePaymentSuccess] = useState(false);
  const [advanceDelayedButtonVisible, setAdvanceDelayedButtonVisible] = useState(false);
  const [showAdvanceManualUtrInput, setShowAdvanceManualUtrInput] = useState(false);
  const [advanceUtrInput, setAdvanceUtrInput] = useState("");
  const [submittingAdvanceUtr, setSubmittingAdvanceUtr] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // Target UPI ID
  const targetUpiId = upiId || "9876543210@paytm";

  // Construct regular payment UPI Intent Deep-Link with Transaction Note
  const customRef = `FEE-${(feeId || "").toString().slice(-6)}`;
  const upiLink = `upi://pay?pa=${encodeURIComponent(
    targetUpiId
  )}&pn=${encodeURIComponent(centerName)}&am=${amount}&tn=${encodeURIComponent(
    customRef
  )}&cu=INR`;

  // Numeric advance amount
  const numericAdvance = Math.max(0, Number(advanceAmountInput) || 0);

  // Construct advance payment UPI Intent link using createdAdvanceFee ID if available
  const advanceFeeId = createdAdvanceFee?._id || "";
  const advanceCustomRef = advanceFeeId
    ? `FEE-${advanceFeeId.toString().slice(-6)}`
    : `FEE-ADV-${(studentId || "").toString().slice(-6)}`;
  const advanceUpiLink = `upi://pay?pa=${encodeURIComponent(
    targetUpiId
  )}&pn=${encodeURIComponent(centerName)}&am=${
    createdAdvanceFee ? createdAdvanceFee.amountDue : numericAdvance
  }&tn=${encodeURIComponent(advanceCustomRef)}&cu=INR`;

  // =========================================================================
  // TASK 2: EXPLICIT CLICK HANDLERS (Eliminates Desktop upi:// Console Errors)
  // =========================================================================
  const handleOpenUpiApp = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      window.location.href = upiLink;
    }
  };

  const handleOpenAdvanceUpiApp = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      window.location.href = advanceUpiLink;
    }
  };

  // =========================================================================
  // TASK 1, 3 & 4: REGULAR PAYMENT REAL-TIME POLLING, FALLBACK, AND SUCCESS
  // =========================================================================

  // 1. 30-Second timer to reveal "Payment taking too long? Enter UTR manually"
  useEffect(() => {
    if (!showUpiModal) {
      setRegularDelayedButtonVisible(false);
      setShowManualUtrInput(false);
      setRegularPaymentSuccess(false);
      return;
    }

    const timer = setTimeout(() => {
      setRegularDelayedButtonVisible(true);
    }, 30000); // exactly 30 seconds

    return () => clearTimeout(timer);
  }, [showUpiModal]);

  // 2. Real-time polling every 3 seconds for regular fee status
  useEffect(() => {
    if (!showUpiModal || !feeId || regularPaymentSuccess) return;

    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl}/fees/${feeId}`);
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.status === "Paid") {
            clearInterval(pollInterval);
            setRegularPaymentSuccess(true);
            setTimeout(() => {
              setShowUpiModal(false);
              setCurrentStatus("Paid");
              if (onPaymentSuccess) onPaymentSuccess();
            }, 3000); // exactly 3 seconds
          }
        }
      } catch (err) {
        // Silently catch polling network fluctuations
      }
    }, 3000); // 3 seconds interval

    return () => clearInterval(pollInterval);
  }, [showUpiModal, feeId, regularPaymentSuccess, onPaymentSuccess]);

  // =========================================================================
  // TASK 1, 3 & 4: ADVANCE PAYMENT REAL-TIME POLLING, FALLBACK, AND SUCCESS
  // =========================================================================

  // 1. 30-Second timer for advance payment fallback
  useEffect(() => {
    if (!createdAdvanceFee?._id || advancePaymentSuccess) {
      setAdvanceDelayedButtonVisible(false);
      setShowAdvanceManualUtrInput(false);
      return;
    }

    const timer = setTimeout(() => {
      setAdvanceDelayedButtonVisible(true);
    }, 30000); // exactly 30 seconds

    return () => clearTimeout(timer);
  }, [createdAdvanceFee?._id, advancePaymentSuccess]);

  // 2. Real-time polling every 3 seconds for advance fee status
  useEffect(() => {
    if (!createdAdvanceFee?._id || advancePaymentSuccess) return;

    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl}/fees/${createdAdvanceFee._id}`);
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.status === "Paid") {
            clearInterval(pollInterval);
            setAdvancePaymentSuccess(true);
            setTimeout(() => {
              setShowAdvanceModal(false);
              setCreatedAdvanceFee(null);
              setAdvancePaymentSuccess(false);
              if (onAdvancePaymentSuccess) {
                onAdvancePaymentSuccess();
              } else if (onPaymentSuccess) {
                onPaymentSuccess();
              }
            }, 3000); // exactly 3 seconds
          }
        }
      } catch (err) {
        // Silently catch polling network fluctuations
      }
    }, 3000); // 3 seconds interval

    return () => clearInterval(pollInterval);
  }, [
    createdAdvanceFee?._id,
    advancePaymentSuccess,
    onAdvancePaymentSuccess,
    onPaymentSuccess,
  ]);

  // Initiate advance payment (creates Fee record in advance so it can be polled)
  const handleInitiateAdvancePayment = async () => {
    if (numericAdvance <= 0) {
      setAdvanceError("Advance payment amount must be greater than 0.");
      return;
    }

    setAdvanceCreating(true);
    setAdvanceError(null);

    try {
      const backendUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

      const res = await fetch(`${backendUrl}/fees/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          centerId,
          amount: numericAdvance,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success || !data?.data?._id) {
        throw new Error(data?.error || "Failed to initiate advance payment.");
      }

      setCreatedAdvanceFee(data.data);
    } catch (err: unknown) {
      setAdvanceError(
        err instanceof Error ? err.message : "Failed to initiate advance payment."
      );
    } finally {
      setAdvanceCreating(false);
    }
  };

  // Handle regular UTR submission fallback
  const handleSubmitUtr = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUtr = utrInput.trim();

    if (!cleanUtr || cleanUtr.length < 6) {
      setUtrError("Please enter a valid 12-digit UTR / Transaction reference.");
      return;
    }

    if (!feeId) {
      setCurrentStatus("Verification Pending");
      setSavedUtr(cleanUtr);
      setShowUpiModal(false);
      if (onUtrSubmitted) onUtrSubmitted(cleanUtr);
      return;
    }

    setSubmittingUtr(true);
    setUtrError(null);

    try {
      const backendUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

      const res = await fetch(`${backendUrl}/fees/${feeId}/submit-utr`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utrNumber: cleanUtr }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to submit UTR reference.");
      }

      setCurrentStatus("Verification Pending");
      setSavedUtr(cleanUtr);
      setShowUpiModal(false);
      if (onUtrSubmitted) onUtrSubmitted(cleanUtr);
      if (onPaymentSuccess) onPaymentSuccess();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to submit UTR details.";
      setUtrError(msg);
    } finally {
      setSubmittingUtr(false);
    }
  };

  // Handle advance UTR submission fallback
  const handleSubmitAdvanceUtr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createdAdvanceFee?._id) return;

    const cleanUtr = advanceUtrInput.trim();
    if (!cleanUtr || cleanUtr.length < 6) {
      setAdvanceError("Please enter a valid 12-digit UTR / reference number.");
      return;
    }

    setSubmittingAdvanceUtr(true);
    setAdvanceError(null);

    try {
      const backendUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

      const res = await fetch(
        `${backendUrl}/fees/${createdAdvanceFee._id}/submit-utr`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ utrNumber: cleanUtr }),
        }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to submit advance UTR reference.");
      }

      setShowAdvanceModal(false);
      setCreatedAdvanceFee(null);
      setAdvanceUtrInput("");

      if (onAdvancePaymentSuccess) {
        onAdvancePaymentSuccess();
      } else if (onPaymentSuccess) {
        onPaymentSuccess();
      }
    } catch (err: unknown) {
      setAdvanceError(
        err instanceof Error ? err.message : "Failed to submit advance UTR."
      );
    } finally {
      setSubmittingAdvanceUtr(false);
    }
  };

  const handleCopyVpa = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(targetUpiId);
      setCopiedVpa(true);
      setTimeout(() => setCopiedVpa(false), 2000);
    }
  };

  return (
    <>
      {/* 1. PAID STATE */}
      {currentStatus === "Paid" ? (
        <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Fee Status
            </span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-200/60">
              Paid &amp; Cleared
            </span>
          </div>

          <div>
            <div className="text-2xl font-extrabold text-emerald-700 font-mono">
              ₹0 Due
            </div>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">
              Tuition fee received and cleared successfully. Official e-Receipt archived below.
            </p>
          </div>

          <div className="pt-0.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            Official e-Receipt recorded in center database
          </div>

          {/* Secondary Action: Pay Advance */}
          <button
            type="button"
            onClick={() => {
              setCreatedAdvanceFee(null);
              setAdvancePaymentSuccess(false);
              setShowAdvanceModal(true);
            }}
            className="tap-bounce w-full h-10 rounded-2xl border border-emerald-300 bg-white hover:bg-emerald-50 active:scale-[0.98] text-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
            <span>Pay Next Month in Advance</span>
          </button>
        </div>
      ) : currentStatus === "Verification Pending" ? (
        /* 2. VERIFICATION PENDING STATE */
        <div className="rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-600" />
              Verification In Progress
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-0.5 text-[11px] font-extrabold text-amber-800 border border-amber-200">
              Verification Pending
            </span>
          </div>

          <div>
            <div className="text-3xl font-extrabold text-amber-900 font-mono tracking-tight">
              ₹{amount.toLocaleString("en-IN")}
            </div>
            <p className="mt-1 text-xs text-amber-800 font-medium leading-relaxed">
              Payment submitted. Waiting for tuition center head to verify your
              payment with bank statement.
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-white border border-amber-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Submitted Reference Number
            </span>
            <div className="flex items-center justify-between font-mono font-bold text-xs text-slate-800">
              <span>{savedUtr || "Under Review"}</span>
              <span className="text-[10px] text-amber-700 font-sans font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                Awaiting Admin Match
              </span>
            </div>
          </div>

          {/* Secondary Button: Pay Additional Advance */}
          <button
            type="button"
            onClick={() => {
              setCreatedAdvanceFee(null);
              setAdvancePaymentSuccess(false);
              setShowAdvanceModal(true);
            }}
            className="tap-bounce w-full h-10 rounded-2xl border border-amber-300 bg-white hover:bg-amber-50 active:scale-[0.98] text-amber-900 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-600" />
            <span>Pay Additional in Advance</span>
          </button>
        </div>
      ) : (
        /* 3. PENDING / OVERDUE STATE */
        <div className="rounded-3xl border-2 border-rose-200/90 bg-gradient-to-br from-rose-50/70 via-white to-amber-50/50 p-5 shadow-sm space-y-3.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-rose-500 stroke-[2.3]" />
              Fee Due
            </span>
            {daysLate > 0 ? (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-extrabold text-rose-700 border border-rose-200">
                {daysLate} {daysLate === 1 ? "Day" : "Days"} Late
              </span>
            ) : (
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-extrabold text-blue-700 border border-blue-200">
                Due: {dueDate}
              </span>
            )}
          </div>

          {/* Amount */}
          <div>
            <div className="text-3xl font-extrabold text-rose-600 font-mono tracking-tight">
              ₹{amount.toLocaleString("en-IN")}
            </div>
            <p className="mt-1 text-[12px] font-medium text-slate-600">
              Tuition Fee • Due Date:{" "}
              <span className="font-bold text-slate-800">{dueDate}</span>
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              disabled={gatewayPinging}
              onClick={handlePayFees}
              className="tap-bounce w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-[14px] shadow-md shadow-blue-600/30 flex items-center justify-center gap-2 transition-transform cursor-pointer disabled:opacity-80 disabled:cursor-not-allowed"
            >
              {gatewayPinging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  <span>Initializing Secure Payment Gateway...</span>
                </>
              ) : (
                <>
                  <QrCode className="h-4 w-4 stroke-[2.4]" />
                  <span>Pay Now (Dynamic QR / UPI)</span>
                </>
              )}
            </button>

            {gatewayError && (
              <p className="text-[11px] font-semibold text-rose-600 text-center animate-fade-in pt-0.5">
                {gatewayError}
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                setCreatedAdvanceFee(null);
                setAdvancePaymentSuccess(false);
                setShowAdvanceModal(true);
              }}
              className="tap-bounce w-full h-10 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              <span>Pay in Advance</span>
            </button>
          </div>

          <p className="text-center text-[10px] text-slate-400 font-medium">
            Instant 0-fee payment via GPay, PhonePe, Paytm, or BHIM
          </p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* REGULAR UPI PAYMENT GATEWAY MODAL (RAZORPAY STYLE POLLING + FALLBACK)     */}
      {/* ========================================================================= */}
      {showUpiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 sm:p-6 shadow-2xl space-y-4 border border-slate-200 my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900 tracking-tight">
                  UPI Payment Gateway
                </h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  {centerName} • Direct Center Transfer
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowUpiModal(false)}
                className="tap-bounce h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* TASK 4: SUCCESS ANIMATION (Transition into large green checkmark, 3s auto close) */}
            {regularPaymentSuccess ? (
              <div className="py-10 px-4 flex flex-col items-center justify-center text-center space-y-4 animate-fade-in">
                <div className="relative flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/25 ring-8 ring-emerald-50 animate-in zoom-in-50 duration-500">
                    <CheckCircle2 className="w-14 h-14 stroke-[2.6] text-emerald-600 animate-in fade-in zoom-in duration-300" />
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200/80">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    Verified Real-Time
                  </span>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                    Payment Successful!
                  </h3>
                  <p className="text-xs text-slate-500 font-medium max-w-xs mx-auto leading-relaxed">
                    Your tuition payment of ₹{amount.toLocaleString("en-IN")} has been verified and recorded.
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50/80 border border-emerald-200/60 px-4 py-2 rounded-xl">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Closing and refreshing in 3 seconds...</span>
                </div>
              </div>
            ) : (
              <>
                {/* Payable Amount Box */}
                <div className="rounded-2xl bg-slate-50 p-3.5 text-center border border-slate-200/80 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Total Amount Due
                  </span>
                  <div className="text-3xl font-extrabold text-slate-900 font-mono tracking-tight">
                    ₹{amount.toLocaleString("en-IN")}
                  </div>
                  <div className="flex items-center justify-center gap-1.5 pt-0.5">
                    <span className="text-[11px] font-mono text-blue-600 font-bold truncate max-w-[200px]">
                      {targetUpiId}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyVpa}
                      className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                      title="Copy UPI ID"
                    >
                      {copiedVpa ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* METHOD 1: Dynamic Scannable QR Code */}
                <div className="flex flex-col items-center justify-center p-3.5 rounded-2xl border-2 border-dashed border-slate-200 bg-white">
                  <div className="p-2.5 bg-white rounded-2xl shadow-xs border border-slate-100 flex flex-col items-center">
                    <QRCodeSVG
                      value={upiLink}
                      size={170}
                      level="M"
                      includeMargin={true}
                      className="rounded-lg"
                    />
                  </div>
                  <p className="mt-2 text-xs font-bold text-slate-800 flex items-center gap-1">
                    <QrCode className="h-3.5 w-3.5 text-blue-600" />
                    <span>Scan via any UPI App</span>
                  </p>
                  <span className="text-[10px] text-slate-400 font-medium">
                    GPay • PhonePe • Paytm • BHIM • Banking Apps
                  </span>
                </div>

                {/* METHOD 2: 1-Tap Mobile Intent (Explicit Button Click to eliminate desktop auto-launch console error) */}
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={handleOpenUpiApp}
                    className="tap-bounce w-full h-12 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] text-white font-bold text-xs sm:text-sm shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Smartphone className="h-4 w-4 stroke-[2.2]" />
                    <span>Pay via UPI App</span>
                    <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                  </button>
                  <p className="text-center text-[10px] text-slate-400">
                    (Tapping opens installed UPI app on your mobile device)
                  </p>
                </div>

                {/* TASK 1: RAZORPAY-STYLE PROCESSING UI WITH RADAR / PULSING ORBIT */}
                <div className="relative overflow-hidden rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50/90 via-indigo-50/40 to-white p-3.5 shadow-xs">
                  <div className="flex items-center gap-3.5 relative z-10">
                    <div className="relative flex items-center justify-center w-11 h-11 flex-shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-20 animate-ping duration-1000"></span>
                      <span className="absolute inline-flex h-8 w-8 rounded-full bg-indigo-500 opacity-25 animate-pulse"></span>
                      <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white shadow-md shadow-blue-500/30">
                        <Loader2 className="w-3.5 h-3.5 animate-spin stroke-[2.5]" />
                      </div>
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-xs font-black text-slate-900 tracking-tight">
                          Waiting for payment confirmation...
                        </h4>
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                      <p className="text-[11px] font-medium text-slate-500 leading-snug">
                        Please do not close this window or press back.
                      </p>
                    </div>
                  </div>
                </div>

                {/* TASK 3: SMOOTH FALLBACK TRANSITION (Button appears after exactly 30s) */}
                {regularDelayedButtonVisible && !showManualUtrInput && (
                  <div className="pt-2 text-center border-t border-slate-100 transition-opacity duration-700 ease-in-out opacity-100 animate-fade-in">
                    <button
                      type="button"
                      onClick={() => setShowManualUtrInput(true)}
                      className="tap-bounce text-xs text-slate-500 hover:text-slate-800 underline font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      <span>Payment taking too long? Enter UTR manually</span>
                    </button>
                  </div>
                )}

                {/* Manual UTR Input Box (Revealed ONLY after clicking the delayed button) */}
                {showManualUtrInput && (
                  <div className="pt-3 border-t border-slate-100 space-y-2.5 transition-all duration-500 ease-in-out animate-fade-in">
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        Enter 12-Digit UTR / Ref No.
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-tight">
                        Enter the 12-digit transaction ID from your bank receipt to verify.
                      </p>
                    </div>

                    <form onSubmit={handleSubmitUtr} className="space-y-2">
                      <input
                        type="text"
                        maxLength={22}
                        value={utrInput}
                        onChange={(e) => {
                          setUtrInput(e.target.value.trim().toUpperCase());
                          if (utrError) setUtrError(null);
                        }}
                        placeholder="e.g. 428910293847"
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-blue-100 focus:border-blue-600 font-mono font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal transition-all"
                      />

                      {utrError && (
                        <p className="text-[11px] text-rose-600 font-semibold">{utrError}</p>
                      )}

                      <button
                        type="submit"
                        disabled={submittingUtr || !utrInput.trim()}
                        className="tap-bounce w-full h-10 rounded-xl bg-slate-900 hover:bg-black active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {submittingUtr ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Submitting Details...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 stroke-[2.2]" />
                            <span>Submit UTR for Verification</span>
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADVANCE FEE PAYMENT MODAL (RAZORPAY STYLE POLLING + FALLBACK)             */}
      {/* ========================================================================= */}
      {showAdvanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 sm:p-6 shadow-2xl space-y-4 border border-slate-200 my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                  <CreditCard className="h-4 w-4 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">
                    Pay in Advance
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {centerName} • Advance Fee Payment
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAdvanceModal(false);
                  setCreatedAdvanceFee(null);
                  setAdvancePaymentSuccess(false);
                }}
                className="tap-bounce h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* TASK 4: ADVANCE PAYMENT SUCCESS ANIMATION */}
            {advancePaymentSuccess ? (
              <div className="py-10 px-4 flex flex-col items-center justify-center text-center space-y-4 animate-fade-in">
                <div className="relative flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/25 ring-8 ring-emerald-50 animate-in zoom-in-50 duration-500">
                    <CheckCircle2 className="w-14 h-14 stroke-[2.6] text-emerald-600 animate-in fade-in zoom-in duration-300" />
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200/80">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    Advance Confirmed
                  </span>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                    Payment Successful!
                  </h3>
                  <p className="text-xs text-slate-500 font-medium max-w-xs mx-auto leading-relaxed">
                    Your advance tuition fee payment of ₹{createdAdvanceFee?.amountDue.toLocaleString("en-IN")} has been verified and cleared.
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50/80 border border-emerald-200/60 px-4 py-2 rounded-xl">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Closing and refreshing in 3 seconds...</span>
                </div>
              </div>
            ) : !createdAdvanceFee ? (
              /* STEP 1: Enter Advance Amount */
              <div className="space-y-3">
                <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                  <span>Enter Advance Amount (₹)</span>
                  <span className="text-[10px] font-medium text-slate-400">
                    Must be &gt; ₹0
                  </span>
                </label>

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <IndianRupee className="h-4 w-4" />
                  </div>
                  <input
                    type="number"
                    min="1"
                    step="100"
                    value={advanceAmountInput}
                    onChange={(e) => {
                      setAdvanceAmountInput(e.target.value);
                      if (advanceError) setAdvanceError(null);
                    }}
                    placeholder="e.g. 3000"
                    className="w-full pl-9 pr-3.5 py-2.5 text-base font-mono font-extrabold text-slate-900 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-amber-100 focus:border-amber-500 transition-all"
                  />
                </div>

                {/* Quick Select Amount Pills */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  {QUICK_ADVANCE_AMOUNTS.map((quickAmt) => (
                    <button
                      key={quickAmt}
                      type="button"
                      onClick={() => {
                        setAdvanceAmountInput(String(quickAmt));
                        if (advanceError) setAdvanceError(null);
                      }}
                      className={`tap-bounce flex-1 py-1 rounded-lg text-[11px] font-bold font-mono transition-all border cursor-pointer ${
                        Number(advanceAmountInput) === quickAmt
                          ? "bg-amber-500 text-white border-amber-600 shadow-2xs"
                          : "bg-slate-100 text-slate-700 border-slate-200/80 hover:bg-slate-200/60"
                      }`}
                    >
                      ₹{quickAmt.toLocaleString("en-IN")}
                    </button>
                  ))}
                </div>

                {advanceError && (
                  <p className="text-[11px] text-rose-600 font-semibold">
                    {advanceError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleInitiateAdvancePayment}
                  disabled={advanceCreating || numericAdvance <= 0}
                  className="tap-bounce w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-amber-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50 mt-2 cursor-pointer"
                >
                  {advanceCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>Generating Secure Payment QR...</span>
                    </>
                  ) : (
                    <>
                      <QrCode className="h-4 w-4 stroke-[2.2]" />
                      <span>Proceed to Pay ₹{numericAdvance.toLocaleString("en-IN")}</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              /* STEP 2: Scannable QR & 1-Tap Deep Link with Real-Time Polling */
              <div className="space-y-3.5 animate-fade-in">
                {/* Advance Amount Summary Box */}
                <div className="rounded-2xl bg-amber-50/80 p-3 text-center border border-amber-200 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-amber-800">
                    <span>Advance Payment</span>
                    <button
                      type="button"
                      onClick={() => setCreatedAdvanceFee(null)}
                      className="text-amber-700 underline hover:text-amber-900 cursor-pointer"
                    >
                      Change Amount
                    </button>
                  </div>
                  <div className="text-3xl font-extrabold text-amber-900 font-mono tracking-tight">
                    ₹{createdAdvanceFee.amountDue.toLocaleString("en-IN")}
                  </div>
                  <span className="text-[11px] font-mono text-amber-800 font-bold block truncate">
                    {targetUpiId}
                  </span>
                </div>

                {/* Method 1: Desktop Scannable QR Code */}
                <div className="flex flex-col items-center justify-center p-3 rounded-2xl border-2 border-dashed border-amber-200 bg-white">
                  <div className="p-2 bg-white rounded-2xl shadow-xs border border-amber-100 flex flex-col items-center">
                    <QRCodeSVG
                      value={advanceUpiLink}
                      size={155}
                      level="M"
                      includeMargin={true}
                      className="rounded-lg"
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] font-bold text-slate-800 flex items-center gap-1">
                    <QrCode className="h-3 w-3 text-amber-600" />
                    <span>Scan via any UPI App</span>
                  </p>
                  <span className="text-[10px] text-slate-400">
                    GPay • PhonePe • Paytm • BHIM
                  </span>
                </div>

                {/* Method 2: Mobile 1-Tap Deep Link Button (Click handler only) */}
                <button
                  type="button"
                  onClick={handleOpenAdvanceUpiApp}
                  className="tap-bounce w-full h-11 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-600 hover:to-amber-700 active:scale-[0.98] text-white font-bold text-xs sm:text-sm shadow-md shadow-amber-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Smartphone className="h-4 w-4 stroke-[2.2]" />
                  <span>Pay ₹{createdAdvanceFee.amountDue.toLocaleString("en-IN")} via UPI App</span>
                  <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                </button>

                {/* TASK 1: RAZORPAY-STYLE PROCESSING UI WITH RADAR / PULSING ORBIT */}
                <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/90 via-orange-50/40 to-white p-3.5 shadow-xs">
                  <div className="flex items-center gap-3.5 relative z-10">
                    <div className="relative flex items-center justify-center w-11 h-11 flex-shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-20 animate-ping duration-1000"></span>
                      <span className="absolute inline-flex h-8 w-8 rounded-full bg-amber-600 opacity-25 animate-pulse"></span>
                      <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-amber-600 text-white shadow-md shadow-amber-500/30">
                        <Loader2 className="w-3.5 h-3.5 animate-spin stroke-[2.5]" />
                      </div>
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-xs font-black text-slate-900 tracking-tight">
                          Waiting for payment confirmation...
                        </h4>
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                      <p className="text-[11px] font-semibold text-slate-500 leading-snug">
                        Please do not close this window or press back.
                      </p>
                    </div>
                  </div>
                </div>

                {/* TASK 3: SMOOTH FALLBACK TRANSITION (Button appears after exactly 30s) */}
                {advanceDelayedButtonVisible && !showAdvanceManualUtrInput && (
                  <div className="pt-2 text-center border-t border-slate-100 transition-opacity duration-700 ease-in-out opacity-100 animate-fade-in">
                    <button
                      type="button"
                      onClick={() => setShowAdvanceManualUtrInput(true)}
                      className="tap-bounce text-xs text-slate-500 hover:text-slate-800 underline font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      <span>Payment taking too long? Enter UTR manually</span>
                    </button>
                  </div>
                )}

                {/* Advance Manual UTR Input Box (Revealed ONLY after clicking delayed button) */}
                {showAdvanceManualUtrInput && (
                  <div className="pt-3 border-t border-amber-200/80 bg-amber-50/60 p-3.5 rounded-2xl space-y-2.5 transition-all duration-500 ease-in-out animate-fade-in">
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                        Enter 12-Digit UTR / Ref No.
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-tight">
                        Enter transaction reference from your bank receipt to manually verify.
                      </p>
                    </div>

                    <form onSubmit={handleSubmitAdvanceUtr} className="space-y-2">
                      <input
                        type="text"
                        maxLength={22}
                        value={advanceUtrInput}
                        onChange={(e) => {
                          setAdvanceUtrInput(e.target.value.trim().toUpperCase());
                          if (advanceError) setAdvanceError(null);
                        }}
                        placeholder="e.g. 428910293847"
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-hidden focus:ring-2 focus:ring-amber-200"
                      />

                      {advanceError && (
                        <p className="text-[11px] text-rose-600 font-semibold">
                          {advanceError}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={submittingAdvanceUtr || !advanceUtrInput.trim()}
                        className="tap-bounce w-full h-9 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {submittingAdvanceUtr ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 stroke-[2.2]" />
                        )}
                        <span>Submit Advance UTR for Verification</span>
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
