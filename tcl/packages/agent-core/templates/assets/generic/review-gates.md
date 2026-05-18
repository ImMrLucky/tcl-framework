# Review Gates

Human or specialist review is required before certain outcomes. **{{agentName}}** must not mark work complete or execute gated actions until approval is recorded.

---

## 1. Universal gates (always apply)

Review required before:

- Marking a task **Done** when acceptance criteria include production impact
- **Merging** to main/production branches
- **Deploying** to staging/production
- **Sending** external communications (customers, partners, public)
- **Changing** authentication, authorization, billing, or entitlements
- **Storing** or processing new categories of PII/PHI
- **Running** destructive operations (delete, drop, wipe)
- **Rotating** secrets or changing IAM policies

If approval is pending: status = **In Review**, not Done.

---

## 2. Gate types

| Gate | Typical owner | When triggered |
|------|---------------|----------------|
| SPEC_REVIEW | PO / BA / human | Requirements ambiguous or high impact |
| CODE_REVIEW | Engineer / human | Any production code change |
| QA_REVIEW | QA engineer / human | User-facing or regression-sensitive |
| SECURITY_REVIEW | Security / human | Auth, crypto, secrets, integrations |
| RELEASE_APPROVAL | Admin / human | Production release |
| CUSTOM | Named role | Team template defines extra gate |

---

## 3. Role-specific expectations ({{roleName}})

{{roleDescription}}

{{orchestratorMode}}

---

## 4. Evidence required per gate

### SPEC_REVIEW package

- Problem statement and goals
- Acceptance criteria (testable)
- Non-goals
- Open questions

### CODE_REVIEW package

- Summary of change
- File list
- Test evidence
- Rollback plan (if deploy-related)
- Security notes (if applicable)

### QA_REVIEW package

- Test plan + results
- Exploratory notes
- Screenshots/recordings for UI
- Known limitations

### SECURITY_REVIEW package

- Threat model (brief)
- Data flow for sensitive data
- Authn/authz impact
- Dependency changes

---

## 5. How to request review

1. Stop implementation.
2. Post review request on the task with the appropriate package.
3. Tag required role or human.
4. Set task state to **Review**.
5. Continue only after explicit **Approved** (or approved with noted follow-ups).

---

## 6. Review outcomes

Record one of:

- **Approved** — proceed
- **Approved with follow-ups** — proceed; create subtasks for follow-ups
- **Changes requested** — return to Build stage
- **Rejected** — stop; escalate to PO/human

---

## 7. Anti-patterns

- Self-approving your own code without a second party
- "LGTM" without evidence
- Bypassing CI failures to meet deadlines
- Shipping with known failing criteria

---

## 8. Emergency exception

Only a **human** may authorize gate bypass for incidents. Document:

- Who approved
- Time
- Risk accepted
- Follow-up ticket for proper review
