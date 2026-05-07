# TCL use-case notes (generic)

ProtectQA / final expense remains the **default** demonstration path. Additional verticals share the same primitives:

- **Human sales & support** → compliance + disclosure + evidence gaps + value mining.
- **AI agents / copilots / chatbots** → `AI_*` issue families, tool-use drift, missing citations.
- **Healthcare / finance / SaaS** → enable the corresponding stub pack and grow rules with legal/compliance partners.

Example API fields (all backward compatible):

```json
{
  "scores": {
    "tcl": 82,
    "overall": 82,
    "truth": 78,
    "transcriptGrounding": 96,
    "compliance": 85,
    "hallucination": 90,
    "drift": 88,
    "evidenceSupport": 72,
    "speakerConfidence": 94,
    "businessValue": 61
  },
  "risk": {
    "level": "medium",
    "primaryRisk": "Missing carrier approval disclosure",
    "reviewRequired": true,
    "recommendedAction": "Compliance review & ProtectQA rule check",
    "businessImpact": "Regulatory / customer-dispute risk"
  },
  "dashboardSummary": {
    "title": "ProtectQA Conversation Review",
    "plainEnglishSummary": "…"
  }
}
```
