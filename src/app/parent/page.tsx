"use client";

import { useState } from "react";
import TopHeader from "@/components/layout/TopHeader";
import ChildProfileHeader from "@/components/parent/ChildProfileHeader";
import AttendanceProgressCard from "@/components/parent/AttendanceProgressCard";
import FeeActionCard from "@/components/parent/FeeActionCard";
import RecentHomeworkList from "@/components/parent/RecentHomeworkList";
import { MOCK_PARENT_DASHBOARD_DATA, MOCK_CENTER_CONFIG } from "@/data/mockData";
import { Phone, MessageCircle, CheckCircle2 } from "lucide-react";

export default function ParentPage() {
  const [data, setData] = useState(() => MOCK_PARENT_DASHBOARD_DATA);
  const [isPaid, setIsPaid] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handlePaymentSuccess = () => {
    setIsPaid(true);
    setToastMessage(
      "Payment Successful! Official e-receipt generated and sent to WhatsApp."
    );

    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  return (
    <div className="flex flex-col min-h-full relative">
      {/* Top Header */}
      <TopHeader
        title={MOCK_CENTER_CONFIG.name}
        subtitle="Parent Dashboard • Student Portal"
        badgeText="Parent View"
      />

      {/* Floating Success Toast */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 w-[92%] max-w-sm z-50 animate-bounce">
          <div className="rounded-2xl bg-slate-900 text-white p-3.5 shadow-xl flex items-center gap-2.5 border border-slate-700">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="flex-1 text-xs font-semibold leading-snug">
              {toastMessage}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-4 space-y-4 pb-24">
        {/* 1. Header & Profile Card: Rohan Gupta's Progress */}
        <ChildProfileHeader
          childName={data.childName}
          batchName={data.batchName}
          rollNumber={data.rollNumber}
          initials={data.initials}
          avatarColor={data.avatarColor}
        />

        {/* 2. Crucial Fee Action Card (If due, high-contrast with Pay by UPI) */}
        <FeeActionCard
          amount={data.pendingFeeAmount}
          dueDate={data.feeDueDate}
          daysLate={data.feeDaysLate}
          upiId={data.upiId}
          onPaymentSuccess={handlePaymentSuccess}
          isPaid={isPaid}
        />

        {/* 3. Core Metric: Overall Attendance % with Circular Ring */}
        <AttendanceProgressCard
          percentage={data.attendancePercentage}
          totalClasses={data.totalClassesHeld}
          attended={data.classesAttended}
          missed={data.classesMissed}
        />

        {/* 4. Recent Homework & Teacher Notes */}
        <RecentHomeworkList items={data.homework} />

        {/* 5. Direct Teacher Connect Card */}
        <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm space-y-2.5">
          <h3 className="text-[13px] font-bold text-slate-800">
            Have questions about {data.childName}&apos;s progress?
          </h3>
          <p className="text-[11px] text-slate-500">
            You can reach out directly to tuition head {MOCK_CENTER_CONFIG.ownerName}.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <a
              href="tel:+919820011223"
              className="tap-bounce flex-1 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Phone className="h-3.5 w-3.5 text-slate-600" />
              Call Center
            </a>
            <a
              href="https://wa.me/919820011223"
              target="_blank"
              rel="noopener noreferrer"
              className="tap-bounce flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
