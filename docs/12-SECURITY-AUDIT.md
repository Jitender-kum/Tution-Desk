# 12 — Security Audit Registry & Vulnerability Assessment

*Last Reviewed: November 2026*
*Status: Authoritative Vulnerability Registry*

---

## 1. Security Review Methodology & Evidence Standard

This document catalogs all security and architectural vulnerabilities identified during the codebase audit of TuitionDesk. In strict adherence to our evidence policy:

> [!IMPORTANT]
> **Verification Policy**: All security findings from the codebase audit are initially registered with status **`UNVERIFIED`** until verified via independent automated or manual exploit verification tests. The presence of matching source code lines provides documentary evidence, but actual exploitability under production runtime configurations requires explicit verification testing.

---

## 2. Vulnerability Registry

### Finding 1: Broken Object Level Authorization (BOLA) in Core Data APIs
- **Finding ID**: `SEC-BOLA-01`
- **Reported Severity**: **`CRITICAL`**
- **Verification Status**: **`UNVERIFIED`** *(Audit observation with matching source code lines)*
- **Reported Behaviour**: Core backend API endpoints query student, fee, attendance, test, and batch records using a fallback pattern:
  `const centerId = authCenterId || searchParams.get("centerId") || body.centerId;`
  If an unauthenticated external client omits the JWT cookie/header and supplies an arbitrary `centerId` parameter via URL query string or JSON payload, the backend executes the query for that center without verifying ownership or session existence.
- **Relevant File Paths & Code References**:
  - `tution-desk-be/src/app/api/students/route.ts:144`
  - `tution-desk-be/src/app/api/fees/route.ts:168`
  - `tution-desk-be/src/app/api/attendance/route.ts:48`
  - `tution-desk-be/src/app/api/tests/route.ts:16`
  - `tution-desk-be/src/app/api/batches/route.ts:67`
- **Evidence Available**: Direct source code inspection confirms the presence of `authCenterId || searchParams.get("centerId")` in the listed route handlers.
- **Verification Still Required**: Execute unauthenticated HTTP curl requests without cookies against a running backend API passing `?centerId=test_center` to prove whether response data is leaked or blocked by upstream edge middleware.
- **Recommended Remediation Direction**:
  Remove the fallback to client-supplied `centerId`. Require strictly:
  ```typescript
  const authCenterId = await getAuthenticatedCenterId(request);
  if (!authCenterId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401, headers: corsHeaders });
  }
  const centerId = authCenterId;
  ```

---

### Finding 2: Hardcoded Legacy Default Password Bypass
- **Finding ID**: `SEC-AUTH-02`
- **Reported Severity**: **`HIGH`**
- **Verification Status**: **`UNVERIFIED`** *(Audit observation with matching source code lines)*
- **Reported Behaviour**: The login route handler allows centers with unhashed or missing legacy passwords to log in using hardcoded credentials (`"password123"` or `"123456"`). If a center was provisioned via seed script without a password hash, an attacker can authenticate and claim account ownership.
- **Relevant File Paths & Code References**:
  - `tution-desk-be/src/app/api/auth/login/route.ts:41-48`
- **Evidence Available**:
  ```typescript
  if (password === "password123" || password === "123456") {
    isMatch = true;
    // sets password hash and saves center
  }
  ```
- **Verification Still Required**: Create a test Center document without a `password` field in a test database and verify whether login with `"password123"` succeeds and generates an owner JWT.
- **Recommended Remediation Direction**:
  Remove the legacy fallback conditional completely. Enforce standard `bcrypt.compare(password, center.password)` for all centers. Require administrative reset for any accounts lacking password hashes.

---

### Finding 3: Unauthenticated PII Phone Number Exposure in Parent Portal
- **Finding ID**: `SEC-PRIV-03`
- **Reported Severity**: **`HIGH`**
- **Verification Status**: **`UNVERIFIED`** *(Audit observation with matching source code lines)*
- **Reported Behaviour**: The public parent portal route (`/api/parent/[studentId]`) returns student details and raw parent contact information without requiring authentication or masking the phone number. Anyone possessing or enumerating a 24-character hexadecimal MongoDB `studentId` can retrieve the parent's full WhatsApp phone number.
- **Relevant File Paths & Code References**:
  - `tution-desk-be/src/app/api/parent/[studentId]/route.ts:206`
