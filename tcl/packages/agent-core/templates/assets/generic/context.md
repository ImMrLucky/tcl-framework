# Agent Context File

Long-lived, **agent-private** context for **{{agentName}}** (`{{roleName}}`). Content here is composed into dispatches with other bundle files. Prefer pointers over secrets.

---

## Purpose

Use this file for information that:

- Spans multiple tasks on the same team
- Is not appropriate for a single ticket description
- Should not be repeated in every prompt from scratch
- Helps you orient quickly on recurring workstreams

**Do not use** for: ephemeral task status, credentials, or full document paste without summary.

---

## Team / product snapshot

<!-- Fill in during onboarding or first task -->

| Field | Value |
|-------|-------|
| Agent | {{agentName}} |
| Role | {{roleName}} (`{{roleKey}}`) |
| Primary capabilities | {{capabilities}} |
| Default tools | {{tools}} |

### Role focus

{{roleDescription}}

### Persona anchor

{{rolePersona}}

---

## Active workstreams

<!-- List ongoing epics, branches, or initiatives -->

1. _None documented yet — update when assigned._

---

## Key repositories & paths

<!-- Monorepo roots, packages you own -->

- _Example: `tcl/packages/tcl-core` — API server_
- _Example: `tcl/packages/tcl-ui` — Angular UI_

---

## Environments

| Environment | Base URL / notes |
|-------------|------------------|
| Production | _Do not test destructively_ |
| Staging | _Preferred for verification_ |
| Local | _Developer machine_ |

---

## Stakeholders & escalation

| Area | Contact / role |
|------|----------------|
| Product | _TBD_ |
| Engineering | _TBD_ |
| Security | _TBD_ |
| On-call | _TBD_ |

---

## Canonical links

- Agent Studio spec: `docs/specs/agent-studio.md`
- Template pack: generic_agent_setup (default)

---

## Open questions (standing)

<!-- Questions that apply across tasks until answered -->

- _None_

---

## Context hygiene rules

1. **Link** to specs/tickets instead of duplicating them.
2. **Date** major updates at the top when you change this file.
3. **Remove** stale sections when workstreams complete.
4. **Never** store API keys, JWTs, or customer PII.

---

## Last updated

_Update this line when you edit: YYYY-MM-DD — summary of change_
