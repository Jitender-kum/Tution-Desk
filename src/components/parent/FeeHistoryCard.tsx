"use client";

import { useState } from "react";
import {
  Receipt,
  CheckCircle2,
  IndianRupee,
  ShieldCheck,
  Banknote,
  Printer,
  X,
  Building2,
  Calendar,
  User,
  Sparkles,
} from "lucide-react";

export interface FeeHistoryItem {
  id: string;
  month: string;
  title?: string;
  amountDue: number;
  dueDate?: string | null;
  status: string;
  utrNumber?: string;
  receiptNumber?: string;
  paymentDate?: string | null;
  paidDate?: string | null;
  paidAt?: string | null;
  paymentMode?: string;
  createdAt?: string | null;
}

interface FeeHistoryCardProps {
  history?: FeeHistoryItem[];
  studentName?: string;
  centerName?: string;
}

function formatPaidDate(dateString?: string | null): string {
  if (!dateString) return "Recorded";
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(dateString);
  }
}

export default function FeeHistoryCard({
  history = [],
  studentName = "Student",
  centerName = "Tuition Center",
}: FeeHistoryCardProps) {
  // Modal state for active receipt
  const [selectedReceiptFee, setSelectedReceiptFee] =
    useState<FeeHistoryItem | null>(null);

  // Filter only records that are Paid
  const paidFees = (history || []).filter(
    (fee) => fee.status?.toLowerCase() === "paid"
  );

  return (
    <>
      <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm space-y-3.5 transition-all">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center flex-shrink-0 shadow-2xs">
              <Receipt className="h-4.5 w-4.5 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-slate-900 tracking-tight">
                Payment History
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Official fee receipts &amp; payment archives
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700 border border-emerald-200/60">
            <CheckCircle2 className="h-3 w-3" />
            {paidFees.length} {paidFees.length === 1 ? "Receipt" : "Receipts"}
          </span>
        </div>

        {/* Body List */}
        {paidFees.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center space-y-1.5">
            <div className="h-10 w-10 rounded-2xl bg-white border border-slate-200/80 mx-auto flex items-center justify-center text-slate-400 shadow-2xs">
              <Receipt className="h-5 w-5" />
            </div>
            <p className="text-xs font-bold text-slate-700">
              No past payments found
            </p>
            <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
              Once fee payments are cleared by the tuition center, your official
              receipts will be archived here.
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2.5 pr-0.5">
            {paidFees.map((fee) => {
              const displayTitle = fee.title || fee.month || "Tuition Fee";
              const dateToFormat =
                fee.paidAt || fee.paidDate || fee.paymentDate || fee.createdAt;
              const formattedDate = formatPaidDate(dateToFormat);
              const isCash = Boolean(
                fee.paymentMode && /cash/i.test(fee.paymentMode)
              );
              const receiptNo =
                fee.receiptNumber ||
                (isCash ? `RCPT-${fee.id.slice(-6).toUpperCase()}` : "");

              return (
                <div
                  key={fee.id}
                  className={`rounded-2xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors shadow-2xs ${
                    isCash
                      ? "border-emerald-200/80 bg-gradient-to-r from-emerald-50/70 to-white hover:bg-emerald-50/90"
                      : "border-slate-100 bg-slate-50/60 hover:bg-slate-50"
                  }`}
                >
                  {/* Left: Icon & Details */}
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div
                      className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-2xs border ${
                        isCash
                          ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                          : "bg-white border-slate-200/80 text-emerald-600"
                      }`}
                    >
                      {isCash ? (
                        <Banknote className="h-5 w-5 stroke-[2.2]" />
                      ) : (
                        <IndianRupee className="h-4.5 w-4.5 stroke-[2.4]" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-[13px] font-bold text-slate-900 tracking-tight truncate">
                          {displayTitle}
                        </h4>
                        {/* Mode Badge */}
                        {isCash ? (
                          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300">
                            <Banknote className="h-3 w-3 text-emerald-700" />
                            Cash
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                            Online / UPI
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 font-medium">
                        <span>Paid: {formattedDate}</span>

                        {/* Display receiptNumber prominently for Cash records instead of UTR */}
                        {isCash && receiptNo ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="font-mono font-bold text-emerald-900 select-all">
                              Receipt: {receiptNo}
                            </span>
                          </>
                        ) : fee.utrNumber ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="font-mono text-slate-600 select-all">
                              UTR: {fee.utrNumber}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Right: Amount & Action */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 flex-shrink-0">
                    <div className="text-left sm:text-right">
                      <div className="text-[15px] font-extrabold text-emerald-700 font-mono tracking-tight">
                        ₹{Number(fee.amountDue || 0).toLocaleString("en-IN")}
                      </div>
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-emerald-600">
                        <ShieldCheck className="h-3 w-3 stroke-[2.4]" />
                        Cleared
                      </span>
                    </div>

                    {/* Task 3.3: Small "View Receipt" button next to all cleared payments */}
                    <button
                      type="button"
                      onClick={() => setSelectedReceiptFee(fee)}
                      className="tap-bounce h-8 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-95 text-slate-800 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                      title="View digital payment receipt"
                      aria-label={`View receipt for ${displayTitle}`}
                    >
                      <Receipt className="h-3.5 w-3.5 text-emerald-600 stroke-[2.2]" />
                      <span>View Receipt</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Task 3.3: Digital Slip Modal (Showing Date, Amount, Center Name, Student Name, Mode, Receipt Number/UTR) */}
      {selectedReceiptFee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden relative">
            {/* Top Pattern Header */}
            <div className="bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 p-5 text-white relative">
              <button
                type="button"
                onClick={() => setSelectedReceiptFee(null)}
                className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 active:scale-90 flex items-center justify-center text-white transition-all cursor-pointer"
                aria-label="Close receipt modal"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-2 text-emerald-100 text-xs font-bold uppercase tracking-wider">
                <Receipt className="h-4 w-4" />
                Official Fee Receipt
              </div>
              <h2 className="text-xl font-black mt-1 tracking-tight text-white">
                {centerName}
              </h2>
              <p className="text-xs text-emerald-100/90 mt-0.5">
                Verified Payment Acknowledgement Slip
              </p>
            </div>

            {/* Receipt Slip Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* Receipt Number Badge */}
              <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-200">
                <div>
                  <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 block">
                    Receipt Number
                  </span>
                  <span className="font-mono font-black text-slate-900 text-sm select-all">
                    {selectedReceiptFee.receiptNumber ||
                      (selectedReceiptFee.paymentMode &&
                      /cash/i.test(selectedReceiptFee.paymentMode)
                        ? `RCPT-${selectedReceiptFee.id.slice(-6).toUpperCase()}`
                        : selectedReceiptFee.utrNumber ||
                          `RCPT-${selectedReceiptFee.id.slice(-6).toUpperCase()}`)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 block">
                    Status
                  </span>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                    <ShieldCheck className="h-3 w-3" />
                    PAID &amp; CLEARED
                  </span>
                </div>
              </div>

              {/* Data Grid */}
              <div className="grid grid-cols-2 gap-3 text-slate-600">
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Student Name
                  </span>
                  <p className="font-bold text-slate-900 text-xs truncate">
                    {studentName}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Date Paid
                  </span>
                  <p className="font-bold text-slate-900 text-xs">
                    {formatPaidDate(
                      selectedReceiptFee.paidAt ||
                        selectedReceiptFee.paidDate ||
                        selectedReceiptFee.paymentDate ||
                        selectedReceiptFee.createdAt
                    )}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Fee Month / Title
                  </span>
                  <p className="font-bold text-slate-900 text-xs truncate">
                    {selectedReceiptFee.title || selectedReceiptFee.month}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    Payment Mode
                  </span>
                  <p className="font-bold text-slate-900 text-xs flex items-center gap-1">
                    {selectedReceiptFee.paymentMode &&
                    /cash/i.test(selectedReceiptFee.paymentMode) ? (
                      <>
                        <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                        Cash Payment
                      </>
                    ) : (
                      <>
                        <IndianRupee className="h-3.5 w-3.5 text-blue-600" />
                        Online / UPI
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* UTR / Ref Number if Online */}
              {selectedReceiptFee.utrNumber && (
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 font-mono text-xs flex items-center justify-between">
                  <span className="font-sans font-bold text-slate-400 text-[10px] uppercase">
                    Bank UTR Ref:
                  </span>
                  <span className="font-bold text-slate-800 select-all">
                    {selectedReceiptFee.utrNumber}
                  </span>
                </div>
              )}

              {/* Big Highlighted Amount Box */}
              <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-center space-y-0.5">
                <span className="text-[10px] uppercase font-extrabold tracking-wider text-emerald-800">
                  Total Amount Received
                </span>
                <div className="text-3xl font-black font-mono text-emerald-900 tracking-tight">
                  ₹{Number(selectedReceiptFee.amountDue || 0).toLocaleString("en-IN")}
                </div>
                <p className="text-[10px] text-emerald-700 font-medium">
                  Official automated entry from center ledger
                </p>
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="tap-bounce flex-1 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="h-4 w-4 text-slate-600" />
                  <span>Print Slip</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedReceiptFee(null)}
                  className="tap-bounce flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Done</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
