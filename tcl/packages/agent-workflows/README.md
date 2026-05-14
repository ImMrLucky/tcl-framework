# `agent-workflows`

Workflow primitives for **Agent Studio** — the state-machine contract that
describes how a Kanban board moves work between columns and what review gates
fire on transitions.

The canonical workflow JSON ships in
[`packages/agent-core/templates/workflows.json`](../agent-core/templates/workflows.json);
this package's job is to (a) describe the runtime shape of an active
workflow, and (b) provide a tiny state-machine helper to evaluate transitions.

> **Status:** MVP scaffold. Includes `evaluateTransition` for the basic
> "can this card move to this column?" check. Full workflow execution is the
> next iteration.

See [`docs/specs/agent-studio.md`](../../docs/specs/agent-studio.md).
