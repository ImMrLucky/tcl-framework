# `agent-orchestrator`

Orchestrator gateway for **Agent Studio**.

The orchestrator gateway is the single choke point that:

- Honours `paused_at` on Org / Team / Agent rows (returns `PAUSED` instead of dispatching).
- Reads model routing + provider keys before dispatching to a model.
- Records dispatch and completion to the Agent Studio audit log.
- Surfaces review gates as deliberate "wait" states.

> **Status:** MVP scaffold. Ships a `NoopOrchestratorGateway` that records
> dispatch intent only. The real BullMQ-backed gateway is the next iteration.

See [`docs/specs/agent-studio.md`](../../docs/specs/agent-studio.md).
