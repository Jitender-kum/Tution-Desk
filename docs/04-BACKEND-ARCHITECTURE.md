# 04 — Backend Architecture & Service Layer

*Last Reviewed: November 2026*
*Status: Authoritative Engineering Specification*

---

## 1. Overview & Technology Stack

The TuitionDesk backend is structured as a headless Next.js App Router API application (`/tution-desk-be`). It serves REST API endpoints consumed by the frontend application and handles webhook events from third-party payment providers.

- **Framework**: Next.js 16.4.2 (App Router Route Handlers)
- **Data Persistence**: MongoDB Atlas via Mongoose 9.11.3
- **Authentication**: JWT token verification using `jose` v6.2.13
- **Password Hashing**: `bcryptjs` v3.0.3
- **CORS Handling**: `src/lib/cors.ts` (Supports dynamic comma-separated `ALLOWED_ORIGINS`)
- **Deployment**: Vercel Serverless Platform (`tuition-desk-backend.vercel.app`)

---

## 2. Directory & Architecture Map

```
d:/Tution Desk/tution-desk-be/src/
├── app/
│   └── api/                   # REST API route handlers
│       ├── attendance/        # Attendance recording and retrieval
│       ├── auth/              # Registration, login, logout, session verification
│       ├── batches/           # Academic batch CRUD
│       ├── centers/           # Center profile configuration
│       ├── cron/              # Cron endpoints (fee generation, reminders)
│       ├── dashboard/         # Owner dashboard aggregate statistics
│       ├── fees/              # Fee ledgers, manual collection, reminder triggers
│       ├── notifications/     # WhatsApp status and QR pairing proxy
│       ├── parent/            # Public parent portal data endpoints
│       ├── students/          # Student registration and roster management
│       ├── tests/             # Academic assessments and marks entry
│       └── webhooks/          # Payment gateway reconciliation webhooks
├── lib/                       # Core service layer & system utilities
│   ├── auth.ts                # JWT extraction & tenant isolation helpers
│   ├── backfillPlanner.ts     # Reconciliation backfill planning utility
│   ├── cors.ts                # CORS origin resolution & preflight handlers
│   ├── dateUtils.ts           # Timezone-aware date calculations
│   ├── db.ts                  # Cached Mongoose MongoDB connection pooling
│   ├── env.ts                 # Environment validation and type coercion
│   ├── feeGenerator.ts        # Monthly student fee ledger generator
│   ├── feeService.ts          # Core fee state machine & manual collection
│   ├── jwt.ts                 # Jose JWT signing and verification
│   ├── lockReadiness.ts       # MongoDB unique index verification
│   ├── reconciliationEngine.ts# Automated payment reconciliation
│   ├── reminderService.ts     # WhatsApp reminder dispatch & cooldown logic
│   ├── snapshotReader.ts      # Immutable state snapshot verification
│   ├── stagingTestHarness.ts  # Staging simulation safety utilities
│   └── whatsappService.ts     # Internal WhatsApp client dispatcher
└── models/                    # Mongoose database models & schemas
    ├── Attendance.ts          # Attendance records
    ├── Batch.ts               # Academic batch definitions
    ├── Center.ts              # Multi-tenant center profile & auth credentials
    ├── Fee.ts                 # Monthly student fee ledger
    ├── FeeCreationLock.ts     # Distributed lock for idempotent billing
    ├── FeeReminderLog.ts      # 24-hour reminder cooldown logs
    ├── Student.ts             # Student demographic & enrollment records
    ├── Test.ts                # Assessment & marksheet records
    └── index.ts               # Model registry barrel export
```

---

## 3. Database Connection Pooling (`src/lib/db.ts`)

Serverless environments on Vercel spin up ephemeral execution containers that can exhaust database connection pools. TuitionDesk mitigates this by maintaining a cached connection promise on the NodeJS `global` object:

