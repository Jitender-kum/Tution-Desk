# 02 — System Architecture & Data Flows

*Last Reviewed: November 2026*
*Status: Authoritative Architectural Blueprint*

---

## 1. High-Level Architecture Topology

TuitionDesk is structured as a decoupled, multi-tier system composed of three discrete microservices:

1. **Frontend Client Application** (`/src`): Built with Next.js 16 (React 19, Tailwind CSS v4) hosted on Vercel (`tution-desk-one.vercel.app`). Provides the Single Page Application (SPA) dashboard for center owners and the public Parent Portal.
2. **Backend API Service** (`/tution-desk-be`): Headless Next.js 16 REST API route handlers hosted on Vercel (`tuition-desk-backend.vercel.app`). Handles business logic, authentication, Mongoose ODM connections, and data persistence.
3. **WhatsApp Engine Microservice** (`/whatsapp-server`): Express 4.21 server utilizing `@whiskeysockets/baileys` (v6.7.24) deployed on Render. Maintains persistent WebSocket connections with WhatsApp's servers, storing tenant authentication keys in MongoDB Atlas.

---

## 2. Mermaid Diagrams

### 2.1 Overall System Architecture

```mermaid
graph TB
    subgraph Clients["Client Tier"]
        Owner[Center Owner / Admin Browser]
        Parent[Parent / Student Mobile Browser]
    end

    subgraph VercelEdge["Vercel Cloud Platform"]
        FE[TuitionDesk Frontend SPA\nNext.js 16 / React 19\ntution-desk-one.vercel.app]
        BE[TuitionDesk Backend API\nNext.js 16 Route Handlers\ntuition-desk-backend.vercel.app]
    end

    subgraph RenderCloud["Render Cloud Platform"]
        WA[WhatsApp Automation Service\nNode.js Express + Baileys 6.7.24\nwhatsapp-server]
    end

    subgraph DataTier["Data Persistence Tier"]
        Atlas[(MongoDB Atlas Multi-Tenant Replica Set\nDatabase: tuitiondesk)]
    end

    subgraph External["External Cloud Networks"]
        Meta[WhatsApp WebSocket Network\nweb.whatsapp.com]
        Gateway[YouPI / Payment Gateway\nWebhook Provider]
    end

    %% Client Interactions
    Owner -->|HTTPS / UI Navigation| FE
    Parent -->|HTTPS / Magic Link| FE
    FE -->|REST API / JSON / JWT Cookie| BE

    %% Backend Integrations
    BE -->|Mongoose 9.11 ODM / TLS| Atlas
    BE -->|HTTP POST / Internal Secret HMAC| WA
    Gateway -->|HTTPS Webhook / Signature| BE

    %% WhatsApp Microservice Interactions
    WA -->|Persistent Session Creds / Auth Keys| Atlas
    WA -->|Encrypted WebSocket CB:success| Meta
```

---

### 2.2 End-to-End Request Lifecycle & Client Caching

The frontend utilizes an in-memory LRU cache (`src/lib/apiCache.ts`) with a 30-second TTL to optimize owner dashboard navigation and reduce load on the backend serverless endpoints.

```mermaid
sequenceDiagram
    autonumber
    actor User as Center Owner
    participant UI as Frontend View (React 19)
    participant Cache as Client LRU Cache (apiCache.ts)
    participant ClientAPI as API Client (src/lib/api.ts)
    participant Backend as Backend Route Handler
    participant DB as MongoDB Atlas

    User->>UI: Navigate to /students
    UI->>ClientAPI: fetchStudents(centerId)
    ClientAPI->>Cache: get('students_${centerId}')
    alt Cache Hit (TTL < 30s)
        Cache-->>ClientAPI: Return cached JSON
        ClientAPI-->>UI: Render student list instantly
    else Cache Miss / Expired
        ClientAPI->>Backend: GET /api/students?centerId=... (with JWT cookie)
        Backend->>Backend: Verify JWT & extract authCenterId
        Backend->>DB: Student.find({ centerId, isActive: true })
        DB-->>Backend: Query Result Document Array
        Backend-->>ClientAPI: 200 OK { success: true, data: [...] }
        ClientAPI->>Cache: set('students_${centerId}', data, 30s)
        ClientAPI-->>UI: Render student list
    end
```

---

### 2.3 Authentication Lifecycle

Authentication relies on signed, HTTP-only JWT cookies generated via the `jose` library.

```mermaid
sequenceDiagram
    autonumber
    actor Owner as Center Owner
    participant FE as Frontend (/login)
    participant AuthAPI as Backend (/api/auth/login)
    participant DB as MongoDB (Center Collection)

    Owner->>FE: Enters email and password
    FE->>AuthAPI: POST /api/auth/login { email, password }
    AuthAPI->>DB: Center.findOne({ email })
    DB-->>AuthAPI: Center Record (with passwordHash)
    AuthAPI->>AuthAPI: bcrypt.compare(password, passwordHash)
    alt Credentials Valid
        AuthAPI->>AuthAPI: Sign JWT with centerId, email, role (jose)
        AuthAPI-->>FE: 200 OK + Set-Cookie: token=... (HttpOnly, Secure, SameSite=Lax)
        FE-->>Owner: Redirect to /dashboard
    else Invalid Password
        AuthAPI-->>FE: 401 Unauthorized { error: "Invalid credentials" }
        FE-->>Owner: Display error alert
    end
```

---

### 2.4 Multi-Tenant Data Isolation Flow

TuitionDesk uses logical (row-level) tenant separation within shared MongoDB collections, keyed by `centerId`.

