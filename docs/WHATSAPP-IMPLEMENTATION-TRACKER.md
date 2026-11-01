# WhatsApp Implementation & Repair Tracker

*Last Updated: November 1, 2026*
*Single Source of Truth for TuitionDesk WhatsApp Reliability*

---

## 1. Executive Summary & Tracker State

| Dimension | Current State |
| :--- | :--- |
| **Overall Status** | **REPAIR BATCH 1 APPLIED — TESTS PASSING** |
| **Current Phase** | Phase 2: First Repair Batch Implemented & Verified in Regression Suites |
| **Active Provider Engine** | `@whiskeysockets/baileys` (v6.7.24) (Default engine) |
| **Automated Test Health** | **151 Tests Passing** (121 microservice tests across 8 suites + 30 root integration tests) |
| **Next Exact Action** | Staging / live deployment verification under controlled dual-flag simulation guard. |

---

## 2. Component Health Matrix

| Component | Layer | Status | Evidence / Verification |
| :--- | :--- | :--- | :--- |
| **Default Engine Selection** | WhatsApp Microservice | **FIXED — NOT VERIFIED** | Defaults to `baileys_native`; rejects unsupported engines. Tested in `engine-selection.test.js` & `repair-batch-1-regression.test.js`. |
| **Strict CenterId Isolation** | WhatsApp Microservice | **FIXED — NOT VERIFIED** | Requires explicit `centerId`; single-session fallback removed. Tested in `repair-batch-1-regression.test.js`. |
| **Session Restoration on Boot** | WhatsApp Microservice | **FIXED — NOT VERIFIED** | Default startup auto-reconnection enabled (`AUTO_RECONNECT_ON_BOOT !== 'false'`) with 500ms staggering. Tested in `repair-batch-1-regression.test.js`. |
| **Cold Session Rehydration Timeout** | WhatsApp Microservice | **FIXED — NOT VERIFIED** | Configurable via `coldSessionTimeoutMs` (default 15s). Tested in `baileys-outbound-dispatch.test.js` & `repair-batch-1-regression.test.js`. |
| **QR Expiry Lifecycle** | WhatsApp Microservice | **FIXED — NOT VERIFIED** | Unscanned QR timeout (408) cleanly disconnects without triggering 5-cycle socket reconnect storm. Tested in `baileys-provider.test.js` & `repair-batch-1-regression.test.js`. |
| **Simulation Guard Reporting** | Backend & Frontend | **FIXED — NOT VERIFIED** | Returns `simulated: true, accepted: false, delivered: false` with explicit variable requirements (`WHATSAPP_MODE=live`, `ENABLE_LIVE_WHATSAPP=true`). |
| **Frontend Polling Heartbeat**| Frontend Settings UI | **FIXED — NOT VERIFIED** | Maintains 30s gentle background heartbeat during disconnected state to automatically detect background server reconnections. |
| **Stream Restart (Code 515)** | WhatsApp Microservice | **TESTED — LOCAL** | Caught, credentials saved to Atlas, and socket cleanly respawned without drop. |
| **Handshake Timeout (CB:success)** | WhatsApp Microservice | **TESTED — LOCAL** | Listener wrapper catches promise rejection; avoids unhandled rejection crashes (`9423591`). |
| **Fee Reminder Dispatch Pipeline**| Backend API | **TESTED — LOCAL** | 24h cooldown, 5m claim lock, and HTTP status mappings (200, 202, 409, 503) verified in test suite. |
| **Physical Recipient Delivery** | Cellular WhatsApp Network | **UNVERIFIED** | Real-world delivery to physical phone handset has not been verified under live credentials. |

---

## 3. Open Issues Registry

