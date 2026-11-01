# 01 — Product Requirements Document (PRD)

*Last Reviewed: November 2026*
*Status: Living Product Specification*

---

## 1. Document Structure & Convention

This document outlines the product requirements for TuitionDesk across each operational module. To maintain strict architectural fidelity, requirements are categorized into three distinct tiers:

1. **`[OBSERVED]`**: Features actively present and confirmed in the source code.
2. **`[INFERRED]`**: Product rules logically required or partially implemented in existing code.
3. **`[PROPOSED]`**: Planned future features not yet implemented in the codebase.

---

## 2. Module 1: Center Onboarding & Authentication

### Purpose
Allows tuition center owners to register their institute, secure their account, configure institute branding, and manage login sessions.

### Target User
Tuition Center Owner / Administrator.

### Functional Requirements
- **FR-AUTH-01 `[OBSERVED]`**: Registration endpoint accepts `name`, `email`, `password`, `phone`, `centerName`, and `address`. Creates a Center document with a hashed password (`bcryptjs`).
- **FR-AUTH-02 `[OBSERVED]`**: Login validates credentials, issues an HTTP-only JWT cookie (`token`) signed via `jose`, and returns center metadata.
- **FR-AUTH-03 `[OBSERVED]`**: Center profile view and update allows modifying center name, phone, address, and default fee due dates.
- **FR-AUTH-04 `[OBSERVED]`**: Logout clears the session cookie.
- **FR-AUTH-05 `[INFERRED]`**: Password reset / recovery flow. *(Currently unverified / missing in backend routes)*.
- **FR-AUTH-06 `[PROPOSED]`**: Multi-factor authentication (MFA) via WhatsApp OTP or SMS.

### User Journey
1. Center owner visits landing page `/login`.
2. Clicks "Register Institute" and fills in institute name, admin email, password, and phone.
3. On submission, center is provisioned, JWT cookie is set, and user is redirected to `/dashboard`.

### Acceptance Criteria
- Unauthorized requests to `/dashboard` redirect to `/login`.
- JWT tokens expire after configured window (default: 7 days).
- Duplicate email registrations are rejected with HTTP 400/409.

### Known Limitations & Open Questions
- Legacy fallback: Older unhashed centers allow default password login (`"password123"`). Must be phased out.

---

## 3. Module 2: Student Lifecycle & Admissions

### Purpose
Captures student demographic details, assigns them to academic batches, tracks parent WhatsApp contacts, and manages active/inactive enrolment status.

### Target User
Center Administrator / Front-desk Staff.

### Functional Requirements
- **FR-STUD-01 `[OBSERVED]`**: Student admission form accepts `name`, `rollNumber`, `classGrade`, `schoolName`, `parentName`, `parentWhatsApp`, `monthlyFee`, `batchId`, and `admissionDate`.
- **FR-STUD-02 `[OBSERVED]`**: Student roster displays full student list with search by name, filter by batch, and active status toggle.
- **FR-STUD-03 `[OBSERVED]`**: Student detail page displays demographic info, fee payment history, attendance summary, and test performance.
- **FR-STUD-04 `[OBSERVED]`**: Edit student details and archive/deactivate student.
- **FR-STUD-05 `[INFERRED]`**: Roll number uniqueness per center. *(Schema does not enforce a unique compound index for `[centerId, rollNumber]`)*.
- **FR-STUD-06 `[PROPOSED]`**: Bulk CSV import and export for student rosters.

### User Journey
1. Owner navigates to `/students` and clicks "New Admission".
2. Fills student details and parent WhatsApp contact number.
3. Selects assigned academic batch.
4. Saves; student appears on roster and becomes eligible for monthly fee ledger generation.

### Dependencies
- Database: `Student`, `Batch`, `Center` collections.

---

## 4. Module 3: Batch Scheduling & Management

### Purpose
Organizes students into instructional groups based on class, subject, or timing.

### Target User
Center Owner / Teacher.

### Functional Requirements
- **FR-BATCH-01 `[OBSERVED]`**: Create batch with `name`, `subject`, `classGrade`, `timing`, and optional `feeAmount`.
- **FR-BATCH-02 `[OBSERVED]`**: Edit batch details and view enrolled student count.
- **FR-BATCH-03 `[OBSERVED]`**: Delete batch (prevents deletion if active students are assigned).
- **FR-BATCH-04 `[PROPOSED]`**: Recurring weekly schedule calendar with room/instructor assignment.

