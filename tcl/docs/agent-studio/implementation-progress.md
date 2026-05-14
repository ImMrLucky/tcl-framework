# Agent Studio — Implementation Progress

> Operational tracker for the [Agent Studio spec](../specs/agent-studio.md). The spec is "what / why"; this doc is "how / where / status".

## Status legend

- `[ ]` not started
- `[~]` in progress
- `[x]` done
- `[!]` blocked / needs decision

---

## Resolved kickoff decisions

| Topic | Decision |
| --- | --- |
| Tenancy | Reuse existing TCL `organizations` / `projects` / `org_members` / RBAC model. All Agent Studio rows are scoped by `org_id`. |
| BYOK key storage | App-level AES-256-GCM encryption via `packages/tcl-core/src/server/agent-studio/crypto.ts`, keyed by `AGENT_STUDIO_ENC_KEY`. Never plain JSON. |
| IDE component | Monaco editor + first-party panels (file tree, terminal, output, problems). No code-server / coder integration in MVP. |
| Plan tier / billing | Agent Studio ships with the app for authenticated users; org-level billing split is a future concern. |
| Audit log | Dedicated `agent_studio_audit_logs` table — independent from TCL `audit_logs`, so we can evolve event shape freely. |
| Pause controls | First-class fields on `agent_studio_orgs` (global), `agent_studio_teams`, and `agent_studio_agents`: `paused_at`, `paused_by`, `pause_reason`. Enforced by orchestrator gateway, not just UI. |

---

## MVP "Must Have" tracker

### Data model (Supabase)

- [x] Migration `045_agent_studio.sql` covering all MVP tables + RLS scoped by `org_id` (see `supabase/sql/045_agent_studio.sql`).
- [x] Migration `046_agent_studio_entitlements.sql` — (historical) added `agentStudio` to `org_entitlements.features`; **product no longer gates Agent Studio on this flag** — API uses auth + RBAC only.

### Backend (`packages/tcl-core/src/server/agent-studio/`)

- [x] `crypto.ts` — AES-256-GCM helpers for BYOK fields.
- [x] `routes.ts` — Express router wiring (registered from `express.ts`).
- [x] Teams CRUD (`/api/agent-studio/teams`).
- [x] Agents CRUD (`/api/agent-studio/teams/:teamId/agents`).
- [x] Agent config editor (`/api/agent-studio/agents/:id/config`).
- [x] Kanban board (`/api/agent-studio/teams/:teamId/board`).
- [x] Tasks / cards CRUD + agent assignment (`/api/agent-studio/tasks`).
- [x] Review gates (`/api/agent-studio/review-gates`).
- [x] Shared team context + agent context (`/api/agent-studio/contexts`).
- [x] Mistake / rule registry (`/api/agent-studio/mistakes`).
- [x] BYOK provider keys (`/api/agent-studio/provider-keys`) — encrypted at rest.
- [x] Model routing config (`/api/agent-studio/model-routing`).
- [x] MCP server config (`/api/agent-studio/mcp-servers`) including `PATCH /api/agent-studio/mcp-servers/:id`.
- [x] Integration config (Jira / Azure / etc.) (`/api/agent-studio/integrations`).
- [x] Pause controls (global / team / agent).
- [x] Templates (role + workflow) loader.
- [x] Audit log writer (separate `agent_studio_audit_logs`).
- [x] Pause-aware model dispatch (`POST /api/agent-studio/dispatch`) — BYOK + model routing; providers: OpenAI, Anthropic, Groq, Azure OpenAI metadata, Ollama, custom OpenAI-compatible base URL.
- [x] Integration connectivity ping (`POST /api/agent-studio/integrations/:id/ping`) — Jira + Azure DevOps.

### Modular packages (architecture stubs — logic TBD)

These are intentionally minimal — package.json + README + a single `src/index.ts` exporting the public types. They are imported by `tcl-core`'s `agent-studio` server module so the boundaries exist now.

- [x] `packages/agent-core` — base types, role catalogue, workflow catalogue, template loader.
- [x] `packages/agent-context` — context store contracts + in-memory adapter.
- [x] `packages/agent-orchestrator` — orchestrator gateway interface (pause, schedule).
- [x] `packages/agent-workflows` — workflow templates + state machine contract.
- [x] `packages/agent-integrations` — integration adapter contracts (Jira / Azure DevOps).
- [x] `packages/agent-mcp` — MCP server descriptor + client contract.
- [x] `packages/agent-model-router` — provider + routing rule contracts.

### Seeded templates

- [x] Role templates JSON (`packages/agent-core/templates/roles.json`).
- [x] Workflow templates JSON (`packages/agent-core/templates/workflows.json`).

### Frontend (`packages/tcl-ui/src/app/agent-studio/`)

- [x] Lazy-loaded module + 10 sub-routes scaffolded.
- [x] Studio dashboard / overview.
- [x] Teams list + team detail shell.
- [x] Kanban board placeholder.
- [x] Agents list + agent config editor placeholder.
- [x] Shared context panel placeholder.
- [x] Rules / mistake registry placeholder.
- [x] IDE shell — Monaco Editor loaded via AMD `loader.js` from jsDelivr (avoids bundling `.ttf` / ESM issues) + file tree / terminal / output / problems panels; terminal `dispatch` calls the dispatch API.
- [x] Templates / Settings placeholders.
- [x] Integrations list + create form + **Test connection** (Jira / Azure DevOps) via `pingIntegration`.
- [x] Nav entry visible to all signed-in users (same as other primary nav items).

### Backend wiring

- [x] `setupAgentStudioRoutes(app)` registered in `packages/tcl-core/src/server/express.ts`.
- [x] Agent Studio routes require session + org context; no separate product entitlement flag.

---

## Deferred (per spec §3 "Do Not Build Yet")

- Fully autonomous execution loop.
- Real cloud code execution.
- Full Jira / Azure sync (only adapter contract + connection rows for now).
- Full browser-based VS Code clone (Monaco + first-party panels only).
- Multi-repo Git integration.
- Agent billing.
- Marketplace.

Architecture hooks exist (`packages/agent-integrations`, IDE panels, `provider-keys`, `model-routing`) but the heavy implementation is intentionally TBD.

---

## Generic platform & agent files (migration 050)

- [x] `050_agent_studio_agent_files_and_template_packs.sql` — `agent_studio_template_packs`, `agent_studio_role_templates`, `agent_studio_persona_templates`, `agent_studio_template_assets`, `agent_studio_agent_files`, `agent_studio_agent_file_versions`; new columns on `agent_studio_agents`; seeded system packs (generic + optional BMAD pack key).
- [x] Builtin Markdown bundle: `packages/agent-core/templates/assets/generic/*.md`.
- [x] Pack descriptors: `packages/agent-core/templates/packs/*/pack.json`.
- [x] `personas.json` + `GET /api/agent-studio/templates/personas`.
- [x] `prompt-composer.ts` — composes system prompt from active agent files + task/context/mistakes; `dispatch.ts` sends system + user to providers.
- [x] Routes in `agent-studio-template-file-routes.ts` (template packs, roles/personas merge listing, template assets, agent files CRUD subset, prompt preview).

---

## Next iterations

1. Replace placeholder logic in `packages/agent-orchestrator` with a real BullMQ-style queue + pause gateway.
2. Tighten `packages/agent-model-router` integration with dispatch (shared types + tests; HTTP path already calls providers with BYOK).
3. Hook MCP client to real MCP server connections (currently descriptors only).
4. Build out Kanban + IDE panels (tasks → branches → review gates flow).
5. Add Jira / Azure DevOps adapters in `packages/agent-integrations`.