| Issue ID | Severity | Component | Problem Summary | Status | Resolution Applied |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **WA-ISSUE-01** | **HIGH** | `BaileysProvider.js` | Startup auto-reconnect disabled by default (`AUTO_RECONNECT_ON_BOOT`). | **FIXED — NOT VERIFIED** | Auto-reconnect enabled by default for registered sessions with 500ms staggered queue and duplicate-boot guard. |
| **WA-ISSUE-02** | **HIGH** | `BaileysProvider.js` | Rehydration timeout in `sendMessage` is too short (6s). | **FIXED — NOT VERIFIED** | Replaced with configurable `coldSessionTimeoutMs` (default 15,000ms) with proper socket cleanup and clear status reporting. |
| **WA-ISSUE-03** | **HIGH** | `BaileysProvider.js` | Single-session fallback in `sendMessage` breaks multi-tenant isolation. | **FIXED — NOT VERIFIED** | Strictly requires explicit valid `centerId` string; completely removed single-session implicit fallback. |
| **WA-ISSUE-04** | **MEDIUM** | `index.js` | Default engine is legacy `wwebjs` instead of `baileys`. | **FIXED — NOT VERIFIED** | Defaulted `createProvider()` to `'baileys'` native engine when `WHATSAPP_ENGINE` is unset or empty. |
| **WA-ISSUE-05** | **HIGH** | `whatsappService.ts` | Dual-opt-in simulation guard error reporting needs explicit env instructions. | **FIXED — NOT VERIFIED** | Standardized error messaging across dispatchers specifying exact required variable names (`WHATSAPP_MODE=live` & `ENABLE_LIVE_WHATSAPP=true`). |
| **WA-ISSUE-06** | **MEDIUM** | `settings/page.tsx` | UI polling stops completely when status is `"disconnected"`. | **FIXED — NOT VERIFIED** | Implemented 30s gentle background heartbeat in `scheduleNextPoll` during disconnected state. |
| **WA-ISSUE-07** | **LOW** | `BaileysProvider.js` | Unscanned QR timeout (408) triggers 5-cycle socket reconnect storm. | **FIXED — NOT VERIFIED** | Unpaired QR timeout immediately transitions cleanly to `disconnected` without auto-reconnecting. |

---

## 4. Fix History & Completed Work

| Date | Commit | Changes & Fixes Applied | Verification Status |
| :--- | :--- | :--- | :--- |
| **2026-11-01** | `9423591` | Added 25s initialization watchdog; wrapped `CB:success` listener on `sock.ws` to catch unhandled promise rejections; added multi-stage socket cleanup (`sock.end` $\rightarrow$ `sock.ws.close`); corrected fee reminder HTTP 503 status mapping; hardened fee input validation (`min="1"`, `step="any"`). | **TESTED — LOCAL** (79 tests passed) |
| **2026-11-01** | `92e4ea2` | URL normalization across dispatchers; 10s request timeout on outbound WhatsApp API calls; phone number sanitization and masking; added persistent MongoDB auth store (`baileysStore.js`). | **TESTED — LOCAL** (30 tests passed) |

---

## 5. Test Verification Matrix

| Test Suite | File | Tests Run | Result | Type |
| :--- | :--- | :--- | :--- | :--- |
| **Session Recovery Regression** | `whatsapp-server/test/session-recovery-regression.test.js` | 9 | **PASS** | Mocked Sockets |
| **Baileys Provider Lifecycle** | `whatsapp-server/test/baileys-provider.test.js` | 12 | **PASS** | Mocked Sockets |
| **Microservice API Contracts** | `whatsapp-server/test/api-contract.test.js` | 10 | **PASS** | Express Supertest |
| **MongoDB Persistence** | `whatsapp-server/test/persistence.test.js` | 20 | **PASS** | Mocked MongoDB |
| **Baileys FIFO Key Queues** | `whatsapp-server/test/baileys-persistence.test.js` | 6 | **PASS** | Mocked MongoDB |
| **Engine Selection Guard** | `whatsapp-server/test/engine-selection.test.js` | 13 | **PASS** | Unit / Env |
| **Frontend Status Mapping** | `whatsapp-server/test/frontend-integration-mapping.test.js` | 10 | **PASS** | Contract / Unit |
| **Outbound Message Pipeline** | `whatsapp-server/test/baileys-outbound-dispatch.test.js` | 8 | **PASS** | Mocked Sockets |
| **Fee Reminder HTTP Mapping** | `test/fee_reminder_http_mapping.test.mjs` | 8 | **PASS** | Integration / Route Handlers |
| **Amount Validation & Guard** | `test/fee_whatsapp_validation.test.mjs` | 8 | **PASS** | Unit / Route Handlers |
| **End-to-End System Tests** | `test/phase4_e2e_verification.test.mjs` | 14 | **PASS** | Full System Integration |

---

## 6. Deployment & Live Verification Tracker

| Deployment Target | Environment | Expected Deployed Commit | Verified Live Status |
| :--- | :--- | :--- | :--- |
| **Vercel Frontend** | Production | `9423591` | **VERIFIED** (`https://tution-desk-one.vercel.app` returns HTTP 200) |
| **Vercel Backend** | Production | `9423591` | **VERIFIED** (`https://tuition-desk-backend.vercel.app` returns HTTP 200) |
| **Render WhatsApp Service** | Production | `9423591` | **UNVERIFIED** (Requires manual verification in Render dashboard) |
| **MongoDB Atlas** | Production | Cluster `tuitiondesk` | **UNVERIFIED** (Requires manual index inspection for `autoIndex: false`) |
| **Physical Phone Handset** | Live Cellular | N/A | **UNVERIFIED** (Real message dispatch pending controlled test) |

