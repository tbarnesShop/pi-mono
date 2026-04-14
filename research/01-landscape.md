# 01 — OSS ATS Landscape

## Goal

Identify the best open-source applicant tracking systems and adjacent projects for Big Buck, then decide what each one is useful for.

## Shortlist

### 1) Reqcore
- **Repo:** https://github.com/reqcore-inc/reqcore
- **License:** AGPL-3.0
- **Status:** active, modern, product-shaped
- **Stack:** Nuxt 4, Vue 3, PostgreSQL, MinIO, Better Auth, Drizzle
- **What it contributes:**
  - clean ATS domain modeling
  - job pipeline / kanban workflow
  - org isolation and auth
  - candidate/document management
  - roadmap for resume parsing and explainable AI ranking

**Assessment:** best product reference for a modern ATS. Not the best source for permissive code reuse, but the best source for architecture and product direction.

### 2) YAWIK
- **Repo:** https://github.com/cross-solution/YAWIK
- **License:** MIT
- **Status:** older, but clearly in the ATS domain
- **What it contributes:**
  - ATS + job board combined pattern
  - job ads, application forms, recruiter/applicant interaction
  - module-based integration approach

**Assessment:** strongest permissive ATS reference. Good source for workflows and domain vocabulary.

### 3) OpenCATS
- **Repo:** https://github.com/opencats/OpenCATS
- **License:** repo states OpenCATS code is under MPL 2.0 and legacy CATS code under modified MPL terms
- **Status:** mature classic ATS
- **What it contributes:**
  - real recruiter workflow
  - traditional ATS lifecycle: job posting -> candidate application -> selection -> submission
  - long-running project with mature domain behavior

**Assessment:** best classic ATS domain reference, especially for workflow completeness.

### 4) FreeATS
- **Repo:** https://github.com/freeats/freeats
- **License:** MIT
- **Status:** active enough to study, simple deployment story
- **What it contributes:**
  - self-hosted onboarding
  - Docker-based operations
  - straightforward app shape

**Assessment:** useful for ergonomics, self-hosting, and a lean product surface.

### 5) SpotAxis
- **Repo:** https://github.com/Assystant/SpotAxis
- **License:** MIT
- **Status:** lighter-weight
- **What it contributes:**
  - another open ATS code shape
  - likely useful for simple CRUD and UI patterns

**Assessment:** secondary reference only.

## Broader platform references

### Ever Gauzy
- **Repo:** https://github.com/ever-co/ever-gauzy
- **License:** AGPL-3.0
- **Use case:** ATS inside a broader business platform
- **What it contributes:**
  - organization model
  - broader HR and workflow surface
  - multi-module product structure

**Assessment:** useful if Big Buck expands beyond ATS. Not the first repo to copy for a focused product.

### Frappe HRMS
- **Repo:** https://github.com/frappe/hrms
- **License:** GPL-3.0
- **Use case:** HR suite with recruitment modules
- **What it contributes:**
  - enterprise HR workflows
  - recruitment within a broader talent management suite

**Assessment:** useful for feature breadth, not ideal for code reuse if Big Buck is meant to stay lightweight.

## What not to use as a source

### openats
- **Repo:** https://github.com/lukegalea/openats
- **Problem:** no visible license file
- **Decision:** do not copy code

## Landscape conclusions

1. **Reqcore** is the best modern design reference.
2. **YAWIK** is the best permissive ATS reference.
3. **OpenCATS** is the best classic ATS workflow reference.
4. **FreeATS** is useful for simplicity and self-hosting ergonomics.
5. **Gauzy** and **Frappe HRMS** are feature-broad references, not the core codebase target.
6. **openats** is out because licensing is unclear.

## Build implication

Big Buck should not be a legacy fork. It should be a clean-room implementation that borrows workflow ideas and product shape from the repositories above.