```mermaid
sequenceDiagram
    autonumber
    actor Client as Authenticated Client
    participant Middleware as Auth Helper (getAuthenticatedCenterId)
    participant Route as API Handler (/api/fees)
    participant DB as MongoDB Atlas

    Client->>Route: GET /api/fees (Cookie: token=JWT)
    Route->>Middleware: getAuthenticatedCenterId(request)
    Middleware->>Middleware: jwtVerify(token, JWT_SECRET)
    Middleware-->>Route: authCenterId: "center_abc123"

    Note over Route: [UNVERIFIED AUDIT FINDING]<br/>Must NOT fallback to query centerId!

    Route->>DB: Fee.find({ centerId: "center_abc123" })
    DB-->>Route: Scoped tenant records only
    Route-->>Client: 200 OK [Fee Records for center_abc123]
```

---

### 2.5 Student Admission & Fee Ledger Lifecycle

```mermaid
stateDiagram-v2
    [*] --> NewAdmission: Owner Enrolls Student
    NewAdmission --> ActiveStudent: Set Batch & Monthly Fee

    state "Monthly Billing Cycle" as Billing {
        ActiveStudent --> LockAcquisition: Cron / Trigger /api/fees/generate
        LockAcquisition --> DuplicateCheck: Check FeeCreationLock
        DuplicateCheck --> FeeGenerated: Unique Record Created (Status: PENDING)
        DuplicateCheck --> Skipped: Already Generated for Month/Year
    }

    FeeGenerated --> PaymentNudge: Dispatch WhatsApp Reminder

    state "Payment Settlement" as Settlement {
        FeeGenerated --> PartialPaid: Cash / UPI Collection < FeeAmount
        PartialPaid --> FullPaid: Subsequent Collection Clears Remaining
        FeeGenerated --> FullPaid: Full Payment Received (Status: PAID)
        FeeGenerated --> Overdue: DueDate Passed & Remaining > 0 (Status: OVERDUE)
        Overdue --> FullPaid: Late Settlement
    }

    FullPaid --> ReceiptIssued: WhatsApp Receipt Dispatched
    ReceiptIssued --> [*]
```

---

### 2.6 WhatsApp Message Lifecycle & Failure Mapping

```mermaid
sequenceDiagram
    autonumber
    actor Owner as Center Owner
    participant FE as Frontend Dashboard
    participant BE as Backend (/api/fees/[id]/remind)
    participant RemindSvc as Reminder Service (reminderService.ts)
    participant DB as MongoDB Atlas (FeeReminderLog)
    participant WA as WhatsApp Microservice (BaileysProvider)
    participant Meta as Meta WhatsApp Servers

    Owner->>FE: Click "Send Reminder"
    FE->>BE: POST /api/fees/{feeId}/remind
    BE->>RemindSvc: sendFeeReminder(centerId, feeId)
    RemindSvc->>DB: Check FeeReminderLog (24h cooldown)
    alt Cooldown Active (< 24h since last sent)
        RemindSvc-->>BE: Status: COOLDOWN_ACTIVE
        BE-->>FE: 409 Conflict { error: "Reminder sent within last 24 hours" }
    else Cooldown Expired
        RemindSvc->>WA: POST /send-message { centerId, to, text, templateName: 'fee_reminder' }
        WA->>WA: Verify x-internal-secret header
        alt WhatsApp Microservice Offline
            WA-->>RemindSvc: Connection Refused / 503
            RemindSvc-->>BE: Status: SERVICE_UNAVAILABLE
            BE-->>FE: 503 Service Unavailable
        else WhatsApp Session Not Paired
            WA-->>RemindSvc: 400 { success: false, error: "SESSION_NOT_READY" }
            RemindSvc-->>BE: Status: PROVIDER_REJECTED
            BE-->>FE: 503 Service Unavailable
        else Dispatch Timeout (> 25s)
            WA-->>RemindSvc: ETIMEDOUT / Socket Hangup
            RemindSvc-->>BE: Status: DISPATCH_UNCERTAIN
            BE-->>FE: 202 Accepted { warning: "Dispatch status uncertain" }
        else Successful Socket Transmission
            WA->>Meta: sock.sendMessage(jid, { text })
            Meta-->>WA: Ack message receipt
            WA-->>RemindSvc: 200 OK { success: true, messageId: "msg_xyz" }
            RemindSvc->>DB: Record FeeReminderLog (centerId, feeId, timestamp)
            RemindSvc-->>BE: Status: SUCCESS
            BE-->>FE: 200 OK { success: true, messageId: "msg_xyz" }
        end
    end
```

---

## 3. Network Ports & Communication Protocols

| Link | Origin | Destination | Protocol | Authentication |
| :--- | :--- | :--- | :--- | :--- |
| **Client to Frontend** | Web Browser | Vercel (Frontend) | HTTPS (TLS 1.3) | None (Public Assets) |
| **Client to Backend** | Web Browser | Vercel (Backend) | HTTPS (TLS 1.3) | HTTP-only JWT Cookie |
| **Backend to Database** | Vercel Serverless | MongoDB Atlas | MongoDB Wire Protocol / TLS | SCRAM-SHA-256 Credentials |
| **Backend to WhatsApp** | Vercel Serverless | Render Web Service | HTTPS / REST | Custom Header (`x-internal-secret`) |
| **WhatsApp to Database** | Render Container | MongoDB Atlas | MongoDB Wire Protocol / TLS | SCRAM-SHA-256 Credentials |
| **WhatsApp to Meta** | Render Container | WhatsApp Servers | Encrypted WSS (Baileys) | Noise Protocol / Curve25519 Keys |
