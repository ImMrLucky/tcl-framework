# TCL — Conversation Truth & Risk Intelligence

**TCL helps organizations understand whether conversations are truthful, compliant, consistent, grounded, useful, and safe**—across human calls, support lines, insurance and healthcare intake, financial services, AI agents, chatbots, internal copilots, and compliance review workflows.

It is **not** positioned as “agent training” or “call coaching only.” Coaching can be one recommended action; the core value is **compliance, AI reliability, risk reduction, and auditable conversation intelligence**.

> *TCL turns human and AI conversations into truth, compliance, hallucination, drift, and business-value intelligence.*

## Packages

| Package | Role |
|--------|------|
| [`packages/tcl-core`](packages/tcl-core) | Analysis engine, domain packs, API server (`validate`, scoring, issues, dashboard summaries). **Default domain pack is General Conversation Integrity**; industry packs (e.g. ProtectQA final expense) attach when you select the matching template or pass `domainPackIds`. |
| [`packages/tcl-nlp`](packages/tcl-nlp) | Optional spaCy-backed entity extraction service. |

## Documentation

- [Product positioning & five-question framework](packages/tcl-core/docs/PRODUCT_POSITIONING.md)  
- [Generic use-case notes & sample response fields](packages/tcl-core/docs/use-cases/README.md)  
- [Package README (API defaults, `scores.tcl`)](packages/tcl-core/README.md)

## Quick mental model

1. Who said it?  
2. What was claimed?  
3. Was it true and supported (not just “in the transcript”)?  
4. Was it compliant and consistent?  
5. What should happen next (compliance, AI policy, KB, product insight—not only coaching)?  

For implementation details, tests, and fixtures, start in `packages/tcl-core`.

## Local install (clean checkout)

From this directory:

```bash
npm install
npm run build
npm run test
npm run typecheck
```

If dependency resolution is corrupted, remove `node_modules` and `package-lock.json` only when needed, then run `npm install` again. Do not commit `node_modules` or zipped dependencies.
