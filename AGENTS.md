<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TuitionDesk — AI Agent Operational Instructions & Repository Rules

*Last Reviewed: November 2026*
*Status: Active Operational Standard*

Welcome to the **TuitionDesk** repository. This document is the primary entry point and mandatory operating guide for all AI coding agents, subagents, and human engineers.

---

## 1. Project Purpose & High-Level Architecture

TuitionDesk is a multi-tenant tuition center management and automated fee collection platform. It enables coaching center owners to manage student admissions, track attendance, organize academic batches, conduct tests, generate monthly fee ledgers, collect payments via UPI/Payment Gateway, and automatically dispatch reminders via WhatsApp.

The platform is split into three decoupled subsystems:
1. **Frontend App (`/src`)**: Next.js 16.4.2 (React 19, Tailwind CSS v4, Lucide icons) deployed on Vercel (`tution-desk-one.vercel.app`).
2. **Backend API (`/tution-desk-be`)**: Headless Next.js 16.4.2 API route server with Mongoose 9.11 connecting to MongoDB Atlas, deployed on Vercel (`tuition-desk-backend`).
3. **WhatsApp Microservice (`/whatsapp-server`)**: Standalone Express 4.21 service utilizing `@whiskeysockets/baileys` (v6.7.24) deployed on Render. Provides multi-tenant QR pairing, persistent MongoDB auth credentials, and message dispatch.

---

## 2. Repository Structure

```
d:/Tution Desk/
├── AGENTS.md                  # This file (Agent Operational Rules)
├── README.md                  # Developer & Repository Overview
├── docs/                      # Comprehensive Architecture & Product Docs
│   ├── README.md              # Documentation Navigation Index
│   ├── 00-PROJECT-OVERVIEW.md
│   ├── 01-PRODUCT-REQUIREMENTS.md
│   ├── 02-SYSTEM-ARCHITECTURE.md
│   ├── 03-FRONTEND-ARCHITECTURE.md
│   ├── 04-BACKEND-ARCHITECTURE.md
│   ├── 05-DATABASE-ARCHITECTURE.md
│   ├── 06-API-REFERENCE.md
│   ├── 07-AUTHENTICATION-AND-MULTITENANCY.md
│   ├── 08-WHATSAPP-INTEGRATION.md
│   ├── 09-EXTERNAL-INTEGRATIONS.md
│   ├── 10-DEPLOYMENT-AND-ENVIRONMENT.md
│   ├── 11-FEATURE-INVENTORY.md
│   ├── 12-SECURITY-AUDIT.md
│   ├── 13-KNOWN-ISSUES-AND-TECHNICAL-DEBT.md
│   ├── 14-TESTING-STRATEGY.md
│   ├── 15-DEVELOPMENT-ROADMAP.md
│   ├── 16-CHANGELOG.md
│   ├── staging-isolation-guide.md
│   └── decisions/             # Architecture Decision Records (ADRs)
├── src/                       # Frontend Next.js Application
├── tution-desk-be/            # Backend Next.js API & Business Logic
├── whatsapp-server/           # WhatsApp Baileys Automation Microservice
└── test/                      # System-wide Integration & Regression Tests
```

---

## 3. Mandatory AI Agent Rules (Non-Negotiable)

1. **Read Before Writing**: Always read [`AGENTS.md`](file:///d:/Tution%20Desk/AGENTS.md) and the corresponding module documentation in [`docs/`](file:///d:/Tution%20Desk/docs/) before touching any code.
2. **Never Trust Client `centerId` (Tenant Isolation)**: In all backend route handlers, derive the `centerId` exclusively from the authenticated JWT session (`getAuthenticatedCenterId(request)`). **Never** fall back to `searchParams.get("centerId")` or `req.body.centerId` without strict admin authorization.
3. **Zero Secrets in Code or Logs**: Never log, hardcode, commit, or print credentials, JWT secrets, database connection strings, or WhatsApp session keys. Use environment variable references exclusively.
4. **No Real WhatsApp Messages During Testing**: Keep outbound WhatsApp operations fail-closed under simulation (`WHATSAPP_MODE=simulation`, `ENABLE_LIVE_WHATSAPP=false`). Never send live messages to actual numbers without explicit written authorization.
5. **No Production Database Mutations**: Never perform manual deletes, updates, or destructive schema migrations on production MongoDB Atlas databases. All changes must be tested in staging or verified via mocked regression tests.
6. **No Spurious Deployments**: Do not trigger production deployments, change environment variables on Vercel/Render, or restart live services without explicit user instruction.
7. **No Scope Creep**: Confine your edits strictly to the requested task. Do not reformat unrelated files, upgrade packages without approval, or delete existing comments and docstrings.
8. **Preserve Next.js Agent Block**: Maintain the `<!-- BEGIN:nextjs-agent-rules -->` block at the top of `AGENTS.md` to prevent `next dev` daemon conflicts.
9. **Regression Tests Required**: Every bug fix or security patch must be accompanied by an automated regression test in `test/` or `whatsapp-server/test/`.
10. **Evidence Classification**: Always label architecture statements as `[CONFIRMED]`, `[TESTED]`, `[UNVERIFIED]`, `[INFERRED]`, or `[PROPOSED]`.

---

## 4. Development Workflow & Commands

### Running Locally
- **Frontend**: Run `npm run dev` in repository root (starts on `http://localhost:3000`).
- **Backend**: Run `npm run dev` in `tution-desk-be/` (starts on `http://localhost:3001`).
- **WhatsApp Microservice**: Run `node index.js` in `whatsapp-server/` (binds to `127.0.0.1:3005`).

### Running Validation Suites
- **Backend Typecheck & Build**:
  ```bash
  cd "d:\Tution Desk\tution-desk-be" && npx tsc --noEmit && npm run build
  ```
- **Frontend Typecheck & Build**:
  ```bash
  cd "d:\Tution Desk" && npx tsc --noEmit && npm run build
  ```
- **Root Regression Tests**:
  ```bash
  node --test test/phase2a_fee_system.test.mjs test/fee_reminder_http_mapping.test.mjs
  ```
- **WhatsApp Microservice Tests**:
  ```bash
  cd "d:\Tution Desk\whatsapp-server" && npm test
  ```

---

## 5. Documentation Maintenance Policy

When completing any feature, architectural adjustment, or security fix:
- Update [`docs/16-CHANGELOG.md`](file:///d:/Tution%20Desk/docs/16-CHANGELOG.md).
- Update the relevant module document in `docs/` (e.g. `04-BACKEND-ARCHITECTURE.md` or `08-WHATSAPP-INTEGRATION.md`).
- If an architectural trade-off was made, record an ADR in [`docs/decisions/`](file:///d:/Tution%20Desk/docs/decisions/).
