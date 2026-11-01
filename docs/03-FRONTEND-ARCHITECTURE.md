# 03 — Frontend Architecture

*Last Reviewed: November 2026*
*Status: Authoritative Engineering Specification*

---

## 1. Overview & Technology Stack

The TuitionDesk frontend is a Single Page Application (SPA) built using the Next.js App Router. It is designed to run seamlessly on both desktop workstations for coaching center owners and mobile browsers for parents accessing magic links.

- **Framework**: Next.js 16.4.2 (App Router)
- **UI Runtime**: React 19.3.0
- **CSS Architecture**: Tailwind CSS v4 (`@tailwindcss/turbopack`)
- **Iconography**: Lucide React (`lucide-react` v1.61.0)
- **QR Code Rendering**: `qrcode.react` v4.2.0
- **Session / JWT Verification**: `jose` v6.2.13
- **Deployment**: Vercel Serverless Platform (`tution-desk-one.vercel.app`)

---

## 2. Directory Structure

```
d:/Tution Desk/src/
├── app/                       # Next.js App Router pages and route handlers
│   ├── layout.tsx             # Root HTML layout, font setup, navigation wrapper
│   ├── page.tsx               # Main owner dashboard view
│   ├── globals.css            # Global CSS variables and Tailwind imports
│   ├── middleware.ts          # Edge middleware for route protection
│   ├── admissions/            # Student admission page
│   ├── attendance/            # Attendance marking and tracking page
│   ├── fees/                  # Monthly fee ledgers and collection page
│   ├── login/                 # Owner login and center registration
│   ├── parent/                # Public parent portal (/parent/[studentId])
│   ├── p/                     # Shortened redirect route for parent links
│   ├── settings/              # Center profile and WhatsApp QR pairing
│   └── tests/                 # Academic assessments and marks entry
├── components/                # Reusable UI component modules
│   ├── attendance/            # Attendance toggles, calendar grid
│   ├── dashboard/             # Stat cards, revenue graphs, alerts
│   ├── fees/                  # Fee tables, reminder buttons, collection modal
│   ├── layout/                # Sidebar, header, navigation, mobile drawer
│   ├── modals/                # Modal dialog containers
│   ├── parent/                # Parent portal cards, fee pay button
│   ├── students/              # Admission forms, roster filters
│   └── tests/                 # Test score tables, marksheet forms
├── lib/                       # Frontend utility libraries & API client
│   ├── apiClient.ts           # Unified HTTP API client with LRU caching
│   ├── auth.ts                # Client-side session and cookie accessors
│   ├── authOwner.ts           # Owner authentication helpers
│   ├── centerProfile.ts       # Center profile state and update helpers
│   ├── jwt.ts                 # Browser-side JWT decoding
│   └── whatsappService.ts     # Client WhatsApp helper (Duplicate logic)
└── types/                     # Shared TypeScript interfaces & types
    └── index.ts               # Student, Fee, Batch, Center interface definitions
```

---

## 3. Application Routing & Page Map

| Route Path | Type | Purpose | Access Control |
| :--- | :--- | :--- | :--- |
| `/` | Page | Owner Executive Dashboard (stats, pending dues, recent activity). | Protected (Redirects to `/login` if unauthenticated) |
| `/login` | Page | Institute owner login and registration forms. | Public |
| `/admissions` | Page | Student registration, batch assignment, and student directory. | Protected |
| `/attendance` | Page | Batch-wise daily attendance marking and historical attendance logs. | Protected |
| `/fees` | Page | Fee ledger table, manual cash collection modal, WhatsApp reminder dispatch. | Protected |
| `/tests` | Page | Academic test scheduling, marks entry, and score cards. | Protected |
| `/settings` | Page | Center profile configuration and WhatsApp QR pairing console. | Protected |
| `/parent/[studentId]` | Page | Lightweight, mobile-friendly parent portal (fees, attendance, report card). | Public (Magic link) |
| `/p/[studentId]` | Route | Shortened URL redirector pointing to `/parent/[studentId]`. | Public |

---

## 4. API Client & State Management Architecture

### 4.1 Unified API Client (`src/lib/apiClient.ts`)
The frontend communicates with the backend API via a custom wrapper around native `fetch`:
- **Base URL Resolution**: Defaults to `process.env.NEXT_PUBLIC_API_URL` (falling back to `/api` for local proxying).
- **Credentials Handling**: Configured with `credentials: 'include'` to automatically transmit HTTP-only JWT cookies across origins.
- **In-Memory LRU Cache**: Implements a lightweight in-memory cache with an eviction policy and a 30-second Time-To-Live (TTL). Repeated navigations between `/students`, `/fees`, and `/dashboard` avoid redundant network calls.
- **Cache Invalidation**: Mutation methods (`POST`, `PUT`, `DELETE`) automatically invalidate affected cache keys (e.g. creating a fee invalidates the `fees` cache).

### 4.2 State Management
- TuitionDesk avoids heavy external state libraries (Redux/Zustand) in favor of standard React 19 primitives:
  - `useState` and `useEffect` for local component state.
  - Custom custom hooks and service functions in `src/lib/` for shared state (e.g., `centerProfile.ts`).
  - Optimistic UI updates in attendance toggles and manual fee collection.

---

## 5. UI Components & Layout Architecture

### 5.1 Root Layout (`src/app/layout.tsx`)
- Configures global typography using Next.js font optimization.
- Mounts the persistent desktop Sidebar navigation (`components/layout/Sidebar.tsx`) and mobile navigation bar.
- Suppresses layout sidebars on public routes (`/login`, `/parent/*`) by inspecting pathname.

### 5.2 Key Component Modules
1. **Attendance Component (`components/attendance/`)**:
   - Renders interactive student rows with three-state toggle buttons (`Present` [Green], `Absent` [Red], `Late` [Yellow]).
   - Provides a "Mark All Present" batch action button.
2. **Fee Management Component (`components/fees/`)**:
   - Renders the monthly fee roster with status badges (`PAID`, `PARTIALLY_PAID`, `PENDING`, `OVERDUE`).
   - Contains the "Collect Cash" modal with automatic calculation of remaining balance.
   - Houses the "Send WhatsApp Reminder" action button with visual countdown indicators.
3. **WhatsApp Pairing Console (`src/app/settings/page.tsx`)**:
   - Polls backend for WhatsApp session status (`READY`, `DISCONNECTED`, `INITIALIZING`).
   - Dynamically renders Baileys QR code using `qrcode.react` with refresh buttons.

---

## 6. Error Handling & Loading States

- **Network Resilience**: Failed API requests display non-blocking toast notifications or alert banners.
- **HTTP Status Mapping**:
  - `401 Unauthorized` triggers client-side redirect to `/login`.
  - `409 Conflict` (Reminder cooldown) displays informative alert to wait 24 hours.
  - `503 Service Unavailable` informs user that the WhatsApp microservice is disconnected.
  - `202 Accepted` indicates dispatch is uncertain due to socket timeout.
- **Loading Skeletons**: Table views implement animated pulse skeletons to minimize layout shift while fetching initial data.
