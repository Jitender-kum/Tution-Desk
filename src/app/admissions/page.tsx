"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import TopHeader from "@/components/layout/TopHeader";
import StudentFormModal from "@/components/modals/StudentFormModal";
import CreateBatchModal from "@/components/modals/CreateBatchModal";
import { apiClient, CURRENT_CENTER_ID } from "@/lib/apiClient";
import { StudentRecord, BatchRecord } from "@/types";
import Link from "next/link";
import {
  UserPlus,
  Users,
  Search,
  Pencil,
  Phone,
  MessageCircle,
  Calendar,
  IndianRupee,
  Layers,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  GraduationCap,
  X,
  Clock,
  BookOpen,
  Trash2,
  Receipt,
} from "lucide-react";

// Deterministic pastel avatar background colors
const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-purple-100 text-purple-700 border-purple-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function formatCurrency(amount: number): string {
  return "₹" + (amount || 0).toLocaleString("en-IN");
}

function formatJoiningDate(dateString?: string): string {
  if (!dateString) return "Recent";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "Recent";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getCycleOrdinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export default function AdmissionsPage() {
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBatchFilter, setSelectedBatchFilter] = useState("all");

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<StudentRecord | null>(null);

  // Success Feedback Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Fetch real students from MongoDB backend
  const fetchStudents = useCallback(async () => {
    try {
      const res = await apiClient<StudentRecord[]>("/students", {
        params: { centerId: CURRENT_CENTER_ID },
      });
      setStudents(res.data || []);
    } catch (err) {
      console.error("Failed to fetch students:", err);
    }
  }, []);

  // Fetch real batches from MongoDB backend
  const fetchBatches = useCallback(async () => {
    try {
      const res = await apiClient<BatchRecord[]>("/batches", {
        params: { centerId: CURRENT_CENTER_ID },
      });
      setBatches(res.data || []);
    } catch (err) {
      console.error("Failed to fetch batches:", err);
    }
  }, []);

  useEffect(() => {
    async function loadInitialData() {
      setLoading(true);
      await Promise.all([fetchStudents(), fetchBatches()]);
      setLoading(false);
    }
    loadInitialData();
  }, [fetchStudents, fetchBatches]);

  // Extract all unique batch names
  const uniqueBatches = useMemo(() => {
    const set = new Set<string>();
    batches.forEach((b) => set.add(b.name));
    students.forEach((s) => {
      if (s.batch) set.add(s.batch);
    });
    return Array.from(set);
  }, [batches, students]);

  // Filter students by search query and batch filter
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchSearch =
        searchQuery.trim() === "" ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.parentWhatsApp.includes(searchQuery.trim());

      const matchBatch =
        selectedBatchFilter === "all" || s.batch === selectedBatchFilter;

      return matchSearch && matchBatch;
    });
  }, [students, searchQuery, selectedBatchFilter]);

  // Group filtered students by Batch
  const groupedStudents = useMemo(() => {
    const groups: Record<string, StudentRecord[]> = {};

    // Initialize all existing batches in groups so empty batches are represented
    uniqueBatches.forEach((b) => {
      if (selectedBatchFilter === "all" || selectedBatchFilter === b) {
        groups[b] = [];
      }
    });

    filteredStudents.forEach((student) => {
      const b = student.batch || "Unassigned Batch";
      if (!groups[b]) {
        groups[b] = [];
      }
      groups[b].push(student);
    });

    return groups;
  }, [filteredStudents, uniqueBatches, selectedBatchFilter]);

  // Summary Metrics
  const totalStudentsCount = students.length;
  const activeStudentsCount = students.filter((s) => s.isActive !== false).length;
  const totalMonthlyPotential = students
    .filter((s) => s.isActive !== false)
    .reduce((acc, curr) => acc + (curr.monthlyFee || 0), 0);

  // Handlers for Add & Edit
  const handleOpenAdd = () => {
    setStudentToEdit(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (student: StudentRecord) => {
    setStudentToEdit(student);
    setIsModalOpen(true);
  };

  const handleModalSuccess = (savedStudent: StudentRecord) => {
    fetchStudents();
    fetchBatches();
    const isEdit = Boolean(studentToEdit);
    showToast(
      isEdit
        ? `Successfully updated details for ${savedStudent.name}!`
        : `Admission confirmed! ${savedStudent.name} enrolled in ${savedStudent.batch}.`
    );
  };

  const handleBatchSuccess = (newBatch: BatchRecord) => {
    fetchBatches();
    showToast(`Batch "${newBatch.name}" created successfully!`);
  };

  const handleDeleteStudent = async (student: StudentRecord) => {
    if (
      !window.confirm(
        `Are you sure you want to delete ${student.name}? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await apiClient(`/students/${student._id}`, {
        method: "DELETE",
      });
      showToast(`Student "${student.name}" deleted successfully.`);
      fetchStudents();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete student.";
      showToast(`Error: ${msg}`);
    }
  };

  const handleDeleteBatch = async (batch: BatchRecord) => {
    if (
      !window.confirm(
        `Are you sure you want to delete batch "${batch.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await apiClient(`/batches/${batch._id}`, {
        method: "DELETE",
      });
      showToast(`Batch "${batch.name}" deleted successfully.`);
      fetchBatches();
      fetchStudents();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete batch.";
      showToast(`Error: ${msg}`);
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* 1. Header */}
      <TopHeader
        subtitle="Admissions & Student Management"
        badgeText="Owner"
      />

      {/* Floating Success Feedback Toast */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 w-[92%] max-w-sm z-50 animate-bounce">
          <div className="rounded-2xl bg-slate-900 text-white p-3.5 shadow-2xl flex items-center gap-2.5 border border-slate-700">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="flex-1 text-xs font-semibold leading-snug">
              {toastMessage}
            </div>
          </div>
        </div>
      )}

      {/* 2. Main Content Container */}
      <div className="p-4 space-y-4">
        {/* Top Action & Title Banner (Mobile-first vertical stack) */}
        <div className="flex flex-col gap-3.5">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Student Admissions</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Automated billing cycles, batches &amp; parent links
            </p>
          </div>

          {/* Action Buttons: Create Batch & New Admission */}
          <div className="flex flex-row justify-center items-center gap-3 w-full">
            <button
              type="button"
              onClick={() => setIsBatchModalOpen(true)}
              className="tap-bounce flex-1 flex items-center justify-center gap-1.5 h-11 px-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs shadow-xs transition-all active:scale-[0.98]"
            >
              <Layers className="w-4 h-4 text-indigo-600 stroke-[2.2]" />
              <span>+ Create Batch</span>
            </button>

            <button
              type="button"
              onClick={handleOpenAdd}
              className="tap-bounce flex-1 flex items-center justify-center gap-1.5 h-11 px-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-xs shadow-md shadow-blue-600/30 transition-all"
            >
              <UserPlus className="w-4 h-4 stroke-[2.5]" />
              <span>+ New Admission</span>
            </button>
          </div>
        </div>

        {/* 3. Summary KPI Stat Cards */}
        <div className="grid grid-cols-3 gap-2">
          {/* Card 1: Total Students */}
          <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Students
              </span>
              <Users className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="mt-1">
              <div className="text-lg font-black text-slate-900">
                {totalStudentsCount}
              </div>
              <span className="text-[10px] text-emerald-600 font-semibold">
                {activeStudentsCount} Active
              </span>
            </div>
          </div>

          {/* Card 2: Batches */}
          <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Batches
              </span>
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <div className="mt-1">
              <div className="text-lg font-black text-slate-900">
                {uniqueBatches.length}
              </div>
              <span className="text-[10px] text-slate-500 font-semibold">
                Class Groups
              </span>
            </div>
          </div>

          {/* Card 3: Monthly Billing Potential */}
          <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Monthly Fee
              </span>
              <IndianRupee className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="mt-1">
              <div className="text-sm sm:text-base font-black text-slate-900 truncate">
                {formatCurrency(totalMonthlyPotential)}
              </div>
              <span className="text-[10px] text-blue-600 font-semibold">
                Recurring
              </span>
            </div>
          </div>
        </div>

        {/* 4. Search & Batch Filter Controls */}
        <div className="space-y-2">
          {/* Search Input */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by student name or WhatsApp number..."
              className="w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-9 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 shadow-xs transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Batch Filter Pills */}
          {uniqueBatches.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedBatchFilter("all")}
                className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                  selectedBatchFilter === "all"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                All Batches ({students.length})
              </button>
              {uniqueBatches.map((b) => {
                const count = students.filter((s) => s.batch === b).length;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setSelectedBatchFilter(b)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                      selectedBatchFilter === b
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {b} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 5. Main Section: Grouped by Batches */}
        {loading ? (
          /* Loading Skeleton */
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-3xl border border-slate-200 bg-white p-4 space-y-3 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="h-4 w-36 bg-slate-200 rounded-md" />
                  <div className="h-4 w-16 bg-slate-200 rounded-md" />
                </div>
                <div className="space-y-2.5 pt-2">
                  {[1, 2].map((j) => (
                    <div
                      key={j}
                      className="h-16 bg-slate-100 rounded-2xl w-full"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : Object.keys(groupedStudents).length === 0 ? (
          /* Empty State */
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
              <GraduationCap className="w-6 h-6 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {searchQuery || selectedBatchFilter !== "all"
                  ? "No matching students found"
                  : "No students or batches admitted yet"}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {searchQuery || selectedBatchFilter !== "all"
                  ? "Try clearing your search query or batch filter."
                  : "Create your batches and enroll students to automate attendance tracking, monthly fees, and VIP parent magic links."}
              </p>
            </div>
            {searchQuery || selectedBatchFilter !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedBatchFilter("all");
                }}
                className="tap-bounce inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors"
              >
                Reset Filters
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(true)}
                  className="tap-bounce inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-xs font-bold shadow-xs hover:bg-slate-50 transition-all"
                >
                  <Layers className="w-4 h-4 text-indigo-600 stroke-[2.2]" />
                  <span>Create Batch</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="tap-bounce inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/30 transition-all"
                >
                  <UserPlus className="w-4 h-4 stroke-[2.2]" />
                  <span>Admit First Student</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Render Batches and Student Rows */
          <div className="space-y-4">
            {Object.entries(groupedStudents).map(([batchName, batchStudents]) => {
              const batchFeeSum = batchStudents.reduce(
                (sum, s) => sum + (s.monthlyFee || 0),
                0
              );
              const batchMeta = batches.find((b) => b.name === batchName);

              return (
                <div
                  key={batchName}
                  className="rounded-3xl border border-slate-200/90 bg-white shadow-xs overflow-hidden"
                >
                  {/* Batch Header Bar */}
                  <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-blue-50/30 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shadow-xs">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 leading-tight">
                          {batchName}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                          <span>
                            {batchStudents.length}{" "}
                            {batchStudents.length === 1 ? "student" : "students"}
                          </span>
                          {batchMeta?.timing && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-0.5 text-slate-600">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {batchMeta.timing}
                              </span>
                            </>
                          )}
                          {batchMeta?.subject && (
                            <>
                              <span>•</span>
                              <span className="text-indigo-600 font-medium">
                                {batchMeta.subject}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                        {formatCurrency(batchFeeSum)} / mo
                      </span>
                      {batchMeta?._id && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBatch(batchMeta)}
                          aria-label={`Delete batch ${batchName}`}
                          title={`Delete batch "${batchName}"`}
                          className="tap-bounce w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-500 hover:text-rose-700 flex items-center justify-center border border-rose-200/60 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Student Rows inside Batch */}
                  {batchStudents.length === 0 ? (
                    <div className="p-5 text-center bg-slate-50/40">
                      <p className="text-xs text-slate-500 font-medium">
                        No students enrolled in this batch yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setStudentToEdit(null);
                          setIsModalOpen(true);
                        }}
                        className="mt-2 text-xs text-blue-600 font-bold hover:underline inline-flex items-center gap-1"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Enroll student into {batchName}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {batchStudents.map((student) => {
                        const avatarClass = getAvatarColor(student.name);
                        const initials = getInitials(student.name);
                        const isStudentActive = student.isActive !== false;

                        return (
                          <div
                            key={student._id}
                            className="p-3.5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full hover:bg-slate-50/60 transition-colors"
                          >
                            {/* Student Info Left */}
                            <div className="flex items-start gap-3 min-w-0">
                              {/* Avatar */}
                              <div
                                className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-xs border flex-shrink-0 shadow-xs ${avatarClass}`}
                              >
                                {initials}
                              </div>

                              {/* Details */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={`/admissions/${student._id}`}
                                    className="text-sm font-bold text-slate-900 leading-tight hover:text-blue-600 hover:underline"
                                    title="View 360° Profile & Fee Ledger"
                                  >
                                    {student.name}
                                  </Link>
                                  {!isStudentActive && (
                                    <span className="px-1.5 py-0.2 rounded-md bg-slate-100 text-slate-500 text-[10px] font-semibold">
                                      Inactive
                                    </span>
                                  )}
                                </div>

                                {/* WhatsApp Contact with Quick Action */}
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                  <span className="font-mono text-[11px] text-slate-600">
                                    +91 {student.parentWhatsApp}
                                  </span>
                                  <a
                                    href={`https://wa.me/91${student.parentWhatsApp}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label="Chat on WhatsApp"
                                    className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors"
                                    title="WhatsApp message parent"
                                  >
                                    <MessageCircle className="w-3 h-3" />
                                  </a>
                                  <a
                                    href={`tel:+91${student.parentWhatsApp}`}
                                    aria-label="Call Parent"
                                    className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center transition-colors"
                                    title="Call parent"
                                  >
                                    <Phone className="w-3 h-3" />
                                  </a>
                                </div>

                                {/* Badges: Joining Date + Fee Cycle */}
                                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-medium">
                                    <Calendar className="w-3 h-3 text-slate-400" />
                                    <span>{formatJoiningDate(student.joiningDate)}</span>
                                  </span>

                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-[10px] font-semibold border border-blue-100">
                                    <IndianRupee className="w-3 h-3 text-blue-500" />
                                    <span>
                                      {formatCurrency(student.monthlyFee || 0)} / mo
                                    </span>
                                  </span>

                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-medium border border-indigo-100">
                                    <span>
                                      Due: {getCycleOrdinal(student.billingCycleDate || 5)}
                                    </span>
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Student Row Actions Right */}
                            <div className="flex flex-wrap gap-2 w-full md:w-auto justify-start md:justify-end mt-2 md:mt-0">
                              {/* 360° Fee Ledger */}
                              <Link
                                href={`/admissions/${student._id}`}
                                className="tap-bounce text-xs md:text-sm px-2.5 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1.5 transition-colors"
                                title="View 360° Fee Ledger & Record Cash"
                              >
                                <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Ledger</span>
                              </Link>

                              {/* VIP Magic Link Preview */}
                              <a
                                href={`/p/${student._id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="tap-bounce text-xs md:text-sm px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold flex items-center gap-1.5 transition-colors"
                                title="Open Parent VIP Magic Link"
                              >
                                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                                <span>Portal</span>
                              </a>

                              {/* Edit Button */}
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(student)}
                                className="tap-bounce text-xs md:text-sm px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold flex items-center gap-1.5 border border-blue-200/80 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>

                              {/* Delete Student Button */}
                              <button
                                type="button"
                                onClick={() => handleDeleteStudent(student)}
                                aria-label={`Delete student ${student.name}`}
                                title={`Delete ${student.name}`}
                                className="tap-bounce text-xs md:text-sm px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 font-bold flex items-center gap-1 border border-rose-200/80 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Single Admission & Edit Form Modal */}
      <StudentFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setStudentToEdit(null);
        }}
        onSuccess={handleModalSuccess}
        studentToEdit={studentToEdit}
        availableBatches={uniqueBatches}
      />

      {/* 7. Create Batch Modal */}
      <CreateBatchModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        onSuccess={handleBatchSuccess}
      />
    </div>
  );
}