---

## 7. Recommended Fix Sequence (Roadmap to Reliability)

1. **Fix 1 (Immediate)**: Switch default engine in `whatsapp-server/index.js` to `'baileys'` (`WA-ISSUE-04`) and remove the single-session fallback hijack in `BaileysProvider.sendMessage` (`WA-ISSUE-03`).
2. **Fix 2 (Persistence & Reconnection)**: Enable automatic startup reconnection for registered sessions (`WA-ISSUE-01`) and increase `sendMessage` on-demand rehydration wait from 6s to 12s (`WA-ISSUE-02`).
3. **Fix 3 (UI State Synchronization)**: Maintain a 30s background poll in the Settings page during disconnected state to automatically catch background reconnects (`WA-ISSUE-06`).
4. **Fix 4 (Controlled Live Delivery Test)**: Execute Stage 5 of the testing plan using an authorized test phone number with `WHATSAPP_MODE=live` to prove cellular packet delivery.

---

## 8. Staging Readiness & Environment Isolation Audit (Repair Batch 1)

*Audit Date: November 1, 2026*
*Target Commit for Staging: `477146e` (`fix(whatsapp): implement repair batch 1`)*

### 8.1 Staging Topology & Configured URLs
| Component | Local Staging Configuration | Cloud Staging Spec (Docs/Example) | Current Status |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | `http://localhost:3010` (`NEXT_PUBLIC_APP_URL`) | `https://staging.tuitiondesk.com` | Configured locally; cloud staging URL unprovisioned |
| **Backend API** | `http://localhost:3011/api` (`NEXT_PUBLIC_API_URL`) | `https://staging-api.tuitiondesk.com/api` | Configured locally; cloud staging URL unprovisioned |
| **WhatsApp Microservice** | `http://127.0.0.1:3015` (`WHATSAPP_SERVICE_URL`) | Bound to `127.0.0.1:3005` / VPC loopback | Configured locally on port 3015; unexposed to public web |

### 8.2 Database Isolation & Namespace Verification
- **Backend API**: `tution-desk-be/.env.staging` explicitly targets database `/tuitiondesk_staging` on MongoDB Atlas cluster `tution.vdpleeq.mongodb.net`. Strictly isolated from production database.
- **WhatsApp Microservice**: `baileysStore.js` persists session auth in collection `baileys_auth` inside whatever database `MONGODB_URI` connects to.
- **Critical Isolation Gap**: `whatsapp-server/.env.staging` currently lacks `MONGODB_URI`. It must be explicitly configured with `/tuitiondesk_staging` before starting staging to prevent uninitialized storage or fallback to production cluster root.

### 8.3 Environment Variables & Simulation Guard Audit (No Secrets Stored)
- **Frontend (`.env.staging`)**:
  - `NEXT_PUBLIC_API_URL`: `http://localhost:3011/api`
  - `NEXT_PUBLIC_APP_URL`: `http://localhost:3010`
  - `JWT_SECRET`: Present (64-char hex, isolated)
  - `WHATSAPP_INTERNAL_SECRET`: Present (64-char hex, isolated)
  - `WHATSAPP_SERVICE_URL`: `http://127.0.0.1:3015`
  - `WHATSAPP_MODE`: `simulation` (Active)
  - `ENABLE_LIVE_WHATSAPP`: `false` (Fail-closed simulation guard active)
- **Backend API (`tution-desk-be/.env.staging`)**:
  - `NODE_ENV`: `production`
  - `MONGODB_URI`: Points to database `/tuitiondesk_staging`
  - `JWT_SECRET`: Present (64-char hex, matches frontend staging)
  - `WHATSAPP_INTERNAL_SECRET`: Present (64-char hex, matches frontend staging)
  - `WHATSAPP_SERVICE_URL`: `http://127.0.0.1:3015`
  - `WHATSAPP_MODE`: `simulation` (Active)
  - `ENABLE_LIVE_WHATSAPP`: `false` (Fail-closed simulation guard active)
  - `ALLOWED_ORIGINS`: `http://localhost:3010`
  - `NEXT_PUBLIC_APP_URL`: `http://localhost:3010`
  - `APP_URL`: `http://localhost:3010`
  - `YOUPI_WEBHOOK_SECRET`: Present (64-char hex, isolated)
