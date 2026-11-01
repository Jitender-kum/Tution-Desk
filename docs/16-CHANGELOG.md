# 16 — Project Changelog

*All notable changes to the TuitionDesk platform are documented in this file.*

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.4] - 2026-11-01

### Changed — Permanent Standardization to Baileys Engine
- **Engine Standardization**:
  - Permanently switched WhatsApp microservice to lightweight `@whiskeysockets/baileys` WebSocket engine.
  - Completely removed `whatsapp-web.js` dependency and Chromium footprint to eliminate Render Out-Of-Memory (OOM) crashes.
  - Deleted legacy `providers/WWebJSProvider.js`, `mongoStore.js` (GridFS zip storage), and `sessionMigration.js`.
- **Refactored Server Entry Point**:
  - Updated `whatsapp-server/index.js` to initialize `BaileysProvider` directly without engine toggles or legacy store references.
- **Contract & Regression Test Suite**:
  - Refactored `api-contract.test.js` to validate `formatBaileysJid` and JID target formatting (`@s.whatsapp.net`).
  - Added live simulation script `whatsapp-server/verify-baileys-live.js` validating MongoDB auth storage, live socket initialization, QR generation, session refresh, and fail-closed message dispatch.
  - Verified 100% test pass rate across 29 test suites.

---

## [0.2.3] - 2026-11-01

### Implemented — WhatsApp Repair Batch 1 (Connectivity & Tenant Isolation)
- **Fix 1 (Default Engine Selection)**:
  - Updated `createProvider()` in `whatsapp-server/index.js` to default to `'baileys'` when `WHATSAPP_ENGINE` is unset or empty.
  - Preserved explicit supported engine configuration (`baileys` and `wwebjs`).
  - Updated test assertions in `whatsapp-server/test/engine-selection.test.js` to verify Baileys default.
- **Fix 2 (Strict Multi-Tenant Isolation)**:
  - Removed implicit single-session fallback (`this.sessions.size === 1`) in `BaileysProvider.sendMessage`.
  - Required explicit valid `centerId` on every outbound dispatch; rejects missing or whitespace `centerId` with `ValidationError`.
- **Fix 3 (Startup Session Restoration & Lifecycle Guards)**:
  - Enabled startup auto-reconnection by default for registered sessions (`AUTO_RECONNECT_ON_BOOT !== 'false'`), suppressed in unit test environments.
  - Implemented 500ms staggered restoration schedule between centers to eliminate connection storms.
  - Added boot guard (`_bootReconnected`), unref'd boot timers (`_bootTimers`), and `_isShuttingDown` lifecycle protection.
- **Fix 4 (Configurable Cold Session Rehydration Timeout)**:
  - Replaced hardcoded 6000ms loop in `sendMessage` with configurable `this.coldSessionTimeoutMs` (defaults to 15,000ms).
  - Improved error messaging to distinguish active connection in progress vs. unauthenticated state.
- **Fix 5 (Standardized Simulation Guard Diagnostics)**:
  - Standardized error response across all dispatch methods with `simulated: true, accepted: false, delivered: false` and explicit diagnostic messaging naming required deployment variables (`WHATSAPP_MODE=live` & `ENABLE_LIVE_WHATSAPP=true`).
- **Fix 6 (QR Expiry Cleanup & Adaptive UI Heartbeat)**:
  - Handled unscanned QR expiration (408) by cleanly transitioning to `disconnected` without triggering 5-cycle reconnect loops.
  - Updated `scheduleNextPoll` in `src/app/settings/page.tsx` with a 30s background heartbeat during disconnected state to automatically detect background server reconnections.
- **Added Regression Tests**:
  - Created `whatsapp-server/test/repair-batch-1-regression.test.js` (10 tests covering all Batch 1 fixes).
  - Verified 121 microservice tests passing across 8 suites.

---

## [0.2.2] - 2026-11-01

