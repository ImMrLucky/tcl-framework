# Graph Module

This module implements the **Claim-Evidence-Action Graph** for ProtectQA.

## Core Principles

1. **Graph is the system of record.** UI, exports, scores, truth states, and spectral metrics are derived from it.
2. **Edges are evidence-bearing objects.** Every edge must be explainable and traceable.
3. **Support ≠ transcript quote.** Transcript quotes create `GROUNDING`, not `SUPPORT`.
4. **Contradictions require same subject slot.** No cross-topic contradictions.
5. **All thresholds and weights are config-driven.** No hard-coded constants.

## Data Flow

```
Raw Input (transcript, evidence)
    ↓
Claim Extraction + Subject Slot Computation
    ↓
Topic Segmentation (slot-first clustering)
    ↓
Candidate Generation (per-claim budgets)
    ↓
Edge Classification (slot gating + polarity check)
    ↓
Weight Calibration (method agreement, evidence strength)
    ↓
ClaimGraph (nodes + edges + diagnostics)
    ↓
Truth State Derivation (from graph, never assigned directly)
    ↓
spectral.py (global coherence analysis)
```

## Main Entry Point

```typescript
import { buildGraph } from './graph';

const result = buildGraph({
  transcript: "Agent: ...\nCustomer: ...",
  template: 'telco', // or 'loans', 'ai_chat', 'generic'
});

// Use result.graph for ClaimGraph
// Use result.truthScores for truth metrics
// Use result.legacy for backward compatibility with spectral.py
```

## Key Types

### SubjectSlot (THE KEY UPGRADE)

```typescript
interface SubjectSlot {
  slotType: string;    // e.g., "fee", "promo", "contract_term"
  entityKey: string;   // e.g., "router_fee", "late_fee"
  value?: any;         // Normalized value
  valueNorm?: string;  // Stable string for comparison
  qualifiers?: Record<string, any>;
}
```

Only claims with matching slots can contradict each other.

### GraphEdge

```typescript
interface GraphEdge {
  id: string;
  type: 'SUPPORT' | 'CONTRADICTION' | 'GROUNDING' | 'ACTION_RESULT' | 'CORRECTION';
  from: string;
  to: string;
  weight: number;          // 0..1 calibrated
  rationale: EdgeRationale; // Why this edge exists
  provenance: EdgeProvenance; // Traceability
  slot: { slotType: string; entityKey: string };
}
```

### TruthState

```typescript
type TruthState = 'SUPPORTED' | 'CONTRADICTED' | 'UNVERIFIED' | 'UNGROUNDED';
```

Truth states are **derived from graph topology**, never assigned directly:
- `SUPPORTED`: Has support edge to external evidence
- `CONTRADICTED`: Has contradiction edge
- `UNVERIFIED`: Grounded in transcript but no external evidence
- `UNGROUNDED`: Isolated node

### RunDiagnostics

```typescript
type RunStatus = 'OK' | 'DEGRADED' | 'FAILED';

interface RunDiagnostics {
  status: RunStatus;
  reasons: string[];
  counters: Record<string, number>;
}
```

## Template Configuration

Templates define domain-specific settings:
- `generic` - Works for any domain
- `telco` - Call center / telecom
- `loans` - Commercial lending
- `ai_chat` - AI assistant conversations

```typescript
import { setTemplateConfig } from './graph';

setTemplateConfig('telco');
// or
setTemplateConfig({
  templateId: 'custom',
  thresholds: {
    contradiction: 0.6,
    support: 0.5,
    grounding: 0.4,
  },
  gating: {
    contradictionRequiresSameSlot: true,
    contradictionRequiresSameTopic: true,
  },
});
```

## Regression Tests

Run the invariant tests to ensure graph quality:

```bash
npx vitest src/graph/tests/graph-invariants.test.ts
```

Key assertions:
- Contradiction edges must share `slotType` + `entityKey`
- Support edges must have evidence reference
- No edges between claims with low similarity unless entity matches
- Truth states match edge topology

## Integration with spectral.py

```typescript
import { buildGraph, toSpectralInput } from './graph';

const result = buildGraph({ transcript });
const spectralInput = toSpectralInput(result);

// spectralInput has:
// - claims: Array<{ id, text }>
// - supports: Array<{ claimA, claimB, weight }>
// - contradictions: Array<{ claimA, claimB, weight }>
// - grounded: string[]
```

## Files

| File | Description |
|------|-------------|
| `types.ts` | Canonical node and edge types |
| `template-config.ts` | Domain-specific configuration |
| `subject-slot.ts` | Subject slot computation |
| `topic-segmentation.ts` | Topic clustering and gating |
| `candidate-generation.ts` | Stage A: High-recall candidate pairs |
| `edge-classification.ts` | Stage B: Precision edge creation |
| `weight-calibration.ts` | Stage C: Trustworthy weights |
| `truth-state-derivation.ts` | Truth states from graph |
| `run-diagnostics.ts` | Run status and integrity |
| `graph-builder.ts` | Unified entry point |
| `edge_builder.ts` | Legacy edge builder (backward compat) |
