# Big Buck Research

This folder captures the working research for Big Buck.

## Decisions at a glance

- **Direction:** build a clean-room, modern ATS rather than forking a copyleft-heavy codebase.
- **Reference stack:** Reqcore for product/architecture patterns, YAWIK and OpenCATS for ATS workflow shape, FreeATS for deployment ergonomics.
- **License posture:** prefer permissive or weak-copyleft inspiration only; avoid copying from no-license repositories.
- **API style:** use **REST as the primary external API**. Add GraphQL only later if a specific read-heavy UI slice needs it.
- **CLI:** first-class, thin client over the same domain services as the web app.
- **Agents:** expose a controlled MCP/tool surface, not raw database access.

## Research map

1. [Landscape](./01-landscape.md)
2. [License and forkability](./02-license-analysis.md)
3. [Product and architecture](./03-product-and-architecture.md)
4. [CLI build plan](./04-cli-strategy.md)
5. [Agentic integrations](./05-agentic-integrations.md)
6. [API strategy](./06-api-strategy.md)
7. [References](./REFERENCES.md)

## Practical outcome

The safest path is:

1. study the ATS domain models from existing OSS projects,
2. reimplement the product in a modern stack,
3. keep the public API simple and explicit,
4. ship CLI and agent integrations on top of the same service layer,
5. preserve an auditable change log and permission model from day one.
