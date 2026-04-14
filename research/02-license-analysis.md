# 02 — License and Forkability Analysis

## Goal

Decide what can be legally copied, what can only be used as inspiration, and what must be excluded.

## License classes and what they mean

### MIT / Apache-2.0
- Safe for copying, modifying, and redistributing.
- Can be used in proprietary or open-source work.
- Best for clean reuse of individual ideas, UI patterns, and utility code.

### MPL 2.0
- File-level copyleft.
- Modified files stay under MPL.
- Can coexist inside a larger proprietary or permissively licensed project if boundaries are respected.
- Good when you want to reuse a limited set of files but keep the rest of the product separate.

### GPL / AGPL
- Strong copyleft.
- Derivative works and distributed modifications trigger source obligations.
- AGPL extends this pressure to network use.
- Fine if Big Buck is intentionally open source under copyleft, but risky if the business model needs proprietary distribution.

### No license
- No safe copying.
- Treat as all rights reserved unless explicit permission is granted.

## Repository-by-repository analysis

### Safe / usable references

#### YAWIK
- **License:** MIT
- **Conclusion:** legally forkable and reusable.
- **Best use:** inspiration for ATS workflows, job board behavior, and recruiter/applicant interactions.

#### FreeATS
- **License:** MIT
- **Conclusion:** legally forkable and reusable.
- **Best use:** self-hosting ergonomics, deployment shape, and simple ATS product structure.

#### SpotAxis
- **License:** MIT
- **Conclusion:** legally forkable and reusable.
- **Best use:** light reference for ATS UI and basic CRUD surface.

#### OpenCATS
- **License:** MPL 2.0 for OpenCATS code, legacy CATS code under modified MPL terms
- **Conclusion:** legally reusable, but with file-level obligations and historical-license awareness.
- **Best use:** classic ATS workflows and data model patterns.

### Copyleft references

#### Reqcore
- **License:** AGPL-3.0
- **Conclusion:** excellent reference, but not a fit if Big Buck wants permissive or closed distribution.
- **Best use:** architecture and roadmap inspiration only, unless Big Buck is deliberately AGPL.

#### Ever Gauzy
- **License:** AGPL-3.0
- **Conclusion:** same as above.
- **Best use:** broad platform pattern reference.

#### Frappe HRMS
- **License:** GPL-3.0
- **Conclusion:** same caution as AGPL, with slightly different distribution implications.
- **Best use:** feature reference for recruitment and HR workflows.

### Excluded

#### openats
- **License:** none visible
- **Conclusion:** exclude from code reuse.

## Practical legal decision

Big Buck should use this policy:

1. **Copy code only from MIT/Apache/MPL sources when needed and confirmed.**
2. **Do not copy code from AGPL/GPL repos unless the whole project is intentionally licensed that way.**
3. **Do not copy code from no-license repositories.**
4. **Prefer clean-room reimplementation over direct forking unless a specific repo becomes the chosen base.**

## Recommended reuse posture

### Use as direct codebase input
- YAWIK (MIT)
- FreeATS (MIT)
- SpotAxis (MIT)
- OpenCATS selectively, with license review of the exact files you want to reuse

### Use as architectural/product input only
- Reqcore
- Ever Gauzy
- Frappe HRMS

### Do not use as source code input
- openats

## Decision

The safest direction is a clean-room Big Buck implementation with selective MIT/MPL inspiration and no dependence on AGPL/GPL code paths.

## Build implication

The legal plan and the product plan align: a clean-room implementation avoids future license surprises and keeps Big Buck free to choose its own distribution model.
