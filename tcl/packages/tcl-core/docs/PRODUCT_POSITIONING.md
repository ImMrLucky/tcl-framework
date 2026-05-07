# TCL — Conversation Truth & Risk Intelligence

## One-line positioning

**TCL turns human and AI conversations into truth, compliance, hallucination, drift, and business-value intelligence.**

Shorter helper line:

**TCL helps organizations know what was said, who said it, whether it was true and supported, and what risk or latent business value was created.**

## Mental model — five questions

Every evaluation answers:

1. **Who said it?** Speaker attribution (agent / customer / AI / system), mapping confidence.
2. **What was claimed?** Claims, promises, approvals, pricing, eligibility, privacy, tooling outcomes.
3. **Was it true / supported?** `truth` reflects factual safety (not mere transcript presence). Transcript grounding is tracked separately as `transcriptGrounding`.
4. **Was it compliant & consistent?** Policies, disclosures, contradiction across turns.
5. **What should happen next?** Structured `recommendedActions`, `risk.recommendedAction`, ProtectQA-aware coaching/compliance/KB updates — **not “training-only.”**

Coaching remains **one** possible outcome alongside compliance review, AI prompt fixes, KB updates, and product/process insights.

## ProtectQA-first default

Without configuration, TCL applies the **`protectqa_final_expense`** domain pack so ProtectQA teams get burial/final-expense wording, underwriting dependency, graded-benefit, and disclosure checks immediately.

Set `options.skipProtectqaDefault = true` **only** when you intentionally want packs inferred solely from transcript/template.

## Primary client score — `scores.tcl`

`scores.tcl` (alias **`scores.overall`) is the main dashboard number: weighted Conversation Truth & Risk posture (ProtectQA weighting favors compliance + factual truth + disclosures + evidence + drift + speaker confidence).

Legacy fields (`scores.truth`, etc.) remain for older UI — **`truth` means factual / supported safety**, not “it appeared in the transcript.”

## Outputs to render

| Section | Response path |
|--------|----------------|
| Trust headline | `dashboardSummary.conversationTrustScore` |
| Narrative | `dashboardSummary.plainEnglishSummary` |
| Risk cluster | `risk.primaryRisk`, `risk.level`, `issuesBySeverity` |
| Evidence gaps | `claimsAnalysis`, `evidenceDependencyGraph`, `dashboardSummary.topUnsupportedClaims` |
| Drift timeline | `report.drift`, `dashboardSummary.topDriftEvents` |
| Business mining | `businessInsights`, `scores.businessValue` |

## Domain packs

Built-in IDs include `protectqa_final_expense`, `ai_chatbot`, `customer_support`, `saas_sales`, `healthcare`, `financial_services`. Extend with carrier-specific JSON/TS packs over time.
