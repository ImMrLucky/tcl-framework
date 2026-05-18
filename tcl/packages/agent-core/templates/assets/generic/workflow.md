# Workflow

End-to-end delivery workflow for **{{agentName}}** as **{{roleName}}**. Align task board columns with these stages where possible.

---

## Stage 0 — Intake

**Goal**: Confirm the task is actionable.

- Validate title, description, and acceptance criteria exist.
- Tag work type (bug, story, spike, chore, review).
- Confirm priority and owner.
- If intake is incomplete, return to requester with questions.

**Outputs**: Intake note or clarifying questions.

---

## Stage 1 — Understand & refine

**Goal**: Shared understanding of "done".

- Restate problem and user impact.
- List acceptance criteria and edge cases.
- Identify dependencies and reviewers.
- For {{roleName}}: {{roleDescription}}

**Outputs**: Updated task description or spec link.

**Gate**: Spec review (if required by team template).

---

## Stage 2 — Plan

**Goal**: Agree on approach before expensive work.

- Propose approach and alternatives.
- Identify files/systems touched.
- Define test strategy.
- Estimate risk (L/M/H).

**Outputs**: Plan comment or design snippet.

**Gate**: Architecture/design review for High risk or cross-cutting changes.

---

## Stage 3 — Build / execute

**Goal**: Implement the smallest slice that satisfies criteria.

- Follow `instructions.md` and `rules.md`.
- Use tools per `tools.md`.
- Commit in reviewable chunks.
- Keep task board in sync.

**Outputs**: Code, config, docs, or analysis artifacts.

**Gate**: Code review before merge (default for production code).

---

## Stage 4 — Verify

**Goal**: Prove acceptance criteria with evidence.

- Run automated tests; add missing tests.
- Manual verification checklist if needed.
- Capture screenshots/logs for UI or API changes.

**Outputs**: Test results, verification checklist.

**Gate**: QA review when criteria include user-facing behavior or regression risk.

---

## Stage 5 — Review & compliance

**Goal**: Required human/specialist sign-off.

- Security review for auth, data, payments, integrations.
- Compliance review when handling regulated data or customer contracts.
- Release approval for production deploys.

See `review-gates.md` for triggers.

**Outputs**: Review decision recorded on task.

---

## Stage 6 — Deliver & hand off

**Goal**: Close the loop.

- Publish summary per `output-format.md`.
- Update `memory.md` with durable lessons.
- Hand off open items via `handoff.md`.
- Move task to Done only when gates are satisfied.

**Outputs**: Completion summary, linked artifacts.

---

## Parallel work / WIP limits

- Prefer **one** active execution task per agent unless orchestrating.
- If blocked, move task to Blocked with reason; do not start unrelated work without approval.

---

## Orchestration mode

{{orchestratorMode}}

When orchestrating:

- Break epics into tasks with clear owners.
- Schedule review gates explicitly.
- Do not mark the epic Done until child tasks and gates are complete.

---

## Escalation paths

| Trigger | Escalate to |
|---------|-------------|
| Scope change | Product owner / requester |
| Security concern | Security reviewer + human |
| Production incident | Human on-call + orchestrator |
| Tool/access failure | Team admin / human |
