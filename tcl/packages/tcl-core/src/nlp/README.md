# TCL NLP Module

**Universal processing engine** that works across all domains.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        APP LAYER                            │
│  (Call Center UI)    (Loan UI)    (AI Chat UI)              │
│  Domain-specific     Domain-specific  Domain-specific       │
│  labels & UX         labels & UX      labels & UX           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ setNLPConfig(DOMAIN_CONFIG)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      TCL CORE ENGINE                        │
│                                                             │
│  Universal Processing:                                      │
│  • Statements (claims, promises, denials, explanations)     │
│  • Actions (decisions, modifications, disclosures)          │
│  • Evidence (policies, system data, documents)              │
│                                                             │
│  NLP Module:                                                │
│  • Entity extraction (configurable patterns)                │
│  • Semantic similarity (configurable synonyms)              │
│  • Contradiction detection (entity + polarity based)        │
│  • Graph building (support, contradiction, grounding edges) │
│                                                             │
│  Output: Universal data structures                          │
└─────────────────────────────────────────────────────────────┘
```

## Universal Abstractions

Every interaction (call, loan application, AI chat) reduces to:

| Abstraction | Description | Examples |
|-------------|-------------|----------|
| **Statement** | Something said | Claims, promises, explanations, denials |
| **Action** | Something done | Approved, denied, waived, sent, escalated |
| **Evidence** | Source of truth | Policies, CRM data, documents, regulations |

## Usage

### 1. App Startup - Load Domain Config

```typescript
// In your call center app
import { setNLPConfig } from '@tcl/core/nlp';
import { CALL_CENTER_CONFIG } from '@tcl/core/nlp/configs';

setNLPConfig(CALL_CENTER_CONFIG);
```

### 2. Process Statements

```typescript
import { analyzeStatement, analyzeStatementsForGraph } from '@tcl/core/nlp';

// Single statement
const analysis = analyzeStatement({
  id: 'stmt-1',
  text: 'I will send you the billing breakdown today',
  speaker: 'agent'
});

// Batch analysis for graph building
const { analyses, subjectGroups, potentialPairs } = analyzeStatementsForGraph(statements);
```

### 3. UI Mapping

The core returns universal data. Your UI maps to domain terms:

```typescript
// Core returns: { type: 'MONEY', value: '$15.99', normalized: 1599 }
// Call center UI shows: "Fee: $15.99"
// Loan UI would show: "Amount: $15.99"

// Core returns: { statementType: 'promise', speaker: 'agent' }
// Call center UI shows: "Agent Promise"
// Loan UI would show: "Originator Commitment"
```

## Adding a New Domain

1. Create a config file in `src/nlp/configs/your-domain.ts`
2. Define domain-specific:
   - Entity patterns (what to extract)
   - Synonym groups (vocabulary)
   - Action patterns (what constitutes an action)
   - Statement classification keywords
3. Export from `src/nlp/configs/index.ts`
4. Load in your app: `setNLPConfig(YOUR_DOMAIN_CONFIG)`

See `call-center.ts` and `commercial-loans.ts` for examples.

## Files

| File | Purpose |
|------|---------|
| `config.ts` | Universal config interface, default config, merge logic |
| `entity-extractor.ts` | Extract entities using configurable patterns |
| `semantic-similarity.ts` | Synonym-aware similarity, polarity detection |
| `index.ts` | Main exports, statement analysis, graph helpers |
| `configs/` | Domain-specific configurations |

## Pricing Tiers (Call Center Product)

| Tier | Description |
|------|-------------|
| **Sandbox** | Free - Try it out |
| **Team/Developer** | Paid self-serve |
| **Enterprise** | SSO, custom integrations |

The TCL engine is the same for all tiers. Pricing is based on:
- Volume (statements/month)
- Features (exports, integrations)
- Support (SLA, dedicated)
