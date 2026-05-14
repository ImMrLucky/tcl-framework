# `agent-core`

Foundation package for **Agent Studio** (ProtectQA Agent Developer Platform).

Holds the stable contracts that every other `agent-*` package depends on:

- Base entity types: `Team`, `Agent`, `AgentConfig`, `Task`, `ReviewGate`, `Mistake`, `Context`.
- Role catalogue (`RoleTemplate[]`) — Agent Manager, Senior Software Engineer, QA Engineer, ...
- Workflow catalogue (`WorkflowTemplate[]`) — Generic Software Delivery, BMAD Workflow Pack paths, Bug Fix Flow, Research → Spec → Build → Review, ...
- Template loader helpers (`loadRoleTemplates`, `loadWorkflowTemplates`).

> **Status:** MVP scaffold. Types are real; behaviour helpers are intentionally
> minimal. Production logic lives in `packages/tcl-core/src/server/agent-studio/`
> for the MVP and will be migrated here as the boundaries firm up.

See [`docs/specs/agent-studio.md`](../../docs/specs/agent-studio.md) for the
full product spec.
