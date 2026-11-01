# TuitionDesk Documentation Index & Navigation Guide

*Last Reviewed: November 2026*
*Status: Living Documentation System*

Welcome to the **TuitionDesk Documentation System**. This directory houses the authoritative architectural specifications, product requirements, API references, security registries, and operational guides for the entire platform.

---

## 1. Documentation Index

| File | Title | Summary / Purpose |
| :--- | :--- | :--- |
| [00-PROJECT-OVERVIEW.md](./00-PROJECT-OVERVIEW.md) | **Project Overview** | Product vision, target users, business problems solved, core capabilities, and known limitations. |
| [01-PRODUCT-REQUIREMENTS.md](./01-PRODUCT-REQUIREMENTS.md) | **Product Requirements (PRD)** | Detailed module requirements distinguishing observed functionality, inferred rules, and proposed features. |
| [02-SYSTEM-ARCHITECTURE.md](./02-SYSTEM-ARCHITECTURE.md) | **System Architecture** | End-to-end system topology, communication protocols, and 7 Mermaid sequence and data flow diagrams. |
| [03-FRONTEND-ARCHITECTURE.md](./03-FRONTEND-ARCHITECTURE.md) | **Frontend Architecture** | App routing, components, state management, hooks, styling tokens, and client API communication. |
| [04-BACKEND-ARCHITECTURE.md](./04-BACKEND-ARCHITECTURE.md) | **Backend Architecture** | Route handler organization, service layer, data validation, error handling, and business workflows. |
| [05-DATABASE-ARCHITECTURE.md](./05-DATABASE-ARCHITECTURE.md) | **Database Architecture** | MongoDB collections, Mongoose schemas, field types, tenant isolation, and Atlas indexes. |
| [06-API-REFERENCE.md](./06-API-REFERENCE.md) | **API Reference** | Complete endpoint inventory with HTTP methods, paths, auth requirements, payloads, responses, and errors. |
| [07-AUTHENTICATION-AND-MULTITENANCY.md](./07-AUTHENTICATION-AND-MULTITENANCY.md) | **Auth & Multi-Tenancy** | Center onboarding, JWT cookie sessions, tenant scoping boundaries, and parent portal access. |
| [08-WHATSAPP-INTEGRATION.md](./08-WHATSAPP-INTEGRATION.md) | **WhatsApp Microservice** | Baileys engine, QR pairing lifecycle, session recovery, message status machine, and simulation guard. |
| [09-EXTERNAL-INTEGRATIONS.md](./09-EXTERNAL-INTEGRATIONS.md) | **External Integrations** | Payment gateways (YouPI, Cashfree, UPI), Baileys engine, and external service contracts. |
| [10-DEPLOYMENT-AND-ENVIRONMENT.md](./10-DEPLOYMENT-AND-ENVIRONMENT.md) | **Deployment & Environment** | Hosting topology (Vercel & Render), port mappings, build commands, and environment variable registries. |
| [11-FEATURE-INVENTORY.md](./11-FEATURE-INVENTORY.md) | **Feature Inventory** | Comprehensive feature matrix classifying every capability as COMPLETE, PARTIAL, BROKEN, or UNVERIFIED. |
| [12-SECURITY-AUDIT.md](./12-SECURITY-AUDIT.md) | **Security Audit Registry** | Vulnerability registry (SEC-BOLA-01 to SEC-CONF-06) with severity, behavior, evidence, and remediation paths. |
| [13-KNOWN-ISSUES-AND-TECHNICAL-DEBT.md](./13-KNOWN-ISSUES-AND-TECHNICAL-DEBT.md) | **Known Issues & Technical Debt** | Registry of confirmed bugs, architectural inconsistencies, duplicate code, and production gaps. |
| [14-TESTING-STRATEGY.md](./14-TESTING-STRATEGY.md) | **Testing Strategy** | Test suites catalog, unit/integration/contract test coverage, what tests prove vs. gaps. |
| [15-DEVELOPMENT-ROADMAP.md](./15-DEVELOPMENT-ROADMAP.md) | **Development Roadmap** | Prioritized action plan from P0 (Critical Security & Data Integrity) through P4 (New Features). |
| [16-CHANGELOG.md](./16-CHANGELOG.md) | **Changelog** | Reverse-chronological record of code changes, patches, and versioned releases. |
| [staging-isolation-guide.md](./staging-isolation-guide.md) | **Staging Isolation Guide** | MongoDB Atlas user scoping, secret separation, and simulation safety for staging environments. |
| [decisions/README.md](./decisions/README.md) | **Architecture Decision Records** | Directory of formal ADRs detailing context, options considered, and decisions made. |

---

## 2. Reading Paths by Role

### For AI Coding Agents
1. [`AGENTS.md`](../AGENTS.md) *(Mandatory First Step)*
2. [`02-SYSTEM-ARCHITECTURE.md`](./02-SYSTEM-ARCHITECTURE.md)
3. Module-specific document (e.g. [`08-WHATSAPP-INTEGRATION.md`](./08-WHATSAPP-INTEGRATION.md) or [`04-BACKEND-ARCHITECTURE.md`](./04-BACKEND-ARCHITECTURE.md))
4. [`12-SECURITY-AUDIT.md`](./12-SECURITY-AUDIT.md) (Check before modifying data/auth routes)

### For Backend / Full-Stack Engineers
1. [`00-PROJECT-OVERVIEW.md`](./00-PROJECT-OVERVIEW.md)
2. [`04-BACKEND-ARCHITECTURE.md`](./04-BACKEND-ARCHITECTURE.md) & [`05-DATABASE-ARCHITECTURE.md`](./05-DATABASE-ARCHITECTURE.md)
3. [`06-API-REFERENCE.md`](./06-API-REFERENCE.md)
4. [`07-AUTHENTICATION-AND-MULTITENANCY.md`](./07-AUTHENTICATION-AND-MULTITENANCY.md)

### For Security Auditors & Penetration Testers
1. [`12-SECURITY-AUDIT.md`](./12-SECURITY-AUDIT.md)
2. [`07-AUTHENTICATION-AND-MULTITENANCY.md`](./07-AUTHENTICATION-AND-MULTITENANCY.md)
3. [`staging-isolation-guide.md`](./staging-isolation-guide.md)

---

## 3. Evidence Classification Standards

Every statement across this documentation library adheres to the following evidence taxonomy:

- **`[CONFIRMED]`**: Supported by inspected, active source code or configuration files in the repository.
- **`[TESTED]`**: Directly validated by an automated unit, integration, or contract test in `test/`.
- **`[UNVERIFIED]`**: Identified during architecture audits or code reviews, but not yet validated under real runtime execution.
- **`[INFERRED]`**: Derived from logical interpretation of existing code patterns, but without explicit declaration.
- **`[PROPOSED]`**: Planned future behavior or architectural recommendation not yet present in source code.
