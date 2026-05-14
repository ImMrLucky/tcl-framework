# `agent-integrations`

Integration adapter contracts for **Agent Studio**.

External issue trackers (Jira, Azure DevOps, GitHub Issues, GitLab Issues,
Linear) plug in here. The MVP only stores connection rows + non-secret config;
real bidirectional sync is intentionally deferred per spec §3 ("Do Not Build
Yet").

This package owns the `IntegrationAdapter` interface so a connector can be
written once and consumed identically by the orchestrator and the UI.

> **Status:** MVP scaffold. Adapter implementations live in
> `packages/tcl-core/src/server/agent-studio/integrations.ts` and currently
> no-op (CRUD only).

See [`docs/specs/agent-studio.md`](../../docs/specs/agent-studio.md).
