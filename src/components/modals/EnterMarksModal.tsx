"use client";

import { useState, useEffect, useMemo } from "react";
import {
  X,
  Award,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  Layers,
  Save,
  UserCheck,
  UserX,
} from "lucide-react";
import { apiClient, getCurrentCenterId } from "@/lib/apiClient";
import { TestRecord, StudentRecord, TestResult } from "@/types";

interface EnterMarksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedTest: TestRecord) => void;
  test: TestRecord | null;
}

interface StudentEntry {
  studentId: string;
  name: string;
  parentWhatsApp: string;
  marksObtained: number | string;
  isAbsent: boolean;
}

// Deterministic pastel avatar background colors
const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-purple-100 text-purple-700 border-purple-200",
  "bg-rose-100 text-rose-700 border-rose-200",
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
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function EnterMarksModal({
  isOpen,
  onClose,
  onSuccess,
  test,
}: EnterMarksModalProps) {
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [entries, setEntries] = useState<StudentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch students for the test's batch on mount or when test changes
  useEffect(() => {
    if (!isOpen || !test) return;

    async function loadBatchStudents() {
      if (!test) return;
      try {
        setLoading(true);
        setError(null);

        const res = await apiClient<StudentRecord[]>("/students", {
          params: {
            centerId: getCurrentCenterId(),
            batch: test.batch,
          },
        });

        const batchStudents = res.data || [];
        setStudents(batchStudents);

        // Map existing results or initialize
        const existingResultsMap = new Map<string, TestResult>();
        if (test.results && Array.isArray(test.results)) {
          test.results.forEach((r) => {
            const id =
              typeof r.studentId === "object" && r.studentId !== null
                ? String((r.studentId as { _id?: string })._id || r.studentId)
                : String(r.studentId);
            existingResultsMap.set(id, r);
          });
        }

        const mappedEntries: StudentEntry[] = batchStudents.map((s) => {
          const existing = existingResultsMap.get(s._id);
          return {
            studentId: s._id,
            name: s.name,
            parentWhatsApp: s.parentWhatsApp,
            marksObtained:
              existing !== undefined ? existing.marksObtained : "",
            isAbsent: Boolean(existing?.isAbsent),
          };
        });

        setEntries(mappedEntries);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to load students.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    loadBatchStudents();
  }, [isOpen, test]);

  // Handle Marks Change
  const handleMarksChange = (studentId: string, val: string) => {
    if (error) setError(null);
    setEntries((prev) =>
      prev.map((e) => {
        if (e.studentId !== studentId) return e;
        return {
          ...e,
          marksObtained: val === "" ? "" : Number(val),
        };
      })
    );
  };

  // Toggle Absent Status
  const handleToggleAbsent = (studentId: string) => {
    if (error) setError(null);
    setEntries((prev) =>
      prev.map((e) => {
        if (e.studentId !== studentId) return e;
        const newAbsent = !e.isAbsent;
        return {
          ...e,
          isAbsent: newAbsent,
          marksObtained: newAbsent ? 0 : e.marksObtained,
        };
      })
    );
  };

  // Summary Metrics
  const summary = useMemo(() => {
    const total = entries.length;
    const absent = entries.filter((e) => e.isAbsent).length;
    const evaluated = entries.filter(
      (e) => !e.isAbsent && e.marksObtained !== ""
    ).length;

    const totalMarksScored = entries
      .filter((e) => !e.isAbsent && e.marksObtained !== "")
      .reduce((sum, e) => sum + Number(e.marksObtained || 0), 0);

    const classAverage =
      evaluated > 0 ? (totalMarksScored / evaluated).toFixed(1) : "—";

    return { total, absent, evaluated, classAverage };
  }, [entries]);

  if (!isOpen || !test) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate no marks exceed test.maxMarks
    for (const entry of entries) {
      if (!entry.isAbsent && entry.marksObtained !== "") {
        const marks = Number(entry.marksObtained);
        if (marks < 0) {
          setError(`Marks cannot be negative for ${entry.name}.`);
          return;
        }
        if (marks > test.maxMarks) {
          setError(
            `Marks for ${entry.name} (${marks}) exceed maximum marks (${test.maxMarks}).`
          );
          return;
        }
      }
    }

    setSaving(true);

    try {
      const resultsPayload = entries
        .filter((e) => e.isAbsent || e.marksObtained !== "")
        .map((e) => ({
          studentId: e.studentId,
          marksObtained: e.isAbsent ? 0 : Number(e.marksObtained || 0),
          isAbsent: e.isAbsent,
        }));

      const res = await apiClient<TestRecord>(`/tests/${test._id}`, {
        method: "PUT",
        body: {
          results: resultsPayload,
        },
      });

      onSuccess(res.data);
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to save test marks.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden my-4 max-h-[92vh] flex flex-col">
        {/* Accent Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 flex-shrink-0" />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/25 ring-2 ring-emerald-100">
              <Award className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 leading-tight">
                  Enter Test Marks
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  Max: {test.maxMarks}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {test.title} • {test.batch}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Stats Bar */}
        <div className="px-4 py-2.5 bg-slate-100/70 border-b border-slate-200/60 flex items-center justify-between text-xs text-slate-600 flex-shrink-0">
          <div className="flex items-center gap-3 font-semibold">
            <span>
              Evaluated:{" "}
              <strong className="text-slate-900">
                {summary.evaluated}/{summary.total}
              </strong>
            </span>
            <span>
              Absent:{" "}
              <strong className="text-rose-600">{summary.absent}</strong>
            </span>
          </div>
          <div className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
            Average: {summary.classAverage}/{test.maxMarks}
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-4 mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2.5 text-xs animate-shake flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <span className="font-semibold leading-tight">{error}</span>
          </div>
        )}

        {/* Student Marks List (Scrollable) */}
        <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
            {loading ? (
              <div className="p-8 text-center space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
                <p className="text-xs text-slate-500 font-medium">
                  Loading enrolled students for {test.batch}...
                </p>
              </div>
            ) : entries.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Users className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs text-slate-500 font-medium">
                  No students currently enrolled in {test.batch}.
                </p>
              </div>
            ) : (
              entries.map((student, idx) => {
                const avatarClass = getAvatarColor(student.name);
                const initials = getInitials(student.name);

                return (
                  <div
                    key={student.studentId}
                    className={`p-3 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 ${
                      student.isAbsent
                        ? "bg-slate-50/80 border-slate-200 opacity-75"
                        : student.marksObtained !== ""
                        ? "bg-white border-emerald-200 shadow-xs ring-1 ring-emerald-100"
                        : "bg-white border-slate-200 shadow-xs"
                    }`}
                  >
                    {/* Left: Avatar & Name */}
                    <div className="flex items-center gap-2.5 min-w-0 w-full sm:w-auto">
                      <span className="text-[11px] font-bold text-slate-400 w-4 text-center">
                        {idx + 1}
                      </span>
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs border flex-shrink-0 ${avatarClass}`}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-slate-900 truncate leading-tight">
                          {student.name}
                        </h4>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          +91 {student.parentWhatsApp}
                        </p>
                      </div>
                    </div>

                    {/* Right: Marks Input & Absent Toggle */}
                    <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto flex-shrink-0 pt-1.5 sm:pt-0 border-t sm:border-t-0 border-slate-100/80">
                      {/* Absent Toggle Button */}
                      <button
                        type="button"
                        onClick={() => handleToggleAbsent(student.studentId)}
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1 ${
                          student.isAbsent
                            ? "bg-rose-500 text-white shadow-xs"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                        title={
                          student.isAbsent
                            ? "Marked as Absent"
                            : "Click to mark Absent"
                        }
                      >
                        {student.isAbsent ? (
                          <>
                            <UserX className="w-3.5 h-3.5" />
                            <span>Absent</span>
                          </>
                        ) : (
                          <span>Absent?</span>
                        )}
                      </button>

                      {/* Marks Input */}
                      <div className="relative w-20">
                        <input
                          type="number"
                          min="0"
                          max={test.maxMarks}
                          step="1"
                          disabled={student.isAbsent}
                          value={student.marksObtained}
                          onChange={(e) =>
                            handleMarksChange(student.studentId, e.target.value)
                          }
                          placeholder="—"
                          className={`w-full rounded-xl border text-center text-sm font-bold py-1.5 px-2 transition-all ${
                            student.isAbsent
                              ? "bg-slate-200/50 border-slate-200 text-slate-400 cursor-not-allowed"
                              : "bg-white border-slate-300 text-slate-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                          }`}
                        />
                      </div>
                      <span className="text-xs text-slate-400 font-semibold w-8">
                        /{test.maxMarks}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Modal Footer Actions */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/70 flex items-center gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="tap-bounce flex-1 h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving || entries.length === 0}
              className="tap-bounce flex-1 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Marks...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 stroke-[2.2]" />
                  <span>Save Test Marks</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
