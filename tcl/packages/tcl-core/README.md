# `@tcl/core` — Conversation Truth & Risk Intelligence

**TCL is not an “agent training score.”** It is a **Conversation Truth & Risk Intelligence** engine for human calls, AI assistants, and hybrid workflows: lies, misleading claims, hallucinations, unsupported assertions, compliance risk, drift, disclosure gaps, attribution problems, and **latent business signals** (objections, churn, confusion, KB gaps).

## Product promise

> *TCL turns conversations into defensible truth, compliance, drift, hallucination, and business-value intelligence.*

It helps teams answer:

1. What was said?  
2. Who said it (person vs AI vs system)?  
3. Was it true *and* appropriately supported?  
4. Was it compliant with policy and consistent across the call?  
5. What should we do next (compliance, AI policy, KB, product, not “coaching only”)?  

## Defaults (multi-industry)

- **Default domain pack:** `general_conversation_integrity` runs when no template / pack ids are supplied.  
- **ProtectQA final expense:** pass `options.template: "final_expense"` (or `insurance` / `protectqa`) or include `protectqa_final_expense` in `options.domainPackIds`.  
- **`scores.tcl`** / **`scores.overall`:** primary Conversation Truth & Risk composite.  
- **`scores.truth`:** factual/support/safety (not transcript presence). **`transcriptGrounding`** is tracked separately.  

`options.skipProtectqaDefault` is no longer required for a non-insurance default; the final-expense pack is not prepended unless you select it or pass explicit pack ids.

## Key API additions

- `scores`: `tcl`, `transcriptGrounding`, `compliance`, `hallucination`, `drift`, `evidenceSupport`, `speakerConfidence`, `businessValue`.  
- `risk`: `primaryRisk`, `recommendedAction`, `businessImpact`.  
- `dashboardSummary`: pre-structured sections for trust score, risks, unsupported claims, drift, insights, next actions.  
- `claimsAnalysis` + `evidenceDependencyGraph`: claim ↔ evidence expectations.  
- `businessInsights`: objections, churn, confusion, ProtectQA-specific signals.  
- `issuesBySeverity`: `critical` | `high` | `medium` | `low`.

## Docs & examples

- Positioning & framework: [`docs/PRODUCT_POSITIONING.md`](docs/PRODUCT_POSITIONING.md)  
- Generic use-case notes: [`docs/use-cases/README.md`](docs/use-cases/README.md)  
- Sample transcripts: [`examples/fixtures/`](examples/fixtures/)

## Build

```bash
npm install
npm run build
npm test
```

## Import

```typescript
import { validate } from "@tcl/core";
// or from dist after build
```

This package powers ProtectQA and any other product surface that needs **auditable** conversation intelligence—not vanity scores.
