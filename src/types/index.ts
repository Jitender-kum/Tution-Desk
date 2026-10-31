export interface NavItem {
  id: string;
  label: string;
  href: string;
  badge?: number | string;
  icon: string;
}

export interface TuitionCenterConfig {
  id: string;
  name: string;
  tagline: string;
  logoUrl?: string;
  primaryColor: string;
  ownerName: string;
  city: string;
}

export interface DashboardMetrics {
  collectedFeesThisMonth: number;
  pendingFeesTotal: number;
  totalActiveStudents: number;
  totalBatchesToday: number;
  pendingTestsCount: number;
  newEnquiriesCount: number;
  attendanceTodayPercentage: number;
  overdueCount?: number;
  todayAttendance?: number;
}

export interface QuickBatchAttendance {
  id: string;
  batchName: string;
  subject: string;
  timeSlot: string;
  room?: string;
  totalStudents: number;
  markedStudents: number;
  status: "pending" | "completed";
  timelineStatus: "ongoing" | "upcoming" | "completed";
}

export interface RecentActivityItem {
  id: string;
  title: string;
  subtitle: string;
  time: string;
  type: "fee" | "attendance" | "test" | "enquiry";
  amount?: number;
}

export type AttendanceStatus = "present" | "absent" | "unmarked";

export interface StudentAttendanceItem {
  id: string;
  name: string;
  rollNumber: string;
  avatarColor: string;
  initials: string;
  parentPhone: string;
  attendanceRate: number;
}

export interface OverdueFeeStudent {
  id: string; // Identifier for UI keys/backwards compatibility (contains feeId)
  feeId?: string; // Explicit MongoDB Fee record _id
  studentId?: string; // Explicit MongoDB Student record _id
  name: string;
  batchName: string;
  pendingAmount: number;
  totalAmount?: number;
  paidAmount?: number;
  daysLate: number;
  parentName: string;
  parentPhone: string;
  dueDate: string;
  lastReminderSent?: string;
  avatarColor: string;
  initials: string;
  status?: "Pending" | "Paid" | "Verification Pending" | "Partial Paid";
  title?: string;
  month?: string;
  paidDate?: string;
  paidAt?: string;
  utrNumber?: string;
  paymentMode?: string;
  receiptNumber?: string;
}

export interface TestScoreItem {
  id: string;
  testCode: string;
  testName: string;
  subject: string;
  date: string;
  score: number;
  totalMarks: number;
  classAverage: number;
  highestScore: number;
}

export interface StudentTestProfile {
  id: string;
  name: string;
  batchName: string;
  rollNumber: string;
  avatarColor: string;
  initials: string;
  parentPhone: string;
  latestScore: number;
  latestTotal: number;
  trendPercentage: number;
  currentRank: number;
  totalBatchStudents: number;
  tests: TestScoreItem[];
}

export interface HomeworkItem {
  id: string;
  subject: string;
  title: string;
  description: string;
  dueDate: string;
  status: "pending" | "submitted" | "note";
  teacherName: string;
}

export interface ParentDashboardData {
  childName: string;
  batchName: string;
  rollNumber: string;
  initials: string;
  avatarColor: string;
  attendancePercentage: number;
  totalClassesHeld: number;
  classesAttended: number;
  classesMissed: number;
  feeStatus: "due" | "paid";
  pendingFeeAmount: number;
  feeDueDate: string;
  feeDaysLate: number;
  upiId: string;
  homework: HomeworkItem[];
}

export interface StudentRecord {
  _id: string;
  centerId: string;
  name: string;
  batch: string;
  parentWhatsApp: string;
  isActive: boolean;
  joiningDate?: string;
  monthlyFee: number;
  billingCycleDate: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BatchRecord {
  _id: string;
  centerId: string;
  name: string;
  timing?: string;
  subject?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TestResult {
  studentId: string;
  marksObtained: number;
  isAbsent?: boolean;
}

export interface TestRecord {
  _id: string;
  centerId: string;
  title: string;
  batch: string;
  date: string;
  maxMarks: number;
  results?: TestResult[];
  createdAt?: string;
  updatedAt?: string;
}


