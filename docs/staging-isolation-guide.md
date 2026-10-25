# TuitionDesk — Staging Isolation & Environment Configuration Guide

This guide details the isolation setup for the **TuitionDesk Staging Environment**. Staging must remain strictly decoupled from local development and production environments, ensuring zero credential sharing, isolated database access, and a fail-closed WhatsApp simulation guard.

---

## 1. Architecture & Isolation Principles

| Component | Local Development | Staging Environment | Production Environment |
| :--- | :--- | :--- | :--- |
| **Frontend** | `http://localhost:3000` | Staging domain / port | Production domain |
| **Backend API** | `http://localhost:3001` | Staging API domain / port | Production API domain |
| **WhatsApp Service**| Bound to `127.0.0.1:3005` | Bound to `127.0.0.1:3005` | Private VPC / loopback |
| **MongoDB Atlas** | Local / sandbox database | `tuitiondesk_staging` | Production cluster/db |
| **Database User** | Dev Atlas user | `tuitiondesk_staging_user` | Dedicated prod user |
| **WhatsApp Mode** | `simulation` | `WHATSAPP_MODE=simulation` | `live` (explicit opt-in) |
| **Live Dispatch** | `false` | `ENABLE_LIVE_WHATSAPP=false`| `ENABLE_LIVE_WHATSAPP=true` |

---

## 2. MongoDB Atlas Staging Database Isolation

To guarantee that a compromised or misconfigured staging instance can never touch production data, Atlas must enforce user-level database scoping.

### Step 2.1: Create Dedicated Database User
1. Log in to the [MongoDB Atlas Console](https://cloud.mongodb.com/).
2. Navigate to **Security** -> **Database Access**.
3. Click **Add New Database User**.
4. Configure Authentication:
   - **Authentication Method**: Password.
   - **Username**: `tuitiondesk_staging_user`.
   - **Password**: Generate a secure, 32+ character random password.

### Step 2.2: Assign Restricted Scoped Privileges
Under **Database User Privileges**:
- Do **NOT** assign `readWriteAnyDatabase` or `atlasAdmin`.
- Select **Add Built-In Role** or **Custom Roles**:
  - **Role**: `readWrite`
  - **Database**: `tuitiondesk_staging`
  - **Collection**: *(Leave empty to apply to all collections in `tuitiondesk_staging`)*
- Restrict to specific clusters if multiple clusters exist.

### Step 2.3: MongoDB Connection String Syntax
Construct the staging connection string using the staging database name explicitly:
```
mongodb+srv://tuitiondesk_staging_user:<STAGING_PASSWORD>@<ATLAS_CLUSTER>.mongodb.net/tuitiondesk_staging?retryWrites=true&w=majority
```
> [!IMPORTANT]
> The backend connection initialization (`tution-desk-be/src/lib/db.ts`) relies on the database name embedded in `MONGODB_URI`. Specifying `/tuitiondesk_staging` directly in the connection URI guarantees that Mongoose connects strictly to the staging database.

### Step 2.4: Validate User Scoping (Atlas Validation Step)
Using `mongosh` with the `tuitiondesk_staging_user` credentials:
```bash
# 1. Connect to staging database:
mongosh "mongodb+srv://<ATLAS_CLUSTER>.mongodb.net/tuitiondesk_staging" --username tuitiondesk_staging_user

# 2. Writing to staging collection should SUCCEED:
use tuitiondesk_staging
db.ping.insertOne({ test: "staging_isolation_check", date: new Date() })

# 3. Reading or writing to any other database MUST FAIL:
use tuitiondesk
db.users.find()  # Expected: MongoServerError: not authorized on tuitiondesk to execute command
```

---

## 3. Secret Separation & Cryptographic Generation

Staging credentials must never be copied from `.env.local`, `atlas-credentials.env`, or production environments.

### Step 3.1: Generate Cryptographically Secure Secrets
Run the following commands in PowerShell or bash to generate independent 256-bit secrets:

```bash
# Generate Staging JWT Secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate Staging WhatsApp Internal Secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate Staging Youpi Webhook Secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3.2: Configure Secret Pairings
- **`JWT_SECRET`**: Must be identical in Frontend (`.env.staging`) and Backend (`.env.staging`).
- **`WHATSAPP_INTERNAL_SECRET`**: Must be identical across Frontend, Backend, and WhatsApp Microservice.

---

## 4. WhatsApp Microservice Safety & Simulation Guard

To prevent sending test WhatsApp messages to actual students, parents, or staff, the application includes a hard simulation guard.

### Step 4.1: Configuration Flags
In staging environment files (`.env.staging` for Frontend and Backend):
```ini
WHATSAPP_MODE=simulation
ENABLE_LIVE_WHATSAPP=false
```

### Step 4.2: Guard Mechanics
The simulation guard in `src/lib/whatsappService.ts` and `tution-desk-be/src/lib/whatsappService.ts`:
1. Requires **both** `WHATSAPP_MODE === "live"` AND `ENABLE_LIVE_WHATSAPP === "true"` to send real messages.
2. In simulation mode (`WHATSAPP_MODE=simulation` or default):
   - **Zero HTTP network requests** are sent to port 3005.
   - Returns simulated success response with a unique synthetic ID (`sim-<uuid>`).
   - Sanitizes and masks recipient phone numbers in audit logs (e.g., `+91 98****1234`).
   - Prevents accidental microservice session consumption or rate-limiting.

### Step 4.3: Microservice Host Binding
In `whatsapp-server/.env.staging`:
```ini
PORT=3005
WHATSAPP_HOST=127.0.0.1
```
Binding to `127.0.0.1` ensures that the WhatsApp Express service is accessible only through localhost or internal reverse proxy, remaining completely hidden from the public internet.

---

## 5. Staging Origin & CORS Configuration

### Step 5.1: Backend CORS Verification
The CORS handler (`tution-desk-be/src/lib/cors.ts`) natively reads and parses the `ALLOWED_ORIGINS` environment variable:
```typescript
const envOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().replace(/\/$/, ''))
  : [];
