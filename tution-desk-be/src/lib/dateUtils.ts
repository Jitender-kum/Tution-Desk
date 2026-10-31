/**
 * TuitionDesk Date & Timezone Utilities
 * Enforces strict Asia/Kolkata (IST = UTC+5:30) calculations
 * for billing cycle dates, canonical months, and reminder intervals.
 */

export interface ISTDateComponents {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  billingMonth: string; // "YYYY-MM"
  monthLabel: string; // "October 2026"
  shortMonthLabel: string; // "Oct 2026"
}

/**
 * Parses any Date instance into India Standard Time (Asia/Kolkata) calendar components.
 */
export function getISTDateComponents(date: Date = new Date()): ISTDateComponents {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const month = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);

  const billingMonth = `${year}-${String(month).padStart(2, "0")}`;

  const monthLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "long",
    year: "numeric",
  }).format(date);

  const shortMonthLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    year: "numeric",
  }).format(date);

  return {
    year,
    month,
    day,
    billingMonth,
    monthLabel,
    shortMonthLabel,
  };
}

/**
 * Returns canonical billing key in "YYYY-MM" format under Asia/Kolkata timezone.
 */
export function formatBillingMonth(date: Date = new Date()): string {
  return getISTDateComponents(date).billingMonth;
}

/**
 * Determines the first eligible billing month for a student.
 * Rule: If joinDayIST >= billingCycleDay, the current month's cycle is considered passed
 * or active today, so recurring automated billing starts from the NEXT eligible cycle.
 * If joinDayIST < billingCycleDay, the student joins ahead of this month's cycle and
 * is eligible in the current month.
 */
export function calculateFirstBillingMonth(
  joiningDate: Date,
  billingCycleDay: number
): string {
  const { year, month, day } = getISTDateComponents(joiningDate);

  if (day < billingCycleDay) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  // Next calendar month
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/**
 * Checks if a student is eligible for automated billing in targetBillingMonth.
 */
export function isStudentEligibleForBilling(
  joiningDate: Date | undefined | null,
  billingCycleDay: number,
  targetBillingMonth: string
): boolean {
  if (!joiningDate) {
    return true; // Existing students with unrecorded joining date remain eligible
  }

  const firstEligible = calculateFirstBillingMonth(joiningDate, billingCycleDay);
  return targetBillingMonth >= firstEligible;
}

/**
 * Calculates payment due date from reference date using configured offset in days.
 * Preserves the existing 5-day default for centers.
 */
export function calculateDueDate(
  referenceDate: Date = new Date(),
  offsetDays: number = 5
): Date {
  const safeOffset = Math.max(0, Number(offsetDays) || 5);
  const due = new Date(referenceDate);
  due.setDate(due.getDate() + safeOffset);
  return due;
}

/**
 * Automated 7-day reminder cooldown rule:
 * Unpaid fee is eligible for automated follow-up reminder if:
 * 1. Never reminded (lastReminderDate is null/undefined)
 * 2. At least 7 full days (7 * 24 * 60 * 60 * 1000 ms) have elapsed since last reminder
 */
export function isEligibleForFollowupReminder(
  lastReminderDate: Date | undefined | null,
  now: Date = new Date()
): boolean {
  if (!lastReminderDate) {
    return true;
  }
  const diffMs = now.getTime() - new Date(lastReminderDate).getTime();
  return diffMs >= 7 * 24 * 60 * 60 * 1000;
}

/**
 * Manual 24-hour reminder cooldown rule:
 * Returns true if a reminder was dispatched within the last 24 hours.
 */
export function isWithin24HourCooldown(
  lastReminderDate: Date | undefined | null,
  now: Date = new Date()
): boolean {
  if (!lastReminderDate) {
    return false;
  }
  const diffMs = now.getTime() - new Date(lastReminderDate).getTime();
  return diffMs < 24 * 60 * 60 * 1000;
}
