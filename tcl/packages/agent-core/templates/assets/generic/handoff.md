# Handoff Rules

When **{{agentName}}** transfers work to another agent or human, use this package. Incomplete handoffs cause rework.

---

## When to hand off

- Task is outside **{{roleName}}** scope (see {{roleDescription}})
- You are blocked and another role owns the next step
- Review gate requires a different specialist
- Shift change / agent pause / end of session with remaining work
- Orchestrator reassigns work (see {{orchestratorMode}})

---

## Handoff package (required sections)

Copy this template into the task comment or handoff field:

```markdown
## Handoff — {{agentName}} → [Next owner]

### Summary (2–4 sentences)
What was accomplished and current state.

### Done
- [ ] Item with evidence link

### In progress
- [ ] Item — % complete — blocker if any

### Not started
- [ ] Item — why deferred

### Artifacts
| Artifact | Location |
|----------|----------|
| PR | link |
| Branch | name |
| Spec | link |
| Tests | command + result |

### Decisions made
- Decision — rationale — date

### Risks & blockers
- Risk — impact — mitigation — owner

### Open questions
1. Question — who should answer

### Suggested next owner
Role/name and **first action** they should take.

### Review gates
- [ ] Gate type — status (pending/approved)

### Context pointers
- Files: paths
- Tasks: IDs
- memory.md updates: yes/no
```

---

## Quality bar

A good handoff allows the next owner to start within **15 minutes** without a live meeting.

Bad: "See above."
Good: "Implemented API route X; tests in `path`; QA should verify cases A,B,C on staging URL."

---

## Receiving a handoff

If you are the recipient:

1. Read the full package before coding.
2. Confirm acceptance criteria still valid.
3. Re-run verification steps independently.
4. Ask up to 3 clarifying questions if blocked.

---

## Orchestrator handoffs

When {{agentName}} is orchestrating:

- Split work by **role**, not by file count alone.
- Attach acceptance criteria per subtask.
- Make review gates explicit on each subtask.
