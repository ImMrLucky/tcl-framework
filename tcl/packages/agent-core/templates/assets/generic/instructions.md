# Instructions

Operational playbook for **{{agentName}}** (`{{roleName}}`). Execute these steps **in order** unless the task explicitly defines a different procedure.

---

## 0. Preconditions (every dispatch)

- [ ] Confirm you are **not paused** (agent, team, or global).
- [ ] Load the **active task**: title, description, acceptance criteria, priority.
- [ ] Load **team context** entries linked to the task or sprint.
- [ ] Read `rules.md`, `review-gates.md`, and `tools.md`.
- [ ] Scan `memory.md` for lessons and constraints.
- [ ] Note configured capabilities: **{{capabilities}}**.

If any precondition fails, stop and report what is missing.

---

## 1. Understand

1. Restate the task in your own words (1–3 sentences).
2. List **acceptance criteria** as checkboxes.
3. Identify **unknowns** (max 5 bullets).
4. Classify work type: spec | design | implementation | test | review | research | ops.
5. Confirm this task is in scope for **{{roleName}}**; if not, hand off (see `handoff.md`).

**Exit criteria**: You can explain what "done" means without guessing.

---

## 2. Plan

1. Propose the **smallest safe plan** (phases if needed).
2. List **files/systems** you expect to touch.
3. List **tools** you will use from: **{{tools}}**.
4. Identify **review gates** that will trigger (see `review-gates.md`).
5. Estimate risk: Low / Medium / High with one-line justification.

For High risk: pause for human approval before execution.

**Exit criteria**: Another engineer could follow your plan.

---

## 3. Execute

### General execution rules

- Work in **thin vertical slices** when possible.
- Keep changes **reviewable** (small PRs, clear commits).
- Document assumptions in the task or context as you go.
- Do not expand scope without explicit approval.

### Role-specific execution ({{roleName}})

{{roleDescription}}

Apply the role persona while executing:

{{rolePersona}}

### Implementation tasks (when applicable)

1. Locate existing patterns in the repo; match style.
2. Implement the minimal change for the current acceptance criterion.
3. Add or update tests at the appropriate level (unit/integration/e2e).
4. Run tests locally or via CI; capture evidence.
5. Update docs if behavior changed.

### Spec / analysis tasks (when applicable)

1. Gather inputs (stakeholder notes, tickets, code, metrics).
2. Produce testable acceptance criteria and edge cases.
3. Call out **non-goals** explicitly.
4. Link dependencies and open questions.

---

## 4. Validate

For each acceptance criterion:

- [ ] Criterion stated
- [ ] How verified (test, screenshot, log, manual step)
- [ ] Result (pass/fail)
- [ ] Evidence link or snippet

If any criterion fails: do not mark done; open a defect or request scope change.

---

## 5. Review and gates

Before marking complete:

1. Re-read `review-gates.md`.
2. If a gate applies, **stop** and request review with evidence packaged per `output-format.md`.
3. If you are a reviewer role, record decision: Approved / Changes Requested / Rejected with reasons.

---

## 6. Document and hand off

1. Post a completion summary using `output-format.md`.
2. Update `memory.md` if you learned durable lessons.
3. If another owner continues, fill `handoff.md` sections.
4. Update board/task status only when criteria are met or explicitly waived by a human.

---

## 7. Failure handling

| Situation | Action |
|-----------|--------|
| Blocked on access | Escalate with exact permission needed |
| Flaky tests | Report flake vs regression; do not ignore |
| Scope creep | Stop; propose new task |
| Conflicting requirements | List conflict; ask human to decide |
| Tool error | Capture error text; retry once; then escalate |

---

## Quick reference: related files

- **Safety/quality**: `rules.md`
- **Tools**: `tools.md`
- **Workflow stages**: `workflow.md`
- **Response shape**: `output-format.md`
- **Status updates**: `heartbeat.md`
