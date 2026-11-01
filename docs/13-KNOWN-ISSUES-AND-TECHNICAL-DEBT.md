# 13 — Known Issues & Technical Debt Registry

*Last Reviewed: November 2026*
*Status: Living Technical Debt & Defect Log*

---

## 1. Overview & Classification Standards

This registry tracks technical debt, duplicated business logic, architectural inconsistencies, and incomplete workflows across TuitionDesk. Items are classified as:
- **`CONFIRMED`**: Directly established by active source code or runtime observation.
- **`UNVERIFIED`**: Reported during code review or historical incidents, pending live reproduction.

---

## 2. Dedicated WhatsApp Subsystem Defect Inventory

The following issues directly impact the reliability, session persistence, and message delivery of the TuitionDesk WhatsApp integration:

### WA-ISSUE-01: Startup Auto-Reconnect Disabled by Default `[FIXED — NOT VERIFIED]`
- **Location**: `whatsapp-server/providers/BaileysProvider.js:147`
- **Severity**: **`HIGH`**
- **Observed Code**:
  `if (process.env.AUTO_RECONNECT_ON_BOOT === 'true' && process.env.NODE_ENV !== 'test')`
- **Problem**: When the microservice restarts on Render or locally, `AUTO_RECONNECT_ON_BOOT` was unset. Zero in-memory sockets were reconnected, leaving `this.sessions` empty.
- **Impact**:
  - The Settings page immediately displays "Disconnected", even though a valid session exists in MongoDB Atlas.
  - Owners falsely believe their session was lost and attempt redundant QR scans.
- **Resolution Applied**: Default startup auto-reconnection is now enabled (`AUTO_RECONNECT_ON_BOOT !== 'false'`) for registered sessions with a 500ms staggered queue between centers and a boot guard (`_bootReconnected`) to prevent duplicate initialization loops. Verified in `repair-batch-1-regression.test.js`.

---

### WA-ISSUE-02: On-Demand Rehydration Readiness Timeout Too Short (6s) `[FIXED — NOT VERIFIED]`
- **Location**: `whatsapp-server/providers/BaileysProvider.js:741`
- **Severity**: **`HIGH`**
- **Observed Code**:
  ```javascript
  const waitStart = Date.now();
  while (!session.isReady && Date.now() - waitStart < 6000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  ```
- **Problem**: When `sendMessage` arrives for a session that is stored in Atlas but not running in memory, it auto-spawns the socket but only waited up to 6,000ms. Cold Baileys socket negotiation over cloud networks often takes 5–8 seconds.
- **Impact**: If socket reaches `open` at 6.2s, line 747 immediately threw `ServiceUnavailableError: WhatsApp Client for center '...' is not ready. Please scan the QR code in Settings.` The fee reminder failed with HTTP 503, and the owner was falsely instructed to scan the QR code again.
- **Resolution Applied**: Replaced hardcoded wait with configurable `this.coldSessionTimeoutMs` (default: 15,000ms) with proper socket cleanup and clear status messaging distinguishing connection in progress vs. unauthenticated state. Tested in `repair-batch-1-regression.test.js`.

---

### WA-ISSUE-03: Single-Session Fallback Hijack in `sendMessage` `[FIXED — NOT VERIFIED]`
- **Location**: `whatsapp-server/providers/BaileysProvider.js:707-709`
- **Severity**: **`HIGH`**
- **Observed Code**:
  ```javascript
  let targetCenterId = centerId ? validateCenterId(centerId).toLowerCase() : null;
  if (!targetCenterId && this.sessions.size === 1) {
    targetCenterId = Array.from(this.sessions.keys())[0];
  }
  ```
- **Problem**: If `centerId` was missing from the payload and exactly one session was active in memory, the microservice fell back to using that single session.
- **Impact**: In a multi-tenant system, an unkeyed or malformed request could dispatch messages using another institute's WhatsApp account.
- **Resolution Applied**: Completely removed `sessions.size === 1` fallback. `centerId` string is now strictly required; missing or whitespace `centerId` immediately throws `ValidationError`. Tested in `repair-batch-1-regression.test.js`.

---

### WA-ISSUE-04: Default `WHATSAPP_ENGINE` is `wwebjs` Instead of `baileys` `[FIXED — NOT VERIFIED]`
- **Location**: `whatsapp-server/index.js:42-50`
- **Severity**: **`MEDIUM`**
- **Observed Code**:
  `const engine = (engineName || 'wwebjs').trim().toLowerCase();`
