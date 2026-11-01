# 10 — Deployment Architecture & Environment Configuration

*Last Reviewed: November 2026*
*Status: Authoritative DevOps Specification*

---

## 1. Hosting Topology & Deployment Matrix

TuitionDesk operates across a distributed cloud topology:

| Subsystem | Cloud Provider | Target Environment | Root Directory | Build Command | Output / Start Command | Public URL |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Frontend UI** | Vercel Serverless | Production / Staging | `./` | `npm run build` | `next start` (Managed) | `https://tution-desk-one.vercel.app` |
| **Backend API** | Vercel Serverless | Production / Staging | `./tution-desk-be` | `npm run build` | `next start` (Managed) | `https://tuition-desk-backend.vercel.app` |
| **WhatsApp Engine** | Render Cloud | Persistent Web Container | `./whatsapp-server` | `npm install` | `node index.js` | Internal / Private VPC |
| **Datastore** | MongoDB Atlas | Managed Replica Set | N/A | Managed | Wire Protocol / TLS | Dedicated Cluster URI |

---

## 2. Port Allocations (Local & Staging Development)

| Service | Directory | Port | Protocol | Binding Host |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend Web App** | `./` | `3000` | HTTP / Next.js Dev | `0.0.0.0` / `localhost` |
| **Backend API Server** | `./tution-desk-be` | `3001` | HTTP / Next.js Dev | `0.0.0.0` / `localhost` |
| **WhatsApp Microservice**| `./whatsapp-server`| `3005` | HTTP / Express | `127.0.0.1` (Loopback only) |

> [!IMPORTANT]
> The WhatsApp microservice must always bind to `127.0.0.1` locally or remain behind an authenticated reverse proxy in production to prevent unauthorized access to port 3005.

---

## 3. Environment Variable Manifest (Names Only)

### 3.1 Frontend (`.env.local` / Vercel Environment)
- `NEXT_PUBLIC_API_URL`: Root URL of the backend API (e.g. `https://tuition-desk-backend.vercel.app/api`).
- `NEXT_PUBLIC_APP_URL`: Canonical root URL of the frontend web application.
- `JWT_SECRET`: 256-bit secret used for edge JWT verification.

### 3.2 Backend API (`tution-desk-be/.env` / Vercel Environment)
- `MONGODB_URI`: MongoDB Atlas connection string including credentials and replica set options.
- `JWT_SECRET`: Identical to frontend JWT secret; used for token signing and verification.
- `ALLOWED_ORIGINS`: Comma-separated list of permitted frontend domains (e.g. `https://tution-desk-one.vercel.app`).
- `WHATSAPP_SERVER_URL`: Private URL pointing to the WhatsApp microservice (e.g. `http://127.0.0.1:3005` or Render private URL).
- `WHATSAPP_INTERNAL_SECRET`: Shared pre-shared key (PSK) transmitted in `x-internal-secret` header.
- `WHATSAPP_MODE`: Set to `simulation` (default) or `live`.
- `ENABLE_LIVE_WHATSAPP`: Boolean flag (`true` or `false`) acting as the fail-closed simulation guard.
- `CRON_SECRET`: Bearer token required to trigger automated fee generation or overdue reminders.
- `YOUPI_WEBHOOK_SECRET`: Secret used to authenticate payment gateway callbacks.

### 3.3 WhatsApp Microservice (`whatsapp-server/.env` / Render Environment)
- `PORT`: HTTP port to bind to (Default: `3005`).
- `WHATSAPP_HOST`: Binding host interface (Default: `127.0.0.1`).
- `MONGODB_URI`: Shared MongoDB Atlas connection string for persisting Baileys auth keys.
- `WHATSAPP_INTERNAL_SECRET`: Shared secret matching the backend's `WHATSAPP_INTERNAL_SECRET`.
- `AUTO_RECONNECT_ON_BOOT`: Set to `true` to re-establish saved sessions on container startup.

---

## 4. Health Checks & Verification Endpoints

1. **Frontend Health**: `GET /` $\rightarrow$ Returns HTTP 200 and loads root application shell.
2. **Backend API Health**: `GET /api/centers` (with JWT) $\rightarrow$ Returns HTTP 200.
3. **WhatsApp Microservice Health**:
   - `GET /health` on port 3005 $\rightarrow$ Returns `{ "status": "ok", "uptime": 1234 }`.
   - `POST /init` without header $\rightarrow$ Must return HTTP 401 Unauthorized (timing-safe check).

---

## 5. Operational Risks & Mitigation

1. **Cold Starts on Vercel Serverless**:
   - *Risk*: Next.js serverless route handlers may experience cold start delays (500ms–2s), causing potential timeouts if Mongoose connections are renegotiated.
   - *Mitigation*: Cached global connection pooling implemented in `tution-desk-be/src/lib/db.ts`.
2. **WhatsApp Container Sleep on Free Tier**:
   - *Risk*: Deploying the WhatsApp microservice on Render free tier causes the container to spin down after 15 minutes of inactivity, severing Baileys WebSockets.
   - *Mitigation*: The service must be hosted on an active, persistent container tier (Render Starter or Fly.io) with persistent compute.
3. **Mongoose `autoIndex: false` in Production**:
   - *Risk*: New schemas or index updates are not automatically pushed to MongoDB Atlas.
   - *Mitigation*: Run `verifyLockIndexIntegrity` or use automated database migration scripts prior to feature deployments.

For detailed staging environment isolation and Atlas user-scoping guidelines, see [`staging-isolation-guide.md`](./staging-isolation-guide.md).
