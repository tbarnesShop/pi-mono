# 03 — Product and Architecture Direction

## Goal

Choose a direction for Big Buck that is technically sound, legally safe, and easy to extend with CLI and agentic workflows.

## Product direction

Big Buck should be a **developer-first ATS** with these properties:

- self-hostable
- auditable
- API-first
- local-AI friendly
- multi-tenant or org-aware from day one
- simple enough for small teams, extensible enough for scale-ups

## What the research says

### Reqcore is the best modern product blueprint
Reqcore shows the strongest current shape for a modern ATS:

- jobs
- candidate pipeline
- applications
- documents
- public job board
- explainable AI roadmap
- local-first infrastructure

That makes it the best reference for product scope and module boundaries.

### OpenCATS is the best workflow blueprint
OpenCATS is the strongest classic ATS workflow reference:

- job posting
- candidate submission
- recruiter processing
- selection and submission lifecycle

That makes it the best reference for the actual recruiting process.

### YAWIK and FreeATS are the best low-friction references
They help define the shape of a lighter ATS with simpler deployment and a smaller operational surface.

## Recommended architecture

### Core stack
- **Backend:** TypeScript
- **Database:** PostgreSQL
- **File storage:** S3-compatible storage, ideally MinIO for self-hosting
- **Search:** Postgres full-text search first, external search engine later if needed
- **Queue / async work:** a durable job queue for parsing, enrichment, notifications, and imports
- **Auth:** org-aware auth with RBAC and audit trails
- **AI layer:** optional and local-first, with Ollama support where possible

### Data model
Start with a narrow, high-signal domain:

- organizations
- users
- roles / memberships
- jobs
- candidates
- applications
- pipeline stages
- notes
- interviews
- documents
- activities / audit log
- integrations
- tasks / automations

### Domain rules
- everything important is tied to an organization
- every state transition is explicit and logged
- every AI output is traceable back to input data
- every external side effect is permissioned and reviewable

## Why this direction

### 1) It matches the ATS domain
ATS software is workflow-heavy, not algorithm-heavy. The product needs clear entities and transitions more than exotic infrastructure.

### 2) It keeps the codebase maintainable
A clean TypeScript backend with Postgres and object storage is easy to reason about and easy to automate.

### 3) It supports the CLI and agent layers cleanly
A single domain service layer can be consumed by:

- web UI
- CLI
- MCP server
- integration webhooks
- background jobs

### 4) It supports local AI without forcing it
AI should be optional and additive, not mandatory for core ATS functionality.

## Feature sequencing

### Phase 1
- orgs / users / roles
- jobs
- candidates
- applications
- notes
- pipeline stages
- document upload
- audit log
- import/export

### Phase 2
- resume parsing
- candidate ranking
- job matching
- job board polish
- notification automation

### Phase 3
- interview scheduling
- collaboration features
- AI assist features
- deeper integrations
- marketplace / extensions

## Product decisions

### Keep it focused
Big Buck should stay ATS-first. Do not turn it into a generic HR suite on day one.

### Keep AI explainable
If a score or recommendation exists, the user must be able to inspect the reasons.

### Keep external integrations explicit
Don't hide integrations behind magic. Model them as first-class objects with permissions and logs.

## Build implication

The architecture should be a modular monolith first. That keeps complexity manageable while preserving a clean internal boundary for later extraction if scale demands it.
