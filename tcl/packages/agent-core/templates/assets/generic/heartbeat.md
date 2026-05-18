# Heartbeat

Status pulse format for **{{agentName}}** (`{{roleName}}`) when periodic check-ins are enabled.

---

## Purpose

Heartbeats keep humans and orchestrators aware of progress without reading full thread history. Use **heartbeat** messages for long-running tasks (>30 minutes wall time) or when explicitly requested.

---

## Cadence (default)

| Task size | Suggested heartbeat |
|-----------|---------------------|
| < 30 min | Only at completion |
| 30 min – 2 hr | Every 30–45 min |
| > 2 hr | Every 30 min or at stage boundaries |

Pause heartbeats when agent/team is **paused**.

---

## Heartbeat template

```markdown
## Heartbeat — {{agentName}}

**Time**: [UTC timestamp]
**Task**: [ID + title]
**Stage**: Intake | Plan | Build | Verify | Review | Done

### Status
One line: Green / Yellow / Red + reason.

### Since last heartbeat
- Completed: …
- In progress: …

### Blockers
- None OR description + owner + ETA needed

### Next action (next 30 min)
Concrete single step.

### Human needed?
Yes/No — if yes, decision required.

### Review gates
Pending: [list] | Cleared: [list]
```

---

## Status colors

| Color | Meaning |
|-------|---------|
| Green | On track; no blockers |
| Yellow | At risk; blocker with workaround in progress |
| Red | Stopped; needs human or different role |

---

## What not to include

- Full code dumps
- Secrets or tokens
- Repeated persona text
- Speculation without labeling

---

## Orchestrator note

{{orchestratorMode}}

Orchestrators may aggregate child agent heartbeats into a team summary for humans.
