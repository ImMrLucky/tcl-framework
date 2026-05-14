# Product Specs

This directory holds product specs that are scoped as separate feature areas (or future apps) inside the ProtectQA / TCL platform. Specs are intentionally kept apart from operational docs (architecture overviews, migration guides, implementation notes) so they can be reviewed, iterated on, and linked from outside the repo without being mixed into day-to-day documentation.

## Index

| Spec | Status | Summary |
| --- | --- | --- |
| [Agent Studio](./agent-studio.md) | Active | ProtectQA Agent Developer Platform — teams of AI agents, Kanban execution, orchestrator, BYOK + MCP, human-in-the-loop. ([implementation](../agent-studio/implementation-progress.md)) |

## Conventions

- One spec per file (`docs/specs/<feature>.md`).
- Each spec begins with a short status block: `Status`, `Owner`, `Scope`, `Working name`, and (if applicable) `Route namespace`.
- Specs describe **what** and **why** (product goal, MVP scope, architecture direction). Implementation lives in feature-specific docs (e.g. `docs/<feature>/implementation-progress.md`) once work starts.
- When a spec graduates to active development, link the implementation doc from the spec's status block and update the index status (Draft → Active → Shipped).