```typescript
// Source: tution-desk-be/src/lib/db.ts
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}
declare global {
  var mongoose: MongooseCache | undefined;
}
```
Every incoming API request awaits `connectDB()`, which reuses the existing `mongoose.conn` or initiates a single shared `mongoose.connect(MONGODB_URI)`.

---

## 4. Service Layer & Business Logic

### 4.1 Fee State Machine (`src/lib/feeService.ts`)
The fee service manages financial ledger operations:
- `generateMonthlyFees(centerId, month, year)`: Scans all active students in the center and creates a `Fee` document for each student using their `student.monthlyFee`.
- `recordManualPayment(feeId, amount, mode, reference, notes)`: Safely credits payments, increments `paidAmount`, calculates `remainingAmount`, and transitions status:
  - If `remainingAmount === 0` $\rightarrow$ `PAID`
  - If `paidAmount > 0 && remainingAmount > 0` $\rightarrow$ `PARTIALLY_PAID`
  - If `remainingAmount > 0 && dueDate < today` $\rightarrow$ `OVERDUE`

### 4.2 Distributed Concurrency Locks (`src/lib/feeGenerator.ts` & `FeeCreationLock.ts`)
To prevent concurrent duplicate monthly fee creation when multiple administrators click "Generate" or when cron triggers run simultaneously:
1. An atomic write is attempted to the `FeeCreationLock` collection with a unique compound index on `{ centerId: 1, month: 1, year: 1 }`.
2. If another process holds the lock, MongoDB throws a `11000 E11000 duplicate key error`, aborting duplicate runs cleanly.
3. The lock has a TTL of 10 minutes to auto-expire if a worker terminates abruptly.

### 4.3 WhatsApp Reminder Service (`src/lib/reminderService.ts`)
Handles fee payment reminder dispatches:
- Checks `FeeReminderLog` to enforce a 24-hour cooldown per fee record.
- Formats message text with student name, month, balance, and online payment URL.
- Dispatches payload to the WhatsApp microservice via `whatsappService.ts`.
- Maps microservice errors into domain result codes:
  - `SUCCESS`: Message accepted by WhatsApp microservice.
  - `COOLDOWN_ACTIVE`: Blocked by 24h throttle.
  - `PROVIDER_REJECTED`: Center WhatsApp session not ready or QR not scanned.
  - `SERVICE_UNAVAILABLE`: WhatsApp microservice unreachable.
  - `DISPATCH_UNCERTAIN`: Socket timed out after 25s.

---

## 5. Background Jobs & Schedulers (`src/app/api/cron/`)

The backend exposes authenticated cron endpoints designed to be invoked by external schedulers (e.g. Vercel Cron or GitHub Actions):

1. **Monthly Fee Generation** (`GET /api/cron/generate-fees`):
   - Authenticated via `Authorization: Bearer CRON_SECRET`.
   - Iterates over all active centers and triggers `generateMonthlyFees` on the 1st of every month.
2. **Overdue Fee Reminders** (`GET /api/cron/overdue-reminders`):
   - Scans all fees with status `PENDING` or `PARTIALLY_PAID` where `dueDate < Date.now()`.
   - Automatically dispatches reminders subject to the 24-hour `FeeReminderLog` cooldown.

---

## 6. Error Handling & Validation Patterns

- **Input Validation**: Critical routes validate incoming request parameters before query construction (e.g. fee amount must be positive, month must be 1–12, year must be valid).
- **HTTP Status Code Mapping**:
  - `400 Bad Request`: Malformed JSON or invalid parameter values.
  - `401 Unauthorized`: Missing or invalid JWT session cookie / Bearer token.
  - `404 Not Found`: Target entity (`Student`, `Fee`, `Batch`) does not exist.
  - `409 Conflict`: Concurrency lock collision or cooldown violation.
  - `500 Internal Server Error`: Unhandled database or runtime exception.
  - `503 Service Unavailable`: Dependent microservice (WhatsApp) offline.
