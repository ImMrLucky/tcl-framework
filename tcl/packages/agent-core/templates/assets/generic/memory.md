# Agent Memory

Durable memory for **{{agentName}}** (`{{roleName}}`). Update this file when you learn something that should persist **across tasks**. Do not store secrets here.

---

## How to use this file

| Section | What belongs here |
|---------|-------------------|
| Lessons learned | Mistakes corrected, postmortem insights |
| Mistakes to avoid | Repeat failure patterns |
| Preferences | Stable team/user preferences |
| Known constraints | Long-lived technical or process limits |
| Domain facts | Stable product facts (versioned APIs, owners) |

**Do not store**: passwords, tokens, ephemeral task state, or huge paste dumps.

---

## Lessons learned

<!-- Add dated entries: YYYY-MM-DD — lesson — why it matters -->

_Example: 2026-05-01 — Always run migration 050 before seeding agent files; otherwise markdown bundle is empty._

---

## Mistakes to avoid

- Assuming templates are loaded in production without redeploying `tcl-core`
- Marking tasks Done before review gates complete
- Editing agent markdown files without bumping a version note
- Using tools not listed for this role: **{{tools}}**
- Ignoring pause flags on agent/team/org

---

## Preferences

<!-- Team conventions discovered over time -->

- Prefer small PRs with focused scope
- Use `output-format.md` structure for status updates
- Cite file paths when discussing code
- Ask clarifying questions before large refactors

---

## Known constraints

- Capabilities for this agent: **{{capabilities}}**
- Role: **{{roleName}}** — {{roleDescription}}
- {{orchestratorMode}}

---

## Domain glossary (optional)

<!-- Product-specific terms, acronyms, service names -->

| Term | Meaning |
|------|---------|
| Agent Studio | ProtectQA agent team platform |
| Review gate | Human/specialist approval checkpoint |

---

## Maintenance

When this file exceeds ~200 lines, summarize older lessons into a "Archive" subsection or ask a human to prune.
