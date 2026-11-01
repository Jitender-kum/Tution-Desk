# 11 — Feature Inventory & Implementation Matrix

*Last Reviewed: November 2026*
*Status: Authoritative Product Feature Matrix*

---

## 1. Feature Status Classification Definitions

Every product capability is classified into exactly one status based on rigorous code and test verification:

- **`COMPLETE`**: Fully implemented end-to-end, integrated across frontend/backend/database, and verified by passing automated tests.
- **`PARTIAL`**: Core functionality exists, but critical edge cases, UI states, or integration links are missing.
- **`BROKEN`**: Code exists, but has a known runtime failure, syntax error, or blocking regression.
- **`MISSING`**: Expected product capability has no code implementation.
- **`UNVERIFIED`**: Code is present in the repository, but operational behavior has not been established via automated or manual test execution.

---

## 2. Central Feature Matrix

| Feature | Frontend File(s) | Backend File(s) | Database Model(s) | Test Coverage | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Center Registration** | `app/login/page.tsx` | `api/auth/register/route.ts` | `Center` | None | `UNVERIFIED` | Code inspected |
| **Center Login & JWT** | `app/login/page.tsx` | `api/auth/login/route.ts` | `Center` | `test/centerProfile.test.mjs` | `PARTIAL` | `[TESTED]` (Password bypass issue exists) |
| **Owner Dashboard Aggregates** | `app/page.tsx` | `api/dashboard/owner/route.ts` | `Fee`, `Student`, `Attendance` | `test/phase2c_partial_paid_dashboard.test.mjs` | `COMPLETE` | `[TESTED]` |
| **Student Admission** | `app/admissions/page.tsx` | `api/students/route.ts` | `Student` | None | `PARTIAL` | `[CONFIRMED]` (BOLA gap on centerId) |
| **Student Roster & Filters** | `components/students/` | `api/students/route.ts` | `Student` | None | `COMPLETE` | `[CONFIRMED]` in UI & API |
| **Batch Management** | `app/settings/page.tsx` | `api/batches/route.ts` | `Batch` | None | `COMPLETE` | `[CONFIRMED]` CRUD in API |
| **Daily Attendance Marking** | `app/attendance/page.tsx` | `api/attendance/route.ts` | `Attendance` | None | `COMPLETE` | `[CONFIRMED]` |
| **Absentee WhatsApp Alerts** | `components/attendance/` | Missing handler | N/A | None | `MISSING` | UI toggle exists; no backend dispatch hook |
| **Monthly Fee Ledger Generation** | `app/fees/page.tsx` | `api/fees/route.ts`, `lib/feeService.ts` | `Fee`, `FeeCreationLock` | `test/phase2a_fee_system.test.mjs` | `COMPLETE` | `[TESTED]` (100% test pass) |
| **Distributed Fee Creation Lock** | N/A (Internal) | `lib/feeGenerator.ts`, `lib/lockReadiness.ts` | `FeeCreationLock` | `test/phase2i_concurrency_fix.test.mjs` | `COMPLETE` | `[TESTED]` |
| **Manual Cash / UPI Collection** | `components/fees/ManualCollectionModal.tsx` | `api/fees/manual-collection/route.ts` | `Fee` | `test/phase2c_manual_collection.test.mjs` | `COMPLETE` | `[TESTED]` |
| **YouPI Gateway Webhook** | N/A | `api/webhooks/youpi/route.ts` | `Fee` | `test/phase2c_youpi_webhook.test.mjs` | `PARTIAL` | `[TESTED]` in harness; `[UNVERIFIED]` live |
| **WhatsApp QR Pairing** | `app/settings/page.tsx` | `api/notifications/route.ts`, `whatsapp-server` | `baileys_creds` | `whatsapp-server/test/baileys-provider.test.js` | `COMPLETE` | `[TESTED]` |
| **WhatsApp Handshake Recovery** | N/A (Microservice) | `whatsapp-server/providers/BaileysProvider.js` | `baileys_auth_keys` | `whatsapp-server/test/session-recovery-regression.test.js` | `COMPLETE` | `[TESTED]` |
| **Fee Payment Reminder Dispatch** | `components/fees/FeeRow.tsx` | `api/fees/[feeId]/remind/route.ts` | `FeeReminderLog` | `test/fee_reminder_http_mapping.test.mjs` | `COMPLETE` | `[TESTED]` |
| **Reminder 24h Cooldown Lock** | `components/fees/` | `lib/reminderService.ts` | `FeeReminderLog` | `test/fee_reminder_http_mapping.test.mjs` | `COMPLETE` | `[TESTED]` |
| **Parent Portal (Magic Link)** | `app/parent/[studentId]/page.tsx` | `api/parent/[studentId]/route.ts` | `Student`, `Fee`, `Attendance` | None | `PARTIAL` | `[CONFIRMED]` (PII phone unmasked) |
| **Academic Tests & Scores** | `app/tests/page.tsx` | `api/tests/route.ts` | `Test` | None | `COMPLETE` | `[CONFIRMED]` |
| **Automated Cron Fee Billing** | N/A | `api/cron/generate-fees/route.ts` | `Fee`, `FeeCreationLock` | `test/phase2d_cron_security.test.mjs` | `COMPLETE` | `[TESTED]` |
| **Automated Overdue Reminders** | N/A | `api/cron/overdue-reminders/route.ts` | `Fee`, `FeeReminderLog` | `test/phase2d_cron_security.test.mjs` | `COMPLETE` | `[TESTED]` |

---

## 3. Detailed Audit by Module

### 3.1 Fee Management & Invoicing
- **Expected Behavior**: Administrators trigger fee creation for a specific billing month. Every active student receives a Fee invoice. Concurrency locks prevent double-billing. Cash or UPI payments are recorded, status updates to `Partial Paid` or `Paid`, and WhatsApp receipts are sent.
- **Current Implementation**: Fully implemented in `tution-desk-be/src/lib/feeService.ts` and `tution-desk-be/src/lib/feeGenerator.ts`.
- **Known Problems**: In production, `autoIndex: false` requires ensuring the unique index on `lockKey` in `FeeCreationLock` is provisioned.
- **Missing Requirements**: Automated receipt generation PDF attachment over WhatsApp.

### 3.2 WhatsApp Automation Microservice
- **Expected Behavior**: Center owner connects official WhatsApp via QR code. Service stays connected across container restarts. Background dispatches send personalized reminders with deep links.
- **Current Implementation**: Express microservice on port 3005 with Baileys 6.7.24, persistent MongoDB auth, 25s initialization watchdog, and wrapped `CB:success` error handling.
- **Known Problems**: Container spin-down if deployed on free-tier serverless or sleep-enabled tiers.
- **Missing Requirements**: Bi-directional message listener (responding to incoming parent messages).

### 3.3 Parent Portal
- **Expected Behavior**: Parents receive a link via WhatsApp, open the portal on mobile, view their child's dues, and click to pay via UPI deep link or payment gateway.
- **Current Implementation**: Next.js route `/parent/[studentId]` and `/p/[studentId]`.
- **Known Problems**: Raw phone number exposed in API response (`SEC-PRIV-03`).
- **Missing Requirements**: Optional OTP verification before displaying test marks.