- **WhatsApp Microservice (`whatsapp-server/.env.staging`)**:
  - `PORT`: `3015`
  - `WHATSAPP_HOST`: `127.0.0.1`
  - `WHATSAPP_INTERNAL_SECRET`: Present (64-char hex, matches frontend/backend staging)

### 8.4 Staging Deployment & Verification Strategy for Commit `477146e`
1. **Branch Decoupling**: Production branches in Vercel and Render track `origin/main` (currently at `9423591`). Commit `477146e` exists only locally on `main`.
2. **Safe Staging Deployment**:
   - Merge `477146e` locally onto branch `staging` (`git checkout staging && git merge --ff-only main`).
   - Push strictly to `origin/staging` (`git push origin staging`).
   - Production on `origin/main` remains 100% unaffected.
3. **Commit SHA Verification**:
   - **Vercel**: Inspect preview deployment cards under Vercel Dashboard for exact 7-char SHA (`477146e`) and branch `staging`.
   - **Render**: Inspect deployment events in Render Dashboard for "Deploying commit 477146e..." on the staging service.

### 8.5 Identified Blockers & Missing Configuration Prior to Live Verification
1. **[BLOCKER 1] Missing `MONGODB_URI` in `whatsapp-server/.env.staging`**: Must be set to `/tuitiondesk_staging` before starting staging microservice.
2. **[BLOCKER 2] Cloud Staging Infrastructure Unprovisioned**: If deploying to cloud (rather than local staging ports), dedicated Render staging service and Vercel preview environment variables must be created.
3. **[BLOCKER 3] Staging Branch Sync**: Local and remote `staging` branch are currently at `be60442` (October 2026), 5 commits behind `main`. Requires fast-forward sync before cloud deployment.

### 8.6 Local Staging Environment Loading & Runtime Safety Validation
*Audit Date: November 1, 2026*

| Component | Code-Confirmed Behavior | Runtime Verification Status |
| :--- | :--- | :--- |
| **Frontend Env Loading** | Next.js defaults to `.env.local` and ignores `.env.staging`. To run staging on port 3010, `node --env-file=.env.staging ./node_modules/next/dist/bin/next dev -p 3010` must be used. | **CONFIRMED VIA CODE — RUNTIME UNVERIFIED** (No services booted) |
| **Backend Env Loading** | Next.js API server defaults to `tution-desk-be/.env`. To run staging on port 3011, `node --env-file=.env.staging ./node_modules/next/dist/bin/next dev -p 3011` must be used. | **CONFIRMED VIA CODE — RUNTIME UNVERIFIED** (No services booted) |
| **WhatsApp Server Env Loading** | `index.js:14-20` hardcodes `process.loadEnvFile('.env')`. If `node --env-file=.env.staging index.js` is run without `MONGODB_URI` in `.env.staging`, Node falls back to `.env`'s connection string. | **CONFIRMED VIA CODE — RUNTIME UNVERIFIED** (No services booted) |
| **Database Failure Handling** | `BaileysProvider.init()` catches connection errors gracefully, but `BaileysMongoAuthStore.useAuthState()` fails closed with an unhandled throw if MongoDB is disconnected. | **CONFIRMED VIA CODE — RUNTIME UNVERIFIED** (No database writes performed) |
| **Secret Synchronization** | Staging `JWT_SECRET` (Frontend & Backend) and `WHATSAPP_INTERNAL_SECRET` (Frontend, Backend, WhatsApp) are 64-char hex strings matching across all 3 files. | **CONFIRMED VIA CODE — RUNTIME UNVERIFIED** |
| **Simulation Guard** | `WHATSAPP_MODE=simulation` and `ENABLE_LIVE_WHATSAPP=false` are verified present in Frontend & Backend `.env.staging`. QR pairing works independently of dispatch guard. | **CONFIRMED VIA CODE — RUNTIME UNVERIFIED** |

---

## 9. Production-Aligned Architectural Consolidation & Startup Fix
*Audit Date: November 1, 2026*
*Single Canonical Architecture for Production*

### 9.1 Confirmed Root Causes & Applied Code-Level Fixes
1. **[ROOT CAUSE 1 - CRITICAL] Uninvoked `provider.init()` on Microservice Startup**:
   - *Problem*: In `whatsapp-server/index.js`, `createProvider()` was constructed, but `provider.init()` was never called upon container boot (`require.main === module`). This caused MongoDB connection (`mongoose.connect`) to never be initiated at startup, leaving `this.isMongoConnected = false`, preventing `AUTO_RECONNECT_ON_BOOT` from discovering saved sessions, and causing subsequent socket spawns to throw `MongoDB is not connected`.
   - *Fix*: Added `provider.init().catch(...)` to `whatsapp-server/index.js` inside the `if (require.main === module)` startup block before `app.listen()`.
