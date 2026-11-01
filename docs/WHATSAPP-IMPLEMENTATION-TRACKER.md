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
