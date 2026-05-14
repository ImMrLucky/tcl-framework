# Cursor Spec: ProtectQA Agent Developer Platform

> **Status:** Active (MVP scaffolding in progress)
> **Owner:** Product
> **Scope:** ProtectQA feature area (not a separate app), but treated as its own product for billing/plan-tier purposes
> **Working name:** Agent Studio
> **Route namespace:** `/agent-studio`
> **Implementation doc:** [docs/agent-studio/implementation-progress.md](../agent-studio/implementation-progress.md)
>
> **Resolved decisions (from kickoff):**
> - **Tenancy:** reuse existing TCL Org / Project / RBAC model (no separate tenancy).
> - **BYOK key storage:** app-level encrypted column (AES-256-GCM with `AGENT_STUDIO_ENC_KEY`); never plain JSON.
> - **IDE component:** Monaco editor + custom panels (file tree, terminal, output, problems) so it works like a full IDE.
> - **Plan tier:** Agent Studio is treated as its own product with its own entitlement (`agentStudio`); not bundled into existing TCL tiers.
> - **Audit log:** Agent Studio uses its own audit pipeline (`agent_studio_audit_logs`) — not the shared `audit_logs` table.

---

## 0. Product Goal

Build an Agent Developer Platform inside ProtectQA that allows users to create, configure, theme, orchestrate, pause, monitor, and collaborate with teams of AI agents.

The platform should support:

- Teams of agents
- Agent personas and role templates
- Custom agent config files
- Kanban-driven work execution
- Agent Manager / Orchestrator per team
- Human review gates
- Jira / Azure DevOps integration-ready architecture
- Spec-driven development workflows, defaulting to BMAD
- Shared team context and individual agent context
- Mistake memory and rule learning
- Multi-vendor model routing
- BYOK provider keys
- MCP support
- Pause controls at global, team, and agent levels
- Built-in open-source IDE / workspace interface
- Human-in-the-loop collaboration

This should be built as a modular ProtectQA feature area, not as a separate app yet.

---

## 1. Working Name

Feature name:

`Agent Studio`

Internal route namespace:

`/agent-studio`

Possible UI sections:

- `/agent-studio`
- `/agent-studio/teams`
- `/agent-studio/teams/:teamId`
- `/agent-studio/teams/:teamId/board`
- `/agent-studio/teams/:teamId/agents`
- `/agent-studio/teams/:teamId/context`
- `/agent-studio/teams/:teamId/rules`
- `/agent-studio/teams/:teamId/ide`
- `/agent-studio/templates`
- `/agent-studio/integrations`
- `/agent-studio/settings`

---

## 2. Core Concept

The user creates one or more teams.

Each team has:

- One Agent Manager / Orchestrator
- Multiple specialized agents
- A Kanban board
- Shared context
- Team memory
- Mistake/rule registry
- Model routing settings
- Provider key settings
- MCP tool configuration
- IDE/workspace access
- External issue tracker integrations

Each agent has:

- Persona
- Role
- Config file
- Model preference
- Capabilities
- Tools
- Context scope
- Team permissions
- Mistake memory
- Rules
- Visual theme
- Status
- Pause/resume control

---

## 3. MVP Scope

Build the foundation first.

### MVP Features

#### Must Have

1. Agent Studio navigation entry
2. Team CRUD
3. Agent CRUD within team
4. Role/persona templates
5. Agent config editor
6. Team Kanban board
7. Task/story CRUD
8. Agent assignment to Kanban cards
9. Human review status gates
10. Agent Manager placeholder service
11. Shared context store
12. Agent context store
13. Mistake/rule registry
14. Global Pause All
15. Team pause
16. Agent pause
17. BYOK provider settings data model
18. Model routing configuration model
19. MCP server/tool configuration model
20. Basic IDE panel placeholder
21. Jira/Azure integration-ready models, but not full sync yet

#### Should Have in MVP

1. Seeded role templates:
   - Agent Manager / Orchestrator
   - Business Analyst
   - Product Owner
   - UX Designer
   - Researcher
   - Data Scientist
   - Senior Software Engineer
   - Software Architect
   - QA Engineer
   - Security Reviewer
   - DevOps Engineer
   - Technical Writer

2. Seeded workflow templates:
   - BMAD Full SDLC
   - BMAD Quick Feature
   - Bug Fix Flow
   - Research → Spec → Build → Review
   - ProtectQA Product Feature Flow

3. Config files saved as JSON/YAML-like structured data.

#### Do Not Build Yet

- Fully autonomous execution loop
- Real cloud code execution
- Full Jira/Azure sync
- Full browser-based VS Code clone
- Multi-repo Git integration
- Agent billing
- Marketplace

Create architecture hooks for these, but do not overbuild them in v1.

---

## 4. Recommended Architecture

Use a modular architecture:

```txt
apps/
  protectqa-web/
    app/
      agent-studio/
    components/
      agent-studio/
    lib/
      agent-studio/
    services/
      agent-studio/

packages/
  agent-core/
  agent-context/
  agent-orchestrator/
  agent-workflows/
  agent-integrations/
  agent-mcp/
  agent-model-router/
```