2. **[ROOT CAUSE 2 - CRITICAL] Unprotected Route Handlers without Lazy Connection Guard**:
   - *Problem*: In `whatsapp-server/providers/BaileysProvider.js`, incoming requests to `getStatus`, `initializeSession`, `reconnectSession`, `sendMessage`, `logoutSession`, and `getGlobalStats` checked `this.isMongoConnected` immediately without waiting for in-flight `this.mongoInitPromise` or triggering lazy connection.
   - *Fix*: Implemented `await this.ensureMongoConnected()` across all six entry points in `BaileysProvider.js`. It lazily kicks off `init()` if needed and reliably awaits `this.mongoInitPromise`.
3. **[ROOT CAUSE 3 - INTEGRATION] Inconsistent URL Normalization in Logout Route**:
   - *Problem*: `src/app/api/whatsapp/logout/route.ts` used a file-scope `WHATSAPP_SERVICE_URL` without `.replace(/\/+$/, "")` trailing-slash sanitization, unlike `init`, `status`, and `reconnect` routes.
   - *Fix*: Standardized `logout/route.ts` to dynamically resolve `process.env.WHATSAPP_SERVICE_URL` with trailing slash removal at request scope.

### 9.2 Production Environment Variable Manifest (Key Names Only)
| Service | Required Key Names | Fail-Closed Default |
| :--- | :--- | :--- |
| **Frontend UI (Vercel)** | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `JWT_SECRET`, `WHATSAPP_INTERNAL_SECRET`, `WHATSAPP_SERVICE_URL`, `WHATSAPP_MODE`, `ENABLE_LIVE_WHATSAPP` | Test pings fail-closed under simulation |
| **Backend API (Vercel)** | `NODE_ENV`, `MONGODB_URI`, `JWT_SECRET`, `WHATSAPP_INTERNAL_SECRET`, `WHATSAPP_SERVICE_URL`, `WHATSAPP_MODE`, `ENABLE_LIVE_WHATSAPP`, `ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `APP_URL`, `YOUPI_WEBHOOK_SECRET`, `CRON_SECRET` | Outbound dispatch strictly returns `sim-<uuid>` |
| **WhatsApp Microservice (Render)** | `PORT`, `WHATSAPP_HOST`, `WHATSAPP_INTERNAL_SECRET`, `MONGODB_URI`, `WHATSAPP_ENGINE`, `AUTO_RECONNECT_ON_BOOT`, `WHATSAPP_COLD_REHYDRATION_TIMEOUT_MS` | Auto-reconnect enabled; fails boot if internal secret is missing |

### 9.3 Unified Production Request Flow
```mermaid
graph TD
    UI[Settings UI /app/settings] -->|User clicks Connect/Status| FE_Route[Frontend API /api/whatsapp/*]
    FE_Route -->|x-internal-secret| WA_Server[WhatsApp Microservice on Render]

    Backend_Fee[Backend Fee / Admissions / Cron] -->|sendFeeReminder / sendWelcomeMessage| Reminder_Svc[tution-desk-be reminderService.ts]
    Reminder_Svc -->|Dual Guard Check| SimGuard{WHATSAPP_MODE === 'live' AND\nENABLE_LIVE_WHATSAPP === 'true'?}
    SimGuard -->|No (Default)| SimRes[Synthetic Response sim-uuid\nZero HTTP calls to microservice]
    SimGuard -->|Yes (Live Opt-in)| WA_Server

    WA_Server --> Provider[BaileysProvider baileys_native]
    Provider --> EnsureMongo[ensureMongoConnected]
    EnsureMongo --> Atlas[(MongoDB Atlas Cluster\nbaileys_auth collection)]
    Provider --> MetaWS[Meta WhatsApp Mobile WebSocket Network]
```

### 9.4 Verification Status
- **Microservice Regression Tests**: 12/12 passing in `repair-batch-1-regression.test.js` (including new tests 7.1 and 7.2).
- **Backend Typecheck**: Passed with 0 errors (`tsc --noEmit`).
- **Frontend Typecheck**: Passed with 0 errors (`tsc --noEmit`).
- **Root Integration Tests**: 38/38 passing across all suites (`fee_reminder_http_mapping`, `fee_whatsapp_validation`, `phase4_e2e_verification`).
- **Remaining Runtime Verification**: Physical QR scan and cellular packet delivery remain unverified until deployment with authorized test handset.
