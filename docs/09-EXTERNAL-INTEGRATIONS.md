# 09 — External Integrations & Third-Party Services

*Last Reviewed: November 2026*
*Status: Authoritative Integration Inventory*

---

## 1. Overview

TuitionDesk interfaces with external providers for payment collection, WhatsApp protocol communications, and cloud database persistence. This document inventories all third-party integrations, credential requirements (by variable name only), and their verification statuses.

---

## 2. Integration Inventory

### 2.1 YouPI Payment Gateway
- **Purpose**: Collect online student fee payments via unified UPI QR codes and deep links; process automated payment reconciliation via webhooks.
- **Implementation Status**: `PARTIAL` (`[CONFIRMED]` in code; `[UNVERIFIED]` under live transactions).
- **Relevant Files**:
  - `tution-desk-be/src/app/api/webhooks/youpi/route.ts`
  - `tution-desk-be/src/lib/reconciliationEngine.ts`
- **Required Environment Variables**:
  - `YOUPI_API_KEY` (Gateway identification)
  - `YOUPI_WEBHOOK_SECRET` (HMAC signature verification)
  - `NEXT_PUBLIC_YOUPI_MERCHANT_ID` (Client-side checkout initiator)
- **Outstanding Verification**:
  - Verification of real-world bank settlement callbacks.
  - End-to-end automated testing with actual UPI gateway sandboxes.

---

### 2.2 Direct UPI Deep Links (Zero-Gateway Fallback)
- **Purpose**: Allows center owners without a registered commercial payment gateway merchant account to collect fees directly to their personal or institute UPI VPA (e.g. `center@upi`).
- **Implementation Status**: `COMPLETE` (`[CONFIRMED]` in code; `[TESTED]` in UI).
- **Mechanism**: The Parent Portal (`/parent/[studentId]`) dynamically constructs standard NPCI UPI intent URLs:
  ```
  upi://pay?pa={centerUpiId}&pn={centerName}&am={amountDue}&tn={feeDescription}
  ```
- **Dependencies**: Native mobile UPI apps (Google Pay, PhonePe, Paytm).
- **Outstanding Verification**: Verification of deep-link launching across edge Android and iOS mobile web browsers.

---

### 2.3 Meta WhatsApp Network via Baileys Engine
- **Purpose**: Multi-tenant automated messaging for fee payment notices, absence alerts, and enrollment receipts.
- **Implementation Status**: `PARTIAL` (`[TESTED]` against mocked sockets; `[UNVERIFIED]` under live cellular WhatsApp sessions).
- **Relevant Files**:
  - `whatsapp-server/providers/BaileysProvider.js`
  - `whatsapp-server/index.js`
  - `tution-desk-be/src/lib/reminderService.ts`
- **Required Environment Variables**:
  - `WHATSAPP_INTERNAL_SECRET` (Internal inter-service authentication)
  - `WHATSAPP_SERVER_URL` (Backend pointer to microservice)
  - `ENABLE_LIVE_WHATSAPP` (Simulation safety toggle)
  - `WHATSAPP_MODE` (Set to `live` for live outbound socket frames)
- **Outstanding Verification**:
  - Live verification of Baileys pairing with official WhatsApp Android/iOS client.
  - Verification of Meta rate-limiting thresholds and spam detection mitigation.

---

### 2.4 MongoDB Atlas Cloud Database
- **Purpose**: Central multi-tenant document database hosting all operational data and WhatsApp authentication keys.
- **Implementation Status**: `COMPLETE` (`[CONFIRMED]` in code; `[TESTED]` in live staging).
- **Required Environment Variables**:
  - `MONGODB_URI` (Atlas cluster connection string with TLS and retryWrites)
- **Outstanding Verification**:
  - Atlas automated index creation verification in production (`autoIndex: false`).

---

## 3. Credentials & Environment Variable Name Registry

| Variable Name | Required By | Secret Classification | Notes |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | Backend & WhatsApp Microservice | **CRITICAL** | MongoDB Atlas TLS connection URI. |
| `JWT_SECRET` | Frontend & Backend | **CRITICAL** | 256-bit secret used for signing and verifying owner JWT cookies. |
| `WHATSAPP_INTERNAL_SECRET` | Backend & WhatsApp Microservice | **CRITICAL** | Shared secret passed in `x-internal-secret` HTTP header. |
| `CRON_SECRET` | Backend | **HIGH** | Bearer secret authorizing external schedulers to invoke `/api/cron/*`. |
| `YOUPI_WEBHOOK_SECRET` | Backend | **HIGH** | Secret for verifying payment gateway webhook signatures. |
| `ALLOWED_ORIGINS` | Backend | **MEDIUM** | Comma-separated list of permitted web origins for CORS. |
| `NEXT_PUBLIC_API_URL` | Frontend | **LOW** | Base HTTP URL pointing to the backend API. |
| `WHATSAPP_MODE` | Backend | **OPERATIONAL** | Set to `simulation` or `live`. |
| `ENABLE_LIVE_WHATSAPP` | Backend | **OPERATIONAL** | Fail-closed Boolean flag for real WhatsApp transmission. |