```
It supports comma-separated URLs and automatically strips trailing slashes.

### Step 5.2: Staging Origins Configuration
In `tution-desk-be/.env.staging`:
```ini
ALLOWED_ORIGINS=https://staging.tuitiondesk.com,https://staging-admin.tuitiondesk.com
```

In Frontend (`.env.staging`):
```ini
NEXT_PUBLIC_API_URL=https://staging-api.tuitiondesk.com/api
NEXT_PUBLIC_APP_URL=https://staging.tuitiondesk.com
```

---

## 6. Staging Environment Templates

The workspace provides three clean example templates containing placeholders only:

1. **Frontend Template**: `D:\Tution Desk\.env.staging.example`
2. **Backend Template**: `D:\Tution Desk\tution-desk-be\.env.staging.example`
3. **WhatsApp Microservice Template**: `D:\Tution Desk\whatsapp-server\.env.staging.example`

### Instantiation Procedure (When deploying staging):
```bash
# Frontend
cp .env.staging.example .env.staging

# Backend
cp "tution-desk-be/.env.staging.example" "tution-desk-be/.env.staging"

# WhatsApp Microservice
cp "whatsapp-server/.env.staging.example" "whatsapp-server/.env.staging"
```
*Populate each newly created `.env.staging` with staging-specific secrets. Never commit active `.env.staging` files.*

---

## 7. Pre-Flight Validation Checklist

Before marking staging as operational, run these non-destructive verification checks:

- [ ] **No Secret Duplication**: Verify that staging secrets (`JWT_SECRET`, `WHATSAPP_INTERNAL_SECRET`) are distinct from local dev and production secrets.
- [ ] **Database Isolation**: Confirm `MONGODB_URI` contains `/tuitiondesk_staging` and authenticated user is `tuitiondesk_staging_user`.
- [ ] **Simulation Active**: Send a test reminder or verification code and confirm the log displays `[WhatsApp Simulation]` and returns `sim-...`. Ensure no WhatsApp QR or mobile session is triggered.
- [ ] **CORS Verification**: Send an `OPTIONS` preflight request from the staging frontend origin to `https://staging-api.../api/auth/login` and verify `Access-Control-Allow-Origin` returns the exact staging frontend origin.
- [ ] **Timing-Safe Auth on Port 3005**: If testing the WhatsApp server internally, verify that calling `POST /init` without `x-internal-secret` returns `401 Unauthorized`.

---

## 8. Safe Rollback Instructions

If staging configuration issues arise, rollback is clean, safe, and immediate:

### 8.1: Revert Environment Files
Delete any generated `.env.staging` files:
```powershell
Remove-Item -Path "D:\Tution Desk\.env.staging" -ErrorAction SilentlyContinue
Remove-Item -Path "D:\Tution Desk\tution-desk-be\.env.staging" -ErrorAction SilentlyContinue
Remove-Item -Path "D:\Tution Desk\whatsapp-server\.env.staging" -ErrorAction SilentlyContinue
```
Active local files (`.env.local`, `tution-desk-be/.env`, `whatsapp-server/.env`) remain unaffected.

### 8.2: Database Teardown (If required)
Because staging is isolated to `tuitiondesk_staging`:
1. In MongoDB Atlas, delete the user `tuitiondesk_staging_user`.
2. Drop only the database `tuitiondesk_staging`:
   ```javascript
   use tuitiondesk_staging
   db.dropDatabase()
   ```
3. Production and local collections remain completely untouched.