- **Problem**: If `WHATSAPP_ENGINE` was not explicitly set in container environment variables, it defaulted to the legacy Puppeteer Chromium provider (`wwebjs`), which failed to boot on containers lacking Chromium binaries or having <1GB RAM.
- **Resolution Applied**: Changed default engine in `createProvider()` to `'baileys'`. Explicit `wwebjs` configuration remains supported for legacy environments. Tested in `engine-selection.test.js` & `repair-batch-1-regression.test.js`.

---

### WA-ISSUE-05: Simulation Guard Dual-Opt-In Silently Intercepts Outbound Messages `[FIXED — NOT VERIFIED]`
- **Location**: `tution-desk-be/src/lib/whatsappService.ts:23-27` & `src/lib/whatsappService.ts:23-27`
- **Severity**: **`HIGH`**
- **Observed Code**:
  `isLiveDispatchEnabled()` requires **BOTH** `WHATSAPP_MODE === "live"` AND `ENABLE_LIVE_WHATSAPP === "true"`.
- **Problem**: If either variable is missing or set to anything other than `"live"` and `"true"` in Vercel backend environment variables, all dispatches are simulated (`sim_...`), generating zero network calls to port 3005.
- **Impact**: Users pair WhatsApp successfully, click "Send Reminder", see a success toast, but no message is ever sent to parents.
- **Resolution Applied**: Standardized error response across all dispatch methods with `simulated: true, accepted: false, delivered: false` and explicit diagnostic message stating that `WHATSAPP_MODE=live` and `ENABLE_LIVE_WHATSAPP=true` must be set in deployment environment variables.

---

### WA-ISSUE-06: Polling Stops on Disconnected Status in Settings UI `[FIXED — NOT VERIFIED]`
- **Location**: `src/app/settings/page.tsx:428-432`
- **Severity**: **`MEDIUM`**
- **Observed Code**:
  ```typescript
  if (!delayMs || (currentError && !isInit && !isRegen)) {
    return;
  }
  ```
- **Problem**: When `status` was `"disconnected"`, `delayMs` was `null`. The chained polling loop terminated completely.
- **Impact**: If a server reconnection occurred in the background, or if a user finished mobile pairing while the UI was idle, the status never updated to "Connected" until the user manually refreshed the browser.
- **Resolution Applied**: Maintained a gentle 30s background heartbeat polling loop in `scheduleNextPoll` during disconnected state. Cleanly cleared on component unmount and explicit user logout.

---

### WA-ISSUE-07: Baileys 408 (Timed Out) Causes 5-Cycle QR Storm on Unscanned Sessions `[FIXED — NOT VERIFIED]`
- **Location**: `whatsapp-server/providers/BaileysProvider.js:554-570`
- **Severity**: **`LOW`**
- **Problem**: When a QR code was not scanned within 60s, Baileys closed with code 408. The provider treated this as an unexpected drop and reconnected 5 times with exponential backoff, generating 5 successive expiring QR codes before finally giving up.
- **Resolution Applied**: In `connection.update` close handler, if `statusCode === 408` on a session without saved credentials, cleanly transition to `status: 'disconnected'` with message `QR code expired without being scanned. Please click Connect to generate a new QR code.` without triggering reconnect cycles. Tested in `baileys-provider.test.js` & `repair-batch-1-regression.test.js`.

---

## 3. Duplicate Implementations & Architecture Drift

### 3.1 Duplicate WhatsApp Client Implementations `[CONFIRMED]`
- **Locations**:
  - `src/lib/whatsappService.ts` (460 lines in Frontend)
  - `tution-desk-be/src/lib/whatsappService.ts` (460 lines in Backend)
- **Problem**: Both files contain identical implementations, but in the frontend, only `test-message/route.ts` imports `isLiveDispatchEnabled`. The remaining methods are dead code.
- **Remediation**: Consolidate into a single shared utility or remove dead code in frontend.

---

## 4. Incomplete & Broken Workflows

### 4.1 Absentee WhatsApp Alerts Hook Missing `[CONFIRMED]`
- **Location**: `src/components/attendance/` & `tution-desk-be/src/app/api/attendance/route.ts`
- **Problem**: UI contains a toggle control to send absentee alerts via WhatsApp, but backend `POST /api/attendance` does not trigger any notification call.

### 4.2 Lack of Granular Role-Based Access Control (RBAC) `[CONFIRMED]`
- **Problem**: System models only a single center ownership account (`role: "owner"` in JWT). All staff share primary credentials.
