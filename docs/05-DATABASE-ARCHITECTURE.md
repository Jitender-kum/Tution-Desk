# 05 — Database Architecture & Schemas

*Last Reviewed: November 2026*
*Status: Authoritative Database Specification*

---

## 1. Overview & Data Modeling Principles

TuitionDesk uses **MongoDB Atlas** as its document datastore, accessed through **Mongoose 9.11.3**.

### Core Design Rules:
1. **Logical Multi-Tenancy**: Every collection (except global auth session keys in the WhatsApp service) is partitioned logically using a top-level `centerId: string` field.
2. **Compound Indexing**: Tenant isolation and high-frequency queries rely on compound indexes prefixed by `centerId` (e.g. `{ centerId: 1, studentId: 1, month: 1 }`).
3. **Production Index Integrity (`autoIndex: false`)**: Schemas define `autoIndex: false` in production to prevent performance degradation and blocking during application boots. Therefore, compound and unique indexes must be provisioned via Atlas scripts or verified programmatically (`verifyLockIndexIntegrity`).
4. **Idempotency & Concurrency**: Critical billing operations employ specialized distributed locking collections (`FeeCreationLock`) backed by unique compound keys and MongoDB TTL indexes.

---

## 2. Collection & Model Directory

The database consists of 8 primary collections in the `tuitiondesk` database, plus 2 auxiliary collections used by the Baileys WhatsApp provider:

1. `centers` (`Center.ts`)
2. `students` (`Student.ts`)
3. `batches` (`Batch.ts`)
4. `attendances` (`Attendance.ts`)
5. `tests` (`Test.ts`)
6. `fees` (`Fee.ts`)
7. `feecreationlocks` (`FeeCreationLock.ts`)
8. `feereminderlogs` (`FeeReminderLog.ts`)
9. `baileys_creds` *(WhatsApp Microservice Session Keys)*
10. `baileys_auth_keys` *(WhatsApp Microservice PreKeys & Noise Keys)*

---

## 3. Schema Specifications

### 3.1 `Center` (`tution-desk-be/src/models/Center.ts`)
Represents a coaching institute tenant and owner authentication account.

| Field | Type | Required | Default | Notes / Relationships |
| :--- | :--- | :--- | :--- | :--- |
| `centerId` | `String` | **Yes** | — | Unique institute slug/ID. Primary tenant partition key. |
| `name` | `String` | **Yes** | — | Display name of the institute. |
| `ownerName` | `String` | **Yes** | — | Name of primary owner/administrator. |
| `phone` | `String` | **Yes** | — | Contact phone number. |
| `password` | `String` | **Yes** | — | Salted bcrypt password hash. |
| `themeColor`| `String` | No | `"#2563eb"` | UI branding accent color. |
| `welcomeMessageTemplate` | `String` | No | *(Welcome text)* | Templated message dispatched upon enrollment. |
| `upiId` | `String` | No | — | Direct institute UPI VPA for fee payments. |
| `dueDateOffsetDays` | `Number` | No | — | Days added to billing cycle for due date calculation. |
| `isActive` | `Boolean` | No | `true` | Tenant active state flag. |
| `createdAt` / `updatedAt` | `Date` | Auto | — | Managed via `timestamps: true`. |

**Indexes**:
- `{ centerId: 1 }` (Unique)

---

### 3.2 `Student` (`tution-desk-be/src/models/Student.ts`)
Represents an enrolled student in a tuition center.

| Field | Type | Required | Default | Notes / Relationships |
| :--- | :--- | :--- | :--- | :--- |
| `centerId` | `String` | **Yes** | — | Ref: `Center.centerId`. Multi-tenant partition key. |
| `name` | `String` | **Yes** | — | Full name of the student. |
| `batch` | `String` | **Yes** | — | Ref: `Batch.name`. Batch assignment. |
| `parentWhatsApp` | `String` | **Yes** | — | Recipient phone for fee & attendance alerts. |
| `isActive` | `Boolean` | No | `true` | Inactive students are excluded from monthly fee runs. |
| `joiningDate` | `Date` | No | `Date.now` | Enrollment timestamp. |
| `monthlyFee` | `Number` | **Yes** | `0` | Base fee billed per month (`min: 0`). |
| `billingCycleDate`| `Number` | **Yes** | — | Day of month (1–31) fee becomes due. |
| `createdAt` / `updatedAt` | `Date` | Auto | — | Managed via `timestamps: true`. |

**Indexes**:
- `{ centerId: 1 }`
- `{ batch: 1 }`

---

### 3.3 `Batch` (`tution-desk-be/src/models/Batch.ts`)
Defines instructional classes or time slots.

| Field | Type | Required | Default | Notes / Relationships |
| :--- | :--- | :--- | :--- | :--- |
| `centerId` | `String` | **Yes** | — | Ref: `Center.centerId`. Multi-tenant partition key. |
| `name` | `String` | **Yes** | — | Batch title (e.g., "Class 10 - Mathematics"). |
| `timing` | `String` | No | — | Human-readable schedule (e.g., "Mon-Wed 5:00 PM"). |
| `subject` | `String` | No | — | Subject category. |
| `isActive` | `Boolean` | No | `true` | Soft deletion status. |

**Indexes**:
- `{ centerId: 1, name: 1 }` (Unique compound index per center)

---

### 3.4 `Attendance` (`tution-desk-be/src/models/Attendance.ts`)
Daily attendance presence records.

