# 06 — API Reference & Endpoint Inventory

*Last Reviewed: November 2026*
*Status: Authoritative REST Specification*

---

## 1. Overview & Authentication Conventions

The TuitionDesk backend provides RESTful JSON endpoints.
- **Base URL**: `https://tuition-desk-backend.vercel.app/api` (Local: `http://localhost:3001/api`)
- **Session Transport**: Requests from the browser pass an HTTP-only cookie (`token`) containing a signed Jose JWT. Alternatively, server-to-server endpoints accept `Authorization: Bearer <token>`.
- **CORS Handling**: Handled via `src/lib/cors.ts`. Allowed origins are configured via `ALLOWED_ORIGINS`.

---

## 2. Authentication Endpoints (`/api/auth`)

### 2.1 Login
- **Endpoint**: `POST /api/auth/login`
- **File**: `tution-desk-be/src/app/api/auth/login/route.ts`
- **Auth Required**: No (Public)
- **Request Body**:
  ```json
  {
    "email": "owner@academy.com",
    "password": "SecretPassword123"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "center": {
      "centerId": "academy_delhi",
      "name": "Delhi Coaching Academy",
      "ownerName": "John Doe",
      "phone": "+919876543210"
    }
  }
  ```
- **Cookies Set**: `token` (HttpOnly, Secure, SameSite=Lax, Max-Age=7d).
- **Error Codes**: `400 Bad Request`, `401 Unauthorized`.

### 2.2 Register
- **Endpoint**: `POST /api/auth/register`
- **File**: `tution-desk-be/src/app/api/auth/register/route.ts`
- **Auth Required**: No (Public)
- **Request Body**:
  ```json
  {
    "name": "Admin Name",
    "email": "admin@academy.com",
    "password": "SecurePassword",
    "phone": "+919876543210",
    "centerName": "Academy Name",
    "address": "New Delhi"
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "centerId": "academy_delhi"
  }
  ```
- **Error Codes**: `400 Bad Request`, `409 Conflict`.

### 2.3 Logout
- **Endpoint**: `POST /api/auth/logout`
- **File**: `tution-desk-be/src/app/api/auth/logout/route.ts`
- **Auth Required**: No (Clears cookie)
- **Response** (`200 OK`): `{ "success": true }` (Sets cookie `token=; Max-Age=0`).

---

## 3. Student Management (`/api/students`)

### 3.1 List Students
- **Endpoint**: `GET /api/students`
- **File**: `tution-desk-be/src/app/api/students/route.ts`
- **Auth Required**: Yes (JWT session)
- **Query Params**: `centerId` (Optional/Deprecated), `batch` (Optional filter).
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "6724a1b...",
        "name": "Aarav Sharma",
        "batch": "Class 10 - Math",
        "parentWhatsApp": "+919876543210",
        "monthlyFee": 2500,
        "billingCycleDate": 5,
        "isActive": true
      }
    ]
  }
  ```

### 3.2 Create Student
- **Endpoint**: `POST /api/students`
- **File**: `tution-desk-be/src/app/api/students/route.ts`
- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "name": "Aarav Sharma",
    "batch": "Class 10 - Math",
    "parentWhatsApp": "+919876543210",
    "monthlyFee": 2500,
    "billingCycleDate": 5
  }
  ```
- **Response** (`201 Created`): Returns newly created Student document.

### 3.3 Student Details & Update
- **Endpoints**: `GET /api/students/[id]`, `PUT /api/students/[id]`, `DELETE /api/students/[id]`
- **File**: `tution-desk-be/src/app/api/students/[id]/route.ts`

---

## 4. Fee Management (`/api/fees`)

### 4.1 List Fee Ledgers
- **Endpoint**: `GET /api/fees`
- **File**: `tution-desk-be/src/app/api/fees/route.ts`
- **Auth Required**: Yes
- **Query Params**: `month` (e.g. "2026-10"), `status` (`Pending`, `Paid`, `Partial Paid`).
- **Response** (`200 OK`): Array of Fee documents populated with student records.

### 4.2 Generate Monthly Fees
- **Endpoint**: `POST /api/fees`
- **File**: `tution-desk-be/src/app/api/fees/route.ts`
- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "month": "October 2026",
    "billingMonth": "2026-10"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "generatedCount": 42,
    "skippedCount": 3
  }
  ```
- **Error Codes**: `409 Conflict` (Duplicate generation run blocked by `FeeCreationLock`).

### 4.3 Manual / Cash Payment Collection
- **Endpoint**: `POST /api/fees/manual-collection`
- **File**: `tution-desk-be/src/app/api/fees/manual-collection/route.ts`
- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "feeId": "6724b9c...",
    "amount": 1500,
    "paymentMode": "CASH",
    "notes": "Paid in person"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "fee": {
      "_id": "6724b9c...",
      "amountDue": 2500,
      "paidAmount": 1500,
      "status": "Partial Paid"
    }
  }
  ```

### 4.4 Dispatch Fee Reminder (WhatsApp)
- **Endpoint**: `POST /api/fees/[feeId]/remind`
- **File**: `tution-desk-be/src/app/api/fees/[feeId]/remind/route.ts`
- **Auth Required**: Yes
- **Response Status Codes**:
  - `200 OK`: Reminder dispatched and provider accepted.
  - `202 Accepted`: Socket timeout (>25s), delivery status uncertain.
  - `409 Conflict`: 24-hour rate-limiting cooldown active.
  - `503 Service Unavailable`: WhatsApp microservice disconnected or offline.

---

## 5. Attendance (`/api/attendance`)

### 5.1 Query & Mark Attendance
- **Endpoint**: `GET /api/attendance` & `POST /api/attendance`
- **File**: `tution-desk-be/src/app/api/attendance/route.ts`
- **Auth Required**: Yes
- **POST Request Body**:
  ```json
  {
    "date": "2026-10-31",
    "batch": "Class 10 - Math",
    "records": [
      { "studentId": "6724a1b...", "status": "Present" },
      { "studentId": "6724a2c...", "status": "Absent" }
    ]
  }
  ```

---

## 6. Academic Batches & Tests

- `GET /api/batches`, `POST /api/batches`, `PUT /api/batches/[id]` (`batches/route.ts`)
- `GET /api/tests`, `POST /api/tests`, `PUT /api/tests/[id]` (`tests/route.ts`)

---

## 7. Public Parent Portal (`/api/parent`)

### 7.1 Fetch Ward Details
- **Endpoint**: `GET /api/parent/[studentId]`
- **File**: `tution-desk-be/src/app/api/parent/[studentId]/route.ts`
- **Auth Required**: Public (URL token/slug)
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "student": {
      "name": "Aarav Sharma",
      "batch": "Class 10 - Math"
    },
    "center": {
      "name": "Delhi Coaching Academy",
      "upiId": "academy@icici"
    },
    "pendingFees": [...],
    "attendanceSummary": { "percentage": 94, "totalDays": 50 }
  }
  ```

---

## 8. Webhooks & Integrations (`/api/webhooks`)

### 8.1 YouPI Payment Gateway Webhook
- **Endpoint**: `POST /api/webhooks/youpi`
- **File**: `tution-desk-be/src/app/api/webhooks/youpi/route.ts`
- **Auth Required**: HMAC / Secret signature verification
- **Purpose**: Automatically reconciles online UPI payments and transitions Fee documents to `Paid`.