- **Evidence Available**: Source code returns `parentWhatsApp: student.parentWhatsApp` directly in the JSON response payload.
- **Verification Still Required**: Send a `GET /api/parent/<valid_id>` request and inspect whether the raw phone number is returned in full plaintext.
- **Recommended Remediation Direction**:
  Mask the parent's contact number in the response (e.g. `+91 98******1234`) or require the parent to enter the last 4 digits of their registered phone number before displaying student information.

---

### Finding 4: Timing Attack Risk in WhatsApp Microservice Secret Validation
- **Finding ID**: `SEC-AUTH-04`
- **Reported Severity**: **`MEDIUM`**
- **Verification Status**: **`UNVERIFIED`** *(Audit observation)*
- **Reported Behaviour**: The WhatsApp microservice authenticates incoming requests using `req.headers['x-internal-secret'] === process.env.WHATSAPP_INTERNAL_SECRET`. Standard string equality comparisons terminate early upon encountering the first mismatch, potentially leaking secret length and character values via statistical timing attacks.
- **Relevant File Paths & Code References**:
  - `whatsapp-server/index.js`
- **Evidence Available**: Simple string equality operator (`===`) observed in microservice route authorization.
- **Verification Still Required**: Statistical timing measurement across varying candidate secret strings.
- **Recommended Remediation Direction**:
  Use Node.js native constant-time buffer comparison:
  ```javascript
  crypto.timingSafeEqual(
    Buffer.from(providedSecret || '', 'utf-8'),
    Buffer.from(expectedSecret || '', 'utf-8')
  )
  ```

---

### Finding 5: `autoIndex: false` on Mongoose Models with Unique Constraints
- **Finding ID**: `SEC-DATA-05`
- **Reported Severity**: **`MEDIUM`**
- **Verification Status**: **`UNVERIFIED`** *(Audit observation with matching source code lines)*
- **Reported Behaviour**: Mongoose schemas for `Fee.ts`, `FeeCreationLock.ts`, and `FeeReminderLog.ts` specify `{ autoIndex: false }`. In production MongoDB Atlas clusters, unique compound indexes (such as the concurrency lock on `{ lockKey: 1 }`) are NOT automatically provisioned by Mongoose. If a new cluster is provisioned without explicit index migration scripts, the concurrency lock will fail open, allowing duplicate fee generation runs.
- **Relevant File Paths & Code References**:
  - `tution-desk-be/src/models/Fee.ts:185`
  - `tution-desk-be/src/models/FeeCreationLock.ts:77`
  - `tution-desk-be/src/models/FeeReminderLog.ts:133`
- **Evidence Available**: Source code explicitly declares `autoIndex: false` in schema options.
- **Verification Still Required**: Inspect the target MongoDB Atlas cluster using `db.feecreationlocks.getIndexes()` to confirm whether the unique index exists.
- **Recommended Remediation Direction**:
  Implement a deployment verification check or automated migration script that runs `model.syncIndexes()` or `ensureIndexes()` during production rollouts.

---

### Finding 6: Permissive Local CORS Defaults
- **Finding ID**: `SEC-CONF-06`
- **Reported Severity**: **`LOW`**
- **Verification Status**: **`UNVERIFIED`** *(Audit observation)*
- **Reported Behaviour**: When `ALLOWED_ORIGINS` is not defined in the backend environment, the CORS handler falls back to permitting `http://localhost:3000` and `http://127.0.0.1:3000`. If an environment is misconfigured in staging or production without `ALLOWED_ORIGINS`, localhost origins might remain permitted.
- **Relevant File Paths & Code References**:
  - `tution-desk-be/src/lib/cors.ts`
- **Evidence Available**: Fallback array observed in `cors.ts`.
- **Verification Still Required**: Send a preflight `OPTIONS` request with origin `http://malicious.com` against an unconfigured backend instance.
- **Recommended Remediation Direction**:
  Fail closed in non-development environments: throw an initialization error or deny all cross-origin requests if `ALLOWED_ORIGINS` is empty in staging or production.
