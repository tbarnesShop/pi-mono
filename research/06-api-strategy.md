# 06 — API Strategy

## Question

For Big Buck, is GraphQL better than REST for API calls?

## Short answer

**No, not as the primary API.**

Use **REST as the default public and internal application API**. Add GraphQL later only if a specific front-end area truly needs it.

## Why REST is the right default

### 1) ATS is command-heavy
ATS software is mostly about explicit actions:

- create job
- add candidate
- attach resume
- move stage
- add note
- schedule interview
- approve outreach

REST maps naturally to these resource and action endpoints.

### 2) CLI and agent tooling prefer explicit endpoints
A CLI and MCP tools are easier to implement when the server exposes stable, predictable endpoints with clear verbs and payloads.

### 3) File upload and webhook flows are simpler
ATS systems deal with:

- resume uploads
- attachments
- document downloads
- webhook callbacks
- integration tokens

These are easier to reason about with REST.

### 4) Caching and observability are simpler
REST is easier to cache, log, debug, and rate limit in standard infrastructure.

### 5) Security is easier to keep understandable
REST makes permission checks explicit at the endpoint level. That is valuable when candidate data and hiring actions are sensitive.

## Where GraphQL helps

GraphQL is useful when:

- a page needs many related entities in one view
- the UI has a lot of nested relationships
- you want to minimize round trips for a very rich screen

Examples:
- recruiter dashboard
- candidate detail page
- complex job analytics view

## Why GraphQL should not be the starting point

### 1) More authorization complexity
Field-level permissions are harder to get right.

### 2) More operational complexity
Query cost, N+1 behavior, caching strategy, and rate limiting all require extra work.

### 3) More schema design overhead
You have to design a stable graph before you know which screens need it.

### 4) Worse fit for command-style workflows
Creating records and moving workflow states is more naturally expressed as REST endpoints or explicit actions.

## Recommended API shape

### Public application API
- REST JSON
- explicit resources
- stable versioning
- idempotent writes where possible
- consistent error format

### Internal service boundaries
- same domain services behind the API
- no duplicated logic in CLI or agent layers

### Optional future GraphQL
- only if the UI proves a real need
- ideally as a read model or BFF layer, not the only API

## Suggested REST resource map

- `GET /orgs`
- `GET /orgs/:orgId/jobs`
- `POST /orgs/:orgId/jobs`
- `GET /jobs/:jobId`
- `PATCH /jobs/:jobId`
- `POST /jobs/:jobId/publish`
- `GET /candidates`
- `POST /candidates`
- `GET /candidates/:candidateId`
- `POST /candidates/:candidateId/documents`
- `POST /applications`
- `PATCH /applications/:applicationId/stage`
- `POST /applications/:applicationId/notes`
- `POST /interviews`
- `POST /ai/score-resume`
- `POST /ai/summarize-candidate`

## Decision

REST should be the primary API contract. GraphQL is a possible later optimization, not the foundation.

## Build plan

1. define REST resources and domain actions first
2. keep responses consistent and typed
3. add CLI and MCP on top of the REST layer
4. revisit GraphQL only after the UI proves a real aggregation problem
