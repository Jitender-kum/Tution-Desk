import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

interface GlobalReminderButtonProps {
  pendingCount: number;
  onSendAll: () => void;
  isSent: boolean;
  isSending?: boolean;
}

function WhatsAppIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12.031 2c-5.507 0-9.982 4.475-9.982 9.982 0 1.761.458 3.483 1.332 5.006l-1.417 5.176 5.305-1.391c1.472.804 3.127 1.229 4.762 1.229 5.507 0 9.982-4.475 9.982-9.982 0-2.665-1.037-5.17-2.923-7.056-1.886-1.886-4.391-2.923-7.057-2.923zm5.823 14.127c-.244.686-1.424 1.31-1.954 1.365-.494.051-1.127.078-3.376-.848-2.696-1.11-4.442-3.844-4.577-4.024-.135-.18-1.096-1.458-1.096-2.781 0-1.323.693-1.975.94-2.242.247-.267.54-.334.72-.334.18 0 .36.002.518.01.168.009.394-.064.617.472.228.547.78 1.905.849 2.044.069.139.115.302.023.485-.092.183-.138.297-.275.457-.137.16-.289.358-.413.481-.138.137-.282.287-.121.564.161.277.717 1.182 1.541 1.916 1.059.943 1.953 1.236 2.23 1.373.277.137.439.115.601-.069.162-.184.693-.807.878-1.084.185-.277.369-.231.616-.139.247.092 1.568.739 1.838.874.27.135.45.202.517.316.067.115.067.666-.177 1.352z" />
    </svg>
  );
}

export default function GlobalReminderButton({
  pendingCount,
  onSendAll,
  isSent,
  isSending = false,
}: GlobalReminderButtonProps) {
  return (
    <button
      type="button"
      onClick={onSendAll}
      disabled={isSent || isSending}
      className={`tap-bounce w-full rounded-2xl p-4 font-bold text-white shadow-md transition-all flex items-center justify-between group ${
        isSent
          ? "bg-emerald-700 shadow-emerald-700/20 cursor-default"
          : isSending
          ? "bg-emerald-600/90 shadow-emerald-600/20 cursor-wait"
          : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] shadow-emerald-600/30"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-xs">
          {isSending ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : isSent ? (
            <CheckCircle2 className="h-6 w-6 text-white stroke-[2.5]" />
          ) : (
            <WhatsAppIcon className="h-5 w-5 text-white" />
          )}
        </div>
        <div className="text-left">
          <div className="text-[14px] font-extrabold tracking-tight">
            {isSending
              ? "Sending Reminders..."
              : isSent
              ? "WhatsApp Reminders Dispatched!"
              : "Send WhatsApp Reminder to All"}
          </div>
          <div className="text-[11px] font-medium text-emerald-100">
            {isSending
              ? "Connecting to WhatsApp engine and dispatching..."
              : isSent
              ? `Dispatched with UPI links to ${pendingCount} parents`
              : `1-Tap broadcast with instant UPI payment link`}
          </div>
        </div>
      </div>

      <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-xs">
        {pendingCount} Due
      </span>
    </button>
  );
}
