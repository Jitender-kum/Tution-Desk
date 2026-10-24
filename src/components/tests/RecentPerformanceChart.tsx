import { useState } from "react";
import { TestScoreItem } from "@/types";
import { BarChart3, Info } from "lucide-react";

interface RecentPerformanceChartProps {
  tests: TestScoreItem[];
}

export default function RecentPerformanceChart({
  tests,
}: RecentPerformanceChartProps) {
  const [selectedTestId, setSelectedTestId] = useState<string>(
    tests[tests.length - 1]?.id || ""
  );

  const selectedTest =
    tests.find((t) => t.id === selectedTestId) || tests[tests.length - 1];

  const averageScore = Math.round(
    tests.reduce((acc, curr) => acc + curr.score, 0) / (tests.length || 1)
  );

  const yTicks = [100, 75, 50, 25, 0];

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4.5 shadow-sm space-y-4">
      {/* Title & Average Badge */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4 text-[var(--primary-color)]" />
            Recent Performance
          </h2>
          <p className="text-[11px] text-slate-500">
            Scores for the last 6 weekly tests
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[var(--primary-color)] border border-blue-100/70">
          Avg: {averageScore}%
        </span>
      </div>

      {/* Vertical Bar Chart with Y-Axis and X-Axis */}
      <div className="pt-4 pb-2">
        <div className="relative flex h-48 w-full items-end gap-2">
          {/* Y-Axis Scale Labels & Horizontal Gridlines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {yTicks.map((tick) => (
              <div
                key={tick}
                className="flex items-center w-full border-b border-slate-100 text-[10px] font-medium text-slate-400 font-mono"
              >
                <span className="w-6 -mt-2 text-left pr-1">{tick}</span>
              </div>
            ))}
          </div>

          {/* Bars Area (Offset for Y-axis labels) */}
          <div className="relative z-10 flex h-full flex-1 items-end justify-between pl-7 pr-1">
            {tests.map((test, index) => {
              const isSelected = test.id === selectedTest?.id;
              const isLatest = index === tests.length - 1;
              const barHeightPercent = Math.min(
                Math.max((test.score / test.totalMarks) * 100, 10),
                100
              );

              return (
                <div
                  key={test.id}
                  onClick={() => setSelectedTestId(test.id)}
                  className="group relative flex h-full flex-col items-center justify-end cursor-pointer tap-bounce"
                  style={{ width: `${100 / tests.length - 2}%` }}
                >
                  {/* Floating Score on Top of Bar */}
                  <span
                    className={`absolute -top-6 text-[10px] font-extrabold font-mono transition-transform duration-200 ${
                      isSelected
                        ? "text-[var(--primary-color)] scale-110"
                        : "text-slate-600 group-hover:scale-105"
                    }`}
                  >
                    {test.score}
                  </span>

                  {/* The Vertical Bar */}
                  <div
                    className={`w-full max-w-[32px] rounded-t-xl transition-all duration-300 shadow-2xs ${
                      isSelected
                        ? "bg-gradient-to-t from-[var(--primary-dark)] via-[var(--primary-color)] to-blue-400 ring-2 ring-blue-300/60 shadow-md shadow-blue-500/20"
                        : isLatest
                        ? "bg-gradient-to-t from-[var(--primary-color)] to-blue-300"
                        : "bg-gradient-to-t from-slate-300 to-blue-200 hover:from-blue-400 hover:to-blue-300"
                    }`}
                    style={{ height: `${barHeightPercent}%` }}
                  />

                  {/* X-Axis Labels: Test Code (T1..T6) */}
                  <div className="mt-2 text-center">
                    <span
                      className={`block text-[11px] font-bold leading-tight ${
                        isSelected
                          ? "text-[var(--primary-color)]"
                          : "text-slate-700"
                      }`}
                    >
                      {test.testCode}
                    </span>
                    <span className="block text-[9px] font-medium text-slate-400 whitespace-nowrap">
                      {test.date}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active Test Micro-Details Pill */}
      {selectedTest && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 font-extrabold font-mono text-xs flex-shrink-0">
              {selectedTest.testCode}
            </div>
            <div className="truncate">
              <span className="font-bold text-slate-800 block truncate leading-tight">
                {selectedTest.testName}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Class Avg: {selectedTest.classAverage} • Highest: {selectedTest.highestScore}
              </span>
            </div>
          </div>

          <div className="text-right flex-shrink-0 pl-2">
            <span className="text-sm font-extrabold text-[var(--primary-color)] font-mono block">
              {selectedTest.score}/{selectedTest.totalMarks}
            </span>
            <span className="text-[10px] font-semibold text-emerald-600">
              Score: {Math.round((selectedTest.score / selectedTest.totalMarks) * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
