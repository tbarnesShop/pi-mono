# 05 — Agentic Integrations

## Goal

Define how AI agents should interact with Big Buck without compromising security, auditability, or human control.

## Core principle

Agents should not get raw database access. They should get **narrow tools** with explicit permission boundaries.

## Recommended integration model

### 1) MCP server for tool access
Expose a Model Context Protocol server that offers safe, named tools such as:

- `listJobs`
- `getJob`
- `searchCandidates`
- `getCandidate`
- `listApplications`
- `scoreResume`
- `summarizeCandidate`
- `draftOutreach`
- `generateInterviewQuestions`
- `createNoteDraft`
- `createCandidateDraft`
- `suggestNextStage`

### 2) Event-driven backend
Emit domain events for important changes:

- candidate created
- application created
- stage changed
- resume parsed
- score generated
- outreach drafted
- interview scheduled

These events can drive notifications, automations, and agent follow-up tasks.

### 3) Human approval for sensitive actions
Never auto-execute high-impact actions without review.

Examples:
- sending email
- advancing pipeline stage
- rejecting a candidate
- changing compensation assumptions
- generating an external integration side effect

## Agent capabilities that are worth building

### Low-risk, high-value
- resume parsing
- job description summarization
- candidate summarization
- match explanation generation
- interview question suggestions
- note summarization
- duplicate detection

### Medium-risk
- outreach drafting
- pipeline triage suggestions
- shortlist suggestions
- application form autofill suggestions

### High-risk
- automatic stage movement
- automatic rejection
- automatic candidate ranking without explanation
- sending external messages

## Guardrails

### Every tool must have
- scoped permissions
- audit logs
- idempotency where relevant
- input validation
- output truncation or redaction rules for PII

### Every AI result must have
- source data reference
- confidence or rationale
- versioning of model/prompt where practical

## Why this matters

Recruiting data is sensitive. Agent features become dangerous quickly if they are built as opaque automation. Big Buck needs to make AI useful without making it invisible.

## Integration surface beyond MCP

### Webhooks
Good for external automation and SaaS integration.

### Internal job queue
Good for background enrichment and asynchronous agent tasks.

### CLI assisted flows
Good for local admin operations and power users.

## Reference point from the research

The `agentic-recruitment-protocol` repo surfaced in discovery, which is useful as a signal that the ecosystem is moving toward agent-aware recruiting workflows. Big Buck should be compatible with that direction without copying an immature protocol shape blindly.

## Decision

Use MCP for agent tooling, use events for workflow automation, and keep human approval on all sensitive actions.

## Build plan

1. define a small, stable tool catalog
2. implement read-only tools first
3. add draft-only write tools
4. add approved write tools later
5. attach audit logs and permission scopes to every tool call