---

## 5. Module 4: Daily Attendance Tracking

### Purpose
Records daily student presence or absence to track discipline and alert parents of truancy.

### Target User
Teacher / Administrator.

### Functional Requirements
- **FR-ATT-01 `[OBSERVED]`**: Date-picker and batch selector displays roster of enrolled students.
- **FR-ATT-02 `[OBSERVED]`**: Quick toggle for `Present`, `Absent`, or `Late`.
- **FR-ATT-03 `[OBSERVED]`**: Bulk "Mark All Present" action.
- **FR-ATT-04 `[INFERRED]`**: Automated WhatsApp notification to parents when marked `Absent`. *(Frontend UI contains toggle, but backend dispatch hook is currently missing)*.
- **FR-ATT-05 `[PROPOSED]`**: Biometric or QR scan attendance for students entering center.

---

## 6. Module 5: Fee Ledgers, Invoicing & Reconciliation

### Purpose
Automates monthly billing, partial fee collection, payment receipts, and reconciliation.

### Target User
Center Owner, Accountant, Parents.

### Functional Requirements
- **FR-FEE-01 `[OBSERVED] [TESTED]`**: Monthly fee generation batch job creates `Fee` records for all active students for a given month/year (`feeService.ts`).
- **FR-FEE-02 `[OBSERVED] [TESTED]`**: Distributed lock (`FeeCreationLock`) prevents duplicate fee generation for the same center and billing cycle.
- **FR-FEE-03 `[OBSERVED] [TESTED]`**: Offline / Cash collection modal accepts payment amount, payment mode (`CASH`, `UPI`, `BANK_TRANSFER`), and notes; marks fee `PAID` or `PARTIALLY_PAID`.
- **FR-FEE-04 `[OBSERVED] [TESTED]`**: Automatic calculation of `remainingAmount`, `paidAmount`, and status transitions.
- **FR-FEE-05 `[OBSERVED]`**: YouPI / Payment Gateway webhook endpoint (`/api/webhooks/youpi`) automatically reconciles online payments and updates fee records.
- **FR-FEE-06 `[PROPOSED]`**: Automated late fee penalty calculation and discount voucher management.

---

## 7. Module 6: WhatsApp Messaging & Automations

### Purpose
Enables coaching centers to connect their official WhatsApp number to send automated receipts, fee reminders, and center updates directly to parents.

### Target User
Center Owner.

### Functional Requirements
- **FR-WA-01 `[OBSERVED] [TESTED]`**: Center pairs WhatsApp by scanning QR code rendered on `/settings` page.
- **FR-WA-02 `[OBSERVED] [TESTED]`**: Session persistence stores Baileys authentication credentials in MongoDB Atlas (`baileys_auth_keys` / `baileys_creds`).
- **FR-WA-03 `[OBSERVED] [TESTED]`**: Manual "Send Reminder" button on `/fees` table triggers personalized WhatsApp message with student name, month, amount, and payment link.
- **FR-WA-04 `[OBSERVED] [TESTED]`**: Rate-limiting and 24-hour cooldown lock (`FeeReminderLog`) prevents spamming parents within 24 hours.
- **FR-WA-05 `[OBSERVED]`**: Simulation guard mode (`WHATSAPP_MODE=simulation`) prevents outbound API calls during development and staging.
- **FR-WA-06 `[PROPOSED]`**: Interactive WhatsApp chatbot allowing parents to check balance by texting "FEES".

---

## 8. Module 7: Parent Portal

### Purpose
Gives parents frictionless, zero-login access to view their child's attendance, test scores, fee ledger, and settle dues online.

### Target User
Student's Parent / Guardian.

### Functional Requirements
- **FR-PAR-01 `[OBSERVED]`**: Route `/parent/[studentId]` serves a public mobile-friendly portal.
- **FR-PAR-02 `[OBSERVED]`**: Shows student name, class, batch, and institute contact details.
- **FR-PAR-03 `[OBSERVED]`**: Lists pending fee dues with "Pay Now" UPI deep link button.
- **FR-PAR-04 `[OBSERVED]`**: Displays attendance percentage and recent test score cards.
- **FR-PAR-05 `[INFERRED]`**: Security masking for parent phone numbers. *(Currently exposes unmasked phone number in API response)*.
- **FR-PAR-06 `[PROPOSED]`**: OTP verification before rendering sensitive student performance records.
