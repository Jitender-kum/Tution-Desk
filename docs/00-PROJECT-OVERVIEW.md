# 00 — Project Overview

*Last Reviewed: November 2026*
*Status: Active Operational Standard*

---

## 1. Product Purpose & Value Proposition

**TuitionDesk** is a multi-tenant business management and communication platform designed specifically for private tuition centers, coaching academies, and independent tutoring institutes.

In emerging markets (primarily India), coaching institutes operate on manual registers, fragmented WhatsApp groups, paper receipts, and ad-hoc cash collection. This leads to substantial administrative friction, high rates of fee defaults, lost records, and inefficient communication with parents.

TuitionDesk addresses these challenges by consolidating the operational lifecycle into a single web application:
- Student admissions and digital profiles.
- Academic batch scheduling and subject assignment.
- Daily attendance tracking with absent alerts.
- Performance assessments and test marks entry.
- Automated monthly fee ledger generation.
- Frictionless UPI collection via payment links.
- Automated parent notifications and receipts over WhatsApp.

---

## 2. Target Users & Stakeholders

| User Persona | Role & Objectives | Primary Interfaces |
| :--- | :--- | :--- |
| **Center Owner / Administrator** | Manages the coaching center, configures institute profile, creates academic batches, registers students, monitors monthly fee collections, triggers WhatsApp reminders, and configures payment settings. | Web Application Dashboard (`/dashboard`, `/students`, `/fees`, `/attendance`, `/batches`, `/tests`, `/settings`) |
| **Center Staff / Teachers** *(Partial / Inferred)* | Marks daily attendance, records test scores, reviews student batch rosters. *(Currently uses shared center owner credentials).* | Web Application Dashboard |
| **Parents & Guardians** | Receives fee alerts and attendance updates via WhatsApp; clicks secure magic links to inspect ward's dues, view payment receipts, and complete online payments. | Lightweight Parent Portal (`/parent/[studentId]`) |
| **Students** *(Inferred)* | Reviews attendance logs, test scores, and batch announcements. *(Accesses through Parent Portal).* | Lightweight Parent Portal (`/parent/[studentId]`) |

---

## 3. Core Business Problems Solved

1. **Fee Collection Delinquency**: Manual fee collection often incurs delays exceeding 30–60 days. TuitionDesk introduces automatic monthly ledger creation with scheduled, rate-limited WhatsApp payment nudges containing direct UPI deep links.
2. **Double Entry & Cash Reconciliation Errors**: Manual cash tracking leads to reconciliation mismatches. TuitionDesk provides recorded manual payment entries with transaction IDs alongside automatic webhook reconciliation for gateway payments.
3. **Parent Communication Overhead**: Sending individual attendance messages or fee slips by hand wastes hours of administrative staff time. TuitionDesk dispatches pre-templated messages via a dedicated background WhatsApp engine.
4. **App Installation Friction**: Parents often refuse to download heavy mobile applications for small coaching institutes. TuitionDesk uses WhatsApp as the delivery vehicle and a mobile-responsive web link for all parent interactions.

---

## 4. Product Modules Breakdown

| Module | Core Capabilities | Implementation State | Evidence Status |
| :--- | :--- | :--- | :--- |
| **Authentication & Onboarding** | Center registration, owner login, JWT cookie generation, center profile management. | Implemented | `[CONFIRMED]` |
| **Student Management** | Admission forms, student directory, batch assignment, parent contact records, student deactivation. | Implemented | `[CONFIRMED]` |
| **Batch Management** | Academic batch creation, subject mapping, timing schedules, student roster mapping. | Implemented | `[CONFIRMED]` |
| **Attendance Tracking** | Date-wise roster attendance marking (Present / Absent / Late), historical attendance logs. | Implemented (Alerts missing) | `[CONFIRMED]` |
| **Tests & Academics** | Test creation, maximum marks, date, score entry per student, report card view. | Implemented | `[CONFIRMED]` |
| **Fee Ledger & Invoicing** | Monthly fee generation, duplicate prevention locks, overdue calculations, partial payments. | Fully Implemented & Tested | `[TESTED]` |
| **Payment Collection** | Cash/offline recording, UPI deep link generation, YouPI gateway integration, webhook handler. | Implemented | `[CONFIRMED]` |
| **WhatsApp Automation** | QR pairing session, Baileys persistent auth in MongoDB, fee reminder dispatch, rate limiting. | Hardened & Tested | `[TESTED]` |
| **Parent Portal** | Public token-free magic link by `studentId`, fee history, attendance summary, online pay button. | Implemented | `[CONFIRMED]` |
| **Owner Dashboard** | Real-time collection stats, pending dues, recent admissions, attendance trends, quick actions. | Implemented | `[CONFIRMED]` |

---

## 5. Technology Stack Summary

- **Frontend Web Application**:
  - Framework: Next.js 16.4.2 (App Router)
  - UI Library: React 19.3.0
  - Styling: Tailwind CSS v4 + PostCSS
  - Icons: Lucide React v1.61.0
  - QR Rendering: `qrcode.react` v4.2.0
  - Cryptography / JWT: `jose` v6.2.13
- **Backend API Application**:
  - Framework: Next.js 16.4.2 (Headless API Route Handlers)
  - Database ODM: Mongoose v9.11.3
  - Password Hashing: `bcryptjs` v3.0.3
  - Cryptography / JWT: `jose` v6.2.13
- **WhatsApp Microservice**:
  - Runtime: Node.js (Express v4.21.2)
  - Protocol Engine: `@whiskeysockets/baileys` v6.7.24
  - State Persistence: Custom MongoDB Mongoose driver for Baileys auth keys
- **Infrastructure & Hosting**:
  - Frontend & Backend: Vercel Serverless Platform
  - Database: MongoDB Atlas (Replica Set M0/M10)
  - WhatsApp Engine: Render (Persistent Web Service)

---

## 6. Current Known Limitations & Architectural Boundaries

1. **Single-Role Owner Model**: The system currently does not have granular Role-Based Access Control (RBAC). All institute staff share the primary owner login credentials.
2. **Serverless Limitations for WhatsApp**: Baileys requires a stateful, long-lived WebSocket connection to Meta's WhatsApp servers. Consequently, the WhatsApp microservice cannot run inside serverless environments (Vercel/AWS Lambda) and must remain on a persistent container (Render/Fly.io/VPS).
3. **Automated Cron Triggering**: Scheduled fee generation and overdue reminders require external webhook triggers (e.g. Vercel Cron or GitHub Actions); the backend does not host an internal persistent cron daemon.
4. **Parent Portal Magic Link PII Exposure**: The parent portal URL `/parent/[studentId]` is accessible without parent phone verification, currently exposing student academic logs and raw parent contact numbers if the URL is shared or enumerated.
