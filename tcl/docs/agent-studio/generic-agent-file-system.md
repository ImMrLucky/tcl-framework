# Agent Studio — generic agent file system

Agent Studio treats each agent as an **editable Markdown file bundle** (OpenClaw-style inspiration: file-driven configuration, not a single opaque prompt).

## Principles

- **Role** = job function (what work the agent performs). Defined by role templates (`roles.json` and optional DB rows).
- **Persona** = behavior and communication style. Defined by persona templates (`personas.json` and optional DB rows).
- **Agent files** = durable Markdown sections used during **prompt composition** and dispatch (`agent.md`, `persona.md`, `instructions.md`, …).
- **Workflow / template pack** = reusable bundle metadata (columns, recommended roles, optional BMAD-inspired paths). **BMAD Workflow Pack** is one pack; **Generic Software Delivery** is the default delivery pattern for new teams.

## Storage

- **Repository defaults:** `packages/agent-core/templates/assets/generic/*.md` — copied when an agent is created (server-side seed).
- **Per-agent rows:** `agent_studio_agent_files` + `agent_studio_agent_file_versions` (migration `050_agent_studio_agent_files_and_template_packs.sql`).
- **Dispatch:** `packages/tcl-core/src/server/agent-studio/prompt-composer.ts` loads active files, then task, team context, and mistakes, then the user message.

## Editing

Use the API (`PATCH /api/agent-studio/agents/:agentId/files/:fileId`) or future IDE panels. Each save should append a row to `agent_studio_agent_file_versions`.

## BMAD

BMAD content lives only inside the **BMAD Workflow Pack** and related JSON workflow keys (`bmad_full_sdlc`, `bmad_quick_feature`). It is **not** the implicit operating mode of Agent Studio.
