# 07 — Authentication & Multi-Tenancy

*Last Reviewed: November 2026*
*Status: Authoritative Architecture Specification*

---

## 1. Multi-Tenant Architecture Overview

TuitionDesk employs a **shared-database, pooled-schema logical multi-tenancy model**. All tuition centers, students, fee ledgers, and attendance records reside in the same MongoDB database (`tuitiondesk`), distinguished by a partition key: `centerId: string`.

### Tenant Isolation Guarantee
A coaching center must only ever be able to read, mutate, or dispatch messages for its own enrolled students, batches, and fee ledgers. Cross-tenant leakage is a critical data breach and compliance violation.

---

## 2. Authentication Lifecycle

### 2.1 Password Hashing & Onboarding
- When a center registers via `/api/auth/register`, the password is encrypted using `bcryptjs` with standard salt rounds.
- The `Center` document is saved with `centerId`, `name`, `ownerName`, `phone`, and `password` (hash).

### 2.2 Session Generation & Cookie Strategy
- Upon successful credential verification (`/api/auth/login`), the backend uses the `jose` library to sign a JSON Web Token (JWT):
  ```typescript
  // Payload:
  {
    centerId: center.centerId,
    email: center.email,
    role: "owner",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days
  }
  ```
- The token is transmitted to the client via an HTTP-only cookie named `token`:
  - `httpOnly: true` (Inaccessible to browser JavaScript, mitigating XSS token theft).
  - `secure: true` in production (Transmitted over HTTPS only).
  - `sameSite: "lax"` (Prevents CSRF across external domains while allowing top-level navigation).
  - `path: "/"`

### 2.3 Session Verification Helper (`tution-desk-be/src/lib/auth.ts`)
The serverless API extracts and validates the token on every request:
```typescript
export async function getAuthenticatedCenterId(request: Request): Promise<string | null> {
  // 1. Check HTTP-only cookie
  // 2. Check Authorization Bearer header
  // 3. Verify signature using JWT_SECRET via jose
  // 4. Return decoded centerId
}
```

---

## 3. Tenant Authorization Boundaries & Vulnerability Review

### 3.1 Authorization Pattern: The Secure Model
In secure route handlers (e.g., `dashboard/owner/route.ts`), authorization is enforced strictly:
```typescript
const centerId = await getAuthenticatedCenterId(request);
if (!centerId) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
const data = await Fee.find({ centerId });
```

### 3.2 Security Risk: Fallback to Client-Supplied `centerId` `[UNVERIFIED AUDIT FINDING]`
The codebase audit identified a Broken Object Level Authorization (BOLA) pattern in several primary data routes:
- `tution-desk-be/src/app/api/students/route.ts:144`
- `tution-desk-be/src/app/api/fees/route.ts:168`
- `tution-desk-be/src/app/api/attendance/route.ts:48`
- `tution-desk-be/src/app/api/batches/route.ts:67`
- `tution-desk-be/src/app/api/tests/route.ts:16`

In these handlers, the code currently contains:
```typescript
const authCenterId = await getAuthenticatedCenterId(request);
const centerId = authCenterId || searchParams.get("centerId") || body.centerId;
```
> [!WARNING]
> **Audit Finding (SEC-BOLA-01)**: If an unauthenticated attacker strips cookies and supplies an arbitrary `?centerId=target_center`, the query may execute against that center's records. Remediation requires enforcing `if (!authCenterId) return 401;` across all endpoints without exception.

---

## 4. Public Parent Portal Access Control

### 4.1 Zero-Login Magic Link Design
TuitionDesk provides parents with instant access to their child's records via:
`https://tution-desk-one.vercel.app/parent/{studentId}`

- **Rationale**: Coaching center parents frequently abandon portals requiring account creation or mobile app installation.
- **Data Scope**: The parent API (`/api/parent/[studentId]`) queries strictly by `studentId`:
  - Returns student name, class, batch, and institute contact details.
  - Returns pending fee ledger and payment QR/UPI links.
  - Returns attendance percentage.

### 4.2 PII Protection & Security Boundary `[UNVERIFIED AUDIT FINDING]`
- Current behavior: The API returns `parentWhatsApp: student.parentWhatsApp` unmasked.
- Remediation direction: Mask phone numbers (`******1234`) to prevent PII exposure if a link is shared or guessed.

---

## 5. WhatsApp Microservice Multi-Tenant Isolation

The WhatsApp microservice (`whatsapp-server`) enforces isolation through:
1. **Per-Center Session Namespaces**: Each center's Baileys session is keyed by its `centerId`.
2. **MongoDB Credential Partitioning**: Auth keys and app state in `baileys_auth_keys` are scoped by `session_id: "centerId"`.
3. **Internal Secret Guard**: All microservice endpoints require the `x-internal-secret` header, preventing external clients from interacting with center WhatsApp sockets.