### Audited
- **Comprehensive WhatsApp Root Cause Investigation**:
  - Traced complete dual-path architecture: Frontend BFF proxy routes (`src/app/api/whatsapp/*` on port 3000) vs. Backend automated dispatchers (`tution-desk-be/src/app/api/fees/*` on port 3001).
  - Uncovered dead code in `src/lib/whatsappService.ts`.
  - Identified 7 distinct root causes for WhatsApp disconnection, restart amnesia, and reminder dispatch failures (`WA-ISSUE-01` through `WA-ISSUE-07`).
  - Created [`docs/WHATSAPP-IMPLEMENTATION-TRACKER.md`](./WHATSAPP-IMPLEMENTATION-TRACKER.md) as single source of truth for the repair process.
  - Verified 111 unit/contract tests passing in `whatsapp-server` and 30 root integration tests passing.

---

## [0.2.1] - 2026-11-01

### Commit Reference: `9423591`
`fix(whatsapp): harden session recovery and fee reminder error handling`

### Fixed
- **WhatsApp Baileys Async Handshake Crash**:
  - Implemented wrapper around `sock.ws.on('CB:success')` in `whatsapp-server/providers/BaileysProvider.js`.
  - Preserved EventEmitter context using `listener.apply(sock.ws, args)`.
  - Added multi-stage error cleanup cascade: catches promise rejections, attempts `sock.end(cbErr)`, and safely falls back to `sock.ws.close()` if socket destruction throws.
- **Microservice Initialization Watchdog**:
  - Added 25-second watchdog timer to automatically abort hanging or silent connection handshakes and transition centers to `DISCONNECTED`.
  - Guarded boot auto-reconnect behind `AUTO_RECONNECT_ON_BOOT === true`.
- **Fee Reminder HTTP Status Mapping**:
  - Corrected backend HTTP status mapping in `tution-desk-be/src/app/api/fees/[feeId]/remind/route.ts`.
  - Mapped `PROVIDER_REJECTED` and `DISPATCH_ERROR` to HTTP 503 Service Unavailable.
  - Preserved `COOLDOWN_ACTIVE` $\rightarrow$ 409 Conflict and `DISPATCH_UNCERTAIN` $\rightarrow$ 202 Accepted.
- **Fee Input Validation**:
  - Hardened fee generation form inputs in `src/app/settings/page.tsx` with `min="1"` and `step="any"` to prevent sub-zero or malformed currency entries.

### Added
- **Automated Regression Test Suites**:
  - `whatsapp-server/test/session-recovery-regression.test.js` (Tests `CB:success` error catch, `this` context binding, and cleanup resilience).
  - `test/fee_reminder_http_mapping.test.mjs` (Validates full status mapping matrix against `reminderService`).

---

## [0.2.0] - 2026-10-25

### Added
- **Distributed Concurrency Lock**:
  - Integrated `FeeCreationLock` model with unique compound key on `{ lockKey: 1 }` and 10-minute TTL index to prevent duplicate monthly fee generation runs.
- **Manual Payment Collection**:
  - Added `ManualCollectionModal` on frontend fee ledger table.
  - Implemented `recordManualPayment` in `tution-desk-be/src/lib/feeService.ts` supporting cash, UPI, and bank transfer settlements with automatic `remainingAmount` calculation.
- **Parent Portal Magic Link**:
  - Delivered `/parent/[studentId]` route allowing parents to inspect student attendance, test results, and fee balances with zero-login UPI payment deep links.
- **YouPI Payment Gateway Webhook**:
  - Implemented `/api/webhooks/youpi` for automated reconciliation of online student fee payments.

---

## [0.1.0] - Initial Platform Baseline

### Added
- Multi-tenant center registration and owner authentication with JWT cookies.
- Student admission, batch creation, and roster management.
- Daily attendance tracking grid with Present / Absent status toggles.
- Academic test marksheet entry and score tracking.
- Baileys WhatsApp QR code pairing console on `/settings`.
- MongoDB Atlas Mongoose connection pooling for Vercel serverless environments.