| Field | Type | Required | Default | Notes / Relationships |
| :--- | :--- | :--- | :--- | :--- |
| `centerId` | `String` | **Yes** | — | Multi-tenant partition key. |
| `studentId` | `ObjectId` | **Yes** | — | Ref: `Student._id`. |
| `date` | `Date` | **Yes** | — | Attendance calendar date (normalized). |
| `batch` | `String` | **Yes** | — | Batch identifier at time of marking. |
| `status` | `String` | **Yes** | — | Enum: `["Present", "Absent"]`. |

**Indexes**:
- `{ centerId: 1, studentId: 1, date: 1 }`
- `{ centerId: 1, batch: 1, date: 1 }`

---

### 3.5 `Test` (`tution-desk-be/src/models/Test.ts`)
Academic assessments and marksheets.

| Field | Type | Required | Default | Notes / Relationships |
| :--- | :--- | :--- | :--- | :--- |
| `centerId` | `String` | **Yes** | — | Multi-tenant partition key. |
| `title` | `String` | **Yes** | — | Exam/test name. |
| `batch` | `String` | **Yes** | — | Target batch. |
| `date` | `Date` | **Yes** | — | Examination date. |
| `maxMarks` | `Number` | **Yes** | — | Total possible score. |
| `results` | `Array` | No | `[]` | Embedded subdocuments: `{ studentId, marksObtained, isAbsent }`. |

**Indexes**:
- `{ centerId: 1, batch: 1 }`

---

### 3.6 `Fee` (`tution-desk-be/src/models/Fee.ts`)
Monthly student fee ledger and collection records.

| Field | Type | Required | Default | Notes / Relationships |
| :--- | :--- | :--- | :--- | :--- |
| `centerId` | `String` | **Yes** | — | Multi-tenant partition key. |
| `studentId` | `ObjectId` | **Yes** | — | Ref: `Student._id`. |
| `month` | `String` | **Yes** | — | Human-readable label (e.g. "October 2026"). |
| `billingMonth` | `String` | No | — | Canonical `YYYY-MM` format (e.g. "2026-10"). |
| `feeType` | `String` | No | `"monthly_recurring"` | Enum: `["monthly_recurring", "advance", "adhoc", "registration"]`. |
| `amountDue` | `Number` | **Yes** | — | Total billable amount (`min: 0`). |
| `paidAmount` | `Number` | No | `0` | Cumulative amount collected. |
| `dueDate` | `Date` | **Yes** | — | Deadline date for payment. |
| `status` | `String` | **Yes** | — | Enum: `["Pending", "Paid", "Verification Pending", "Partial Paid"]`. |
| `paymentTransactions`| `Array` | No | `[]` | Subdocuments: `{ txnId, amount, date, mode, status }`. |
| `utrNumber` / `upiTransactionId` | `String` | No | — | Banking reference for online payments. |
| `lastReminderSentAt` | `Date` | No | — | Timestamp of last WhatsApp reminder dispatch. |
| `reminderCount` | `Number` | No | `0` | Total reminders dispatched for this invoice. |
| `reminderPaused` | `Boolean` | No | `false` | Owner flag to suppress automated reminders. |

**Indexes**:
- `{ centerId: 1, studentId: 1, month: 1 }`
- `{ centerId: 1, status: 1 }`

---

### 3.7 `FeeCreationLock` (`tution-desk-be/src/models/FeeCreationLock.ts`)
Distributed lock guaranteeing idempotency during batch fee generation.

| Field | Type | Required | Default | Notes / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `lockKey` | `String` | **Yes** | — | Composite key: `centerId:studentId:billingMonth:feeType`. Unique constraint. |
| `centerId` | `String` | **Yes** | — | Center tenant ID. |
| `studentId` | `String` | **Yes** | — | Student ID. |
| `billingMonth` | `String` | **Yes** | — | `YYYY-MM` billing cycle. |
| `holderId` | `String` | **Yes** | — | Execution run ID / Worker process UUID. |
| `status` | `String` | **Yes** | `"LOCKED"` | Enum: `["LOCKED", "COMPLETED"]`. |
| `expiresAt` | `Date` | **Yes** | — | TTL index set to expire in 10 minutes (`expires: "10m"`). |

**Indexes**:
- `{ lockKey: 1 }` (Unique)
- `{ expiresAt: 1 }` (TTL: 10m)

---

### 3.8 `FeeReminderLog` (`tution-desk-be/src/models/FeeReminderLog.ts`)
Audit trail and 24-hour rate-limiting lock for WhatsApp fee reminders.

| Field | Type | Required | Default | Notes / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `centerId` | `String` | **Yes** | — | Multi-tenant partition key. |
| `feeId` | `ObjectId` | **Yes** | — | Ref: `Fee._id`. |
| `studentId` | `ObjectId` | **Yes** | — | Ref: `Student._id`. |
| `recipientPhone` | `String` | **Yes** | — | Target WhatsApp phone number. |
| `triggerType` | `String` | **Yes** | — | Enum: `["auto_due_date", "auto_followup", "manual_owner_single", "manual_owner_bulk"]`. |
| `status` | `String` | **Yes** | — | Enum: `["attempted", "provider_accepted", "delivered", "dispatch_uncertain", "failed"]`. |
| `providerMessageId` | `String` | No | — | Message ID returned by Baileys microservice. |
| `simulated` | `Boolean` | No | `false` | True if generated under simulation mode. |
| `attemptedAt` | `Date` | No | `Date.now` | Dispatch timestamp. Used for 24h cooldown lookup. |

**Indexes**:
- `{ feeId: 1, attemptedAt: -1 }`
- `{ centerId: 1, attemptedAt: -1 }`
