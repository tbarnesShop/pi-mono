# 04 — CLI Strategy

## Goal

Define a CLI that can operate the ATS without forcing users through the web UI for everything.

## CLI principles

1. **Thin client** — the CLI should call the same services as the web app.
2. **Scriptable** — every command should support JSON output.
3. **Safe by default** — destructive actions require confirmation or explicit flags.
4. **Composable** — commands should pipe cleanly in shell workflows.
5. **Auth-aware** — the CLI should work with API tokens, org context, and profiles.

## What the CLI should do

### Bootstrap and operations
- `bigbuck init`
- `bigbuck doctor`
- `bigbuck config`
- `bigbuck login`
- `bigbuck logout`
- `bigbuck whoami`

### Core ATS actions
- `bigbuck job create`
- `bigbuck job list`
- `bigbuck job show <id>`
- `bigbuck candidate add`
- `bigbuck candidate list`
- `bigbuck candidate show <id>`
- `bigbuck application add`
- `bigbuck pipeline move`
- `bigbuck note add`
- `bigbuck interview schedule`

### Data import/export
- `bigbuck import csv`
- `bigbuck import greenhouse`
- `bigbuck import lever`
- `bigbuck import workday`
- `bigbuck export csv`
- `bigbuck export json`

### AI helpers
- `bigbuck ai parse-resume`
- `bigbuck ai rank`
- `bigbuck ai summarize`
- `bigbuck ai draft-outreach`

### Developer and admin helpers
- `bigbuck mcp serve`
- `bigbuck webhook test`
- `bigbuck token create`
- `bigbuck role grant`
- `bigbuck audit tail`

## UX details

### Output modes
- human-readable table output by default
- `--json` for machine-readable output
- `--yaml` only if there is a clear use case

### Filtering and paging
- standard `--limit`, `--cursor`, `--org`, `--status` options
- predictable column names
- stable IDs

### Config
- store config under the user's config directory
- support named profiles
- support org defaults
- support env overrides for automation

## Implementation strategy

### Layering
- **CLI transport layer**: auth, request/response handling, formatting
- **Command layer**: argument parsing and validation
- **Domain client**: typed wrappers around the core API

### Do not duplicate business logic
The CLI should not reimplement pipeline rules, permissions, or validation. Those belong to the server.

### Error handling
- clear HTTP failure output
- exit codes for scripts
- optional verbose mode with trace IDs

## Why CLI matters here

ATS work includes a lot of operational tasks:

- importing data
- fixing bad records
- running bulk transitions
- rechecking candidate matches
- generating exports
- running migrations and integration checks

The CLI makes these repeatable and automatable.

## Build plan

1. define the API first
2. expose the core domain methods through a typed client
3. build the CLI on top
4. add shell completions
5. add import/export workflows
6. add AI and MCP commands last

## Decision

The CLI should be a first-class product surface, but it must remain a thin wrapper over the same server-side domain services.
