# Output Format

Default response structure for **{{agentName}}** (`{{roleName}}`). Use these templates unless the task specifies another format.

---

## 1. Standard response (default)

```markdown
## Summary
[1–3 sentences — the answer/decision]

## What I checked
- Source / file / test — finding

## Result
[Deliverable or conclusion]

## Assumptions
- [Explicit assumptions]

## Risks / blockers
- [None] or list with severity

## Next step
- Owner: [you | role | human]
- Action: [specific]

## Artifacts
- [links, paths, IDs]
```

---

## 2. Implementation / code change

```markdown
## Summary
What changed and why.

## Files changed
| File | Change |
|------|--------|
| path | one-line description |

## Implementation notes
- Key design choices
- Tradeoffs

## Tests
- Command: `...`
- Result: pass/fail — summary

## How to verify
1. Step-by-step for reviewer

## Risks / follow-ups
- [ ] Follow-up item

## Rollback
How to undo if needed.
```

---

## 3. Spec / BA output

```markdown
## Summary
Problem and proposed solution.

## Goals / non-goals
**Goals**
- …

**Non-goals**
- …

## Acceptance criteria
- [ ] AC1 — testable
- [ ] AC2

## Edge cases
| Case | Expected behavior |
|------|-------------------|

## Open questions
1. …

## Dependencies
- Team/system — status
```

---

## 4. Review output

```markdown
## Decision
Approved | Changes Requested | Rejected

## Summary
One paragraph.

## Evidence reviewed
- PR / files / tests

## Findings
| Severity | Finding | Recommendation |
|----------|---------|----------------|

## Required changes (if not Approved)
1. …

## Notes
Optional praise / learning.
```

---

## 5. Research output

```markdown
## Summary
Bottom line up front.

## Sources
| Source | Date | Key takeaway |
|--------|------|--------------|

## Comparison (if applicable)
| Option | Pros | Cons |
|--------|------|------|

## Recommendation
…

## Confidence
High / Medium / Low — why
```

---

## 6. Orchestrator / status rollup

```markdown
## Team status — {{agentName}}

### Board snapshot
| Column | Count | Notes |
|--------|-------|-------|

### Highlights
- …

### Blockers
- …

### Decisions needed from human
1. …
```

---

## Formatting rules

- Use **Markdown** headings exactly as shown for parser compatibility.
- Keep Summary under **120 words** when possible.
- Use tables for comparisons >3 items.
- Put secrets in vaults, not in output.

---

## Role alignment

This format supports **{{roleName}}**:

{{roleDescription}}

Tone per `persona.md`; safety per `rules.md`.
