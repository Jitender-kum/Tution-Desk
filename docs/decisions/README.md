# Architecture Decision Records (ADRs)

*Last Reviewed: November 2026*
*Status: Living Decision Log*

---

## 1. Overview & Purpose

Architecture Decision Records (ADRs) capture important architectural, structural, and technology choices made during the evolution of TuitionDesk. Recording the context, trade-offs, and consequences of these decisions prevents future teams from unknowingly repeating discarded approaches or breaking underlying system assumptions.

---

## 2. ADR Index

| ADR ID | Decision Title | Status | Date | Summary |
| :--- | :--- | :--- | :--- | :--- |
| [ADR-001](#adr-001-decoupled-whatsapp-microservice-on-render) | **Decoupled WhatsApp Microservice on Render** | `ACCEPTED` | 2026-10 | Host Baileys WhatsApp automation as a persistent Express container rather than inside Next.js serverless functions. |
| [ADR-002](#adr-002-shared-database-logical-multi-tenancy) | **Shared Database Logical Multi-Tenancy** | `ACCEPTED` | 2026-09 | Use a single MongoDB database with `centerId` tenant partitioning rather than database-per-tenant. |
| [ADR-003](#adr-003-distributed-concurrency-locking-for-fee-billing) | **Distributed Concurrency Locking for Fee Billing** | `ACCEPTED` | 2026-10 | Employ atomic MongoDB writes on `FeeCreationLock` with TTL indexes to ensure idempotent monthly billing. |
| [ADR-004](#adr-004-zero-login-magic-link-parent-portal) | **Zero-Login Magic Link Parent Portal** | `ACCEPTED` | 2026-10 | Serve parent portals via student ID slugs without requiring account creation to maximize parent adoption. |

---

## 3. ADR Records

### ADR-001: Decoupled WhatsApp Microservice on Render
- **Status**: `ACCEPTED`
- **Context**: Meta's WhatsApp Web protocol requires persistent, bidirectional WebSockets to exchange Noise Protocol crypto keys and delivery acknowledgements. TuitionDesk's main backend runs on Vercel Serverless, where compute instances are ephemeral and frozen between HTTP requests.
- **Decision**: Decouple the WhatsApp automation engine into a standalone Node.js Express service (`whatsapp-server`) hosted on a persistent container platform (Render), backed by MongoDB Atlas for auth credential persistence.
- **Consequences**:
  - *Positive*: Uninterrupted WebSocket connections with Meta; zero serverless execution timeouts.
  - *Trade-off*: Requires inter-service communication over internal HTTP (`x-internal-secret`) and independent container monitoring.

---

### ADR-002: Shared Database Logical Multi-Tenancy
- **Status**: `ACCEPTED`
- **Context**: TuitionDesk supports hundreds of small tuition centers. Provisioning isolated MongoDB databases or clusters per center introduces high cost and complex connection management.
- **Decision**: Adopt a shared-database, pooled-collection model where all documents contain a required `centerId: string` field, backed by compound indexes (`{ centerId: 1, ... }`).
- **Consequences**:
  - *Positive*: Cost-effective; instant tenant provisioning; simple connection pooling.
  - *Trade-off*: Application code bears strict responsibility for tenant scoping (`getAuthenticatedCenterId`). BOLA vulnerabilities (`SEC-BOLA-01`) represent critical security risks if unaddressed.

---

### ADR-003: Distributed Concurrency Locking for Fee Billing
- **Status**: `ACCEPTED`
- **Context**: Monthly fee generation iterates through hundreds of students. If multiple administrators trigger generation simultaneously, duplicate invoices could be issued.
- **Decision**: Implement `FeeCreationLock` with a unique compound index on `lockKey` (`centerId:studentId:billingMonth:feeType`) and a 10-minute TTL index.
- **Consequences**:
  - *Positive*: Guarantees idempotency; auto-reclaims locks on process termination.
  - *Trade-off*: Requires database index integrity verification (`autoIndex: false` in production).

---

### ADR-004: Zero-Login Magic Link Parent Portal
- **Status**: `ACCEPTED`
- **Context**: Parents in coaching classes frequently ignore portals that require mobile application downloads or password registration.
- **Decision**: Provide parents with a lightweight web URL (`/parent/[studentId]`) dispatched over WhatsApp.
- **Consequences**:
  - *Positive*: Near 100% adoption; frictionless one-tap payment via UPI deep links.
  - *Trade-off*: PII contact numbers must be masked to prevent exposure (`SEC-PRIV-03`).

---

## 4. ADR Template (For Future Decisions)

When proposing a new architectural choice, create a record using this structure:

```markdown
### ADR-XXX: [Title]
- **Status**: [PROPOSED | ACCEPTED | REJECTED | DEPRECATED | SUPERSEDED]
- **Date**: [YYYY-MM-DD]
- **Context**: What is the problem, business requirement, or constraint?
- **Decision**: What architectural change or technology is being adopted?
- **Consequences**:
  - *Positive*: Benefits and improvements.
  - *Trade-offs*: Added complexity, costs, or maintenance requirements.
```
