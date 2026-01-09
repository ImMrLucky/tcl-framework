# Ingestion to Analysis Flow

This document explains how analysis is performed from ingestion, including graph creation, edge generation, spectral analysis, and result return.

## High-Level Flow

```
Ingestion → Worker → Orchestrator → Graph Builder → Spectral Service → Results
```

## Detailed Flow

### 1. **Ingestion Entry Point** (`packages/tcl-core/src/server/ingest/worker.ts`)

When a job is processed, it calls `runAnalysis()`:

```typescript
async function runAnalysis(input: {
  orgId, projectId, env, conversationId, transcript, userId, 
  verificationLevel, transcriptAssetId, jobId
}): Promise<string>
```

**What it does:**
- Creates a `ValidateInput` object with the transcript
- Calls `validate()` from the orchestrator
- Retrieves the created evaluation from the database
- Links the evaluation to the ingestion job and asset

### 2. **Orchestrator Entry** (`packages/tcl-core/src/orchestrator.ts`)

The `validate()` function is the main orchestrator:

**Graph Builder Mode Selection:**
- **Default**: `unified` (3-stage pipeline with Subject Slots)
- **Alternative**: `legacy` (NLI-based) or `truth-engine` (deterministic)
- Controlled by `TCL_GRAPH_BUILDER` env var

**Main Path: `runUnifiedGraphPath()`** (lines 191-557)

### 3. **Claim Extraction** (Step 1)

```typescript
const extractResult = extractClaimsWithTypes(transcript);
const extractedClaims = extractResult.claims;
```

**What it does:**
- Parses transcript into structured claims
- Extracts speaker roles, turn indices, claim types
- Returns array of `ExtractedClaim` objects

### 4. **Graph Building** (Step 2) - `buildUnifiedGraph()`

**File**: `packages/tcl-core/src/graph/graph-builder.ts`

**Pipeline Steps:**

#### 4a. **Build ClaimNodes** (with Subject Slots)
- Each claim gets a `SubjectSlot` (e.g., "account balance", "refund amount")
- Subject slots prevent false contradictions (e.g., "Account A has $100" vs "Account B has $200" are NOT contradictory)

#### 4b. **Build EvidenceNodes**
- Creates nodes from external evidence (policies, documents)
- Transcript itself becomes an EvidenceNode for grounding

#### 4c. **Topic Segmentation**
- Groups claims into topic clusters
- Uses semantic similarity and co-occurrence
- Helps with candidate generation (claims in same topic more likely to relate)

#### 4d. **Candidate Generation** (per-claim budgets)
- For each claim, generates candidate pairs for potential edges
- Uses topic proximity, subject slot matching, and semantic similarity
- Applies per-claim budget limits (e.g., max 10 candidates per claim)

#### 4e. **Edge Classification** (slot-first gating)
- **Critical Step**: Classifies candidate pairs into:
  - **Support edges**: Claim A supports Claim B
  - **Contradiction edges**: Claim A contradicts Claim B
  - **Grounding edges**: Claim is grounded to evidence/transcript

**Gating Rules:**
1. **Slot Gating**: Contradictions require same subject slot
2. **Topic Gating**: Edges prefer same-topic claims
3. **Polarity Gating**: Checks semantic polarity (positive/negative)
4. **Threshold Gating**: Minimum confidence score required

#### 4f. **Weight Calibration**
- Assigns weights to edges based on:
  - Classification confidence
  - Semantic similarity
  - Edge type (support vs contradiction)

#### 4g. **Truth State Derivation**
- Computes truth states for each claim from graph structure:
  - **Supported**: Has incoming support edges
  - **Contradicted**: Has incoming contradiction edges
  - **Ungrounded**: No grounding edges
  - **Inconclusive**: Mixed signals

**Key Invariant**: Truth states are **derived from graph**, never assigned directly.

#### 4h. **Graph Output**
Returns:
- `ClaimGraph`: Nodes and edges
- `TruthScores`: Audit truth, consistency, coherence
- `Legacy format`: Supports, contradictions, grounding arrays (for spectral.py)

### 5. **Spectral Analysis** (Step 3)

**File**: `packages/tcl-spectral/app/spectral.py`

**What Spectral Does:**
- Takes the graph (claims + edges) as input
- Performs spectral graph analysis on the signed Laplacian matrix
- Computes:
  - **Spectral Gap**: Measures graph connectivity
  - **Contradiction Energy**: Strength of contradictions
  - **Support Energy**: Strength of support relationships
  - **Circularity Score**: Detects circular reasoning
  - **Coherence Score**: Overall graph coherence (0-100)
  - **Truth Vector**: Per-claim truth signal values
  - **Edge Attribution**: Which edges contribute most to incoherence

**Spectral Service Call:**
```typescript
const spectral = await callSpectralAnalyzeService(
  spectralServiceUrl,
  claims,           // Array of {id, text}
  supports,         // Array of {claimA, claimB, weight}
  contradictions,   // Array of {claimA, claimB, weight}
  groundedClaimIds, // Array of claim IDs with grounding
  options           // Weights and thresholds
);
```

**Spectral Endpoint**: `POST /spectral/analyze`

**Spectral Processing:**
1. Builds signed adjacency matrix (support = positive, contradiction = negative)
2. Computes signed Laplacian matrix
3. Solves eigenvalue problem to get spectral gap
4. Computes truth signal vector: `(H + αI)x = βb` where:
   - `H` = signed Laplacian
   - `b` = grounding bias vector
   - `x` = truth signal (per-claim)
5. Computes edge attribution (which edges cause most incoherence)
6. Ranks claims by importance (centrality + truth propagation)

### 6. **Result Assembly** (Step 4)

The orchestrator assembles the final result:

```typescript
const result: ValidateOutput = {
  scores: {
    truth: truthScore,        // From graph truth derivation
    consistency: consistencyScore, // From graph structure
    coherence: coherenceScore,     // From spectral analysis
    overall: blendScores(...)     // Weighted blend
  },
  claims: claimsWithTruthStates,
  graph: graphResult.graph,
  spectral: spectralReport,
  issues: [...],              // Violations, contradictions, missing evidence
  report: {...},              // Full report JSON
  // ... metadata
};
```

### 7. **Database Write** (Step 5)

The orchestrator writes to `evaluations` table:

```typescript
await supabaseAdmin.from('evaluations').insert({
  org_id,
  conversation_id,
  scores: result.scores,
  report: result.report,
  graph: result.graph,
  spectral: result.spectral,
  engine_version: getEngineVersion(),
  latency_ms: totalLatency,
  // ...
});
```

### 8. **Return to Worker** (Step 6)

The worker retrieves the evaluation ID and updates the ingestion job:

```typescript
const evaluationId = await runAnalysis(...);
await updateJobStatus(job.id, 'COMPLETE', null, {
  analysisRunId: evaluationId,
  verificationReportId: null,
});
```

## Key Data Structures

### Graph Structure
```typescript
ClaimGraph {
  nodes: {
    claims: ClaimNode[],
    evidence: EvidenceNode[],
    topics: TopicNode[]
  },
  edges: {
    support: SupportEdge[],
    contradiction: ContradictionEdge[],
    grounding: GroundingEdge[]
  }
}
```

### Spectral Input
```typescript
{
  claims: [{id: string, text: string}],
  supports: [{claimA: string, claimB: string, weight: number}],
  contradictions: [{claimA: string, claimB: string, weight: number}],
  grounded: string[]  // Claim IDs with grounding
}
```

### Spectral Output
```typescript
{
  coherenceScore: number,        // 0-100
  spectralGap: number,
  contradictionEnergy: number,
  supportEnergy: number,
  circularityScore: number,
  truthVector: number[],         // Per-claim truth signals
  truthStates: string[],         // Per-claim states
  nodeBlameNorm: number[],       // Per-claim blame scores
  topBadContradictions: [...],   // Worst contradiction edges
  topBadSupports: [...],         // Worst support edges
  rankedClaims: [...]            // Claims ranked by importance
}
```

## Flow Diagram

```
┌─────────────────┐
│  Ingestion Job  │
│  (worker.ts)    │
└────────┬────────┘
         │
         │ runAnalysis()
         ▼
┌─────────────────┐
│   Orchestrator  │
│  (orchestrator) │
└────────┬────────┘
         │
         │ runUnifiedGraphPath()
         ▼
┌─────────────────┐
│  Claim Extract  │
│ (claim_extractor)│
└────────┬────────┘
         │
         │ extractClaimsWithTypes()
         ▼
┌─────────────────┐
│  Graph Builder  │
│ (graph-builder) │
└────────┬────────┘
         │
         │ buildUnifiedGraph()
         │ 1. Build ClaimNodes (with slots)
         │ 2. Build EvidenceNodes
         │ 3. Topic Segmentation
         │ 4. Candidate Generation
         │ 5. Edge Classification
         │ 6. Weight Calibration
         │ 7. Truth Derivation
         ▼
┌─────────────────┐
│  Spectral Call  │
│ (spectral.py)   │
└────────┬────────┘
         │
         │ POST /spectral/analyze
         │ - Build signed Laplacian
         │ - Compute spectral gap
         │ - Solve truth vector
         │ - Compute edge attribution
         ▼
┌─────────────────┐
│  Result Assembly│
│  (orchestrator) │
└────────┬────────┘
         │
         │ Build ValidateOutput
         │ Write to evaluations table
         ▼
┌─────────────────┐
│  Return to UI   │
│  (evaluationId) │
└─────────────────┘
```

## Key Concepts

### Subject Slots
- Prevents false contradictions
- Example: "Account A: $100" vs "Account B: $200" have different slots
- Only claims with same slot can contradict

### Edge Types
- **Support**: Claim A provides evidence for Claim B
- **Contradiction**: Claim A contradicts Claim B (requires same slot)
- **Grounding**: Claim is backed by evidence/transcript

### Spectral Analysis
- Uses graph theory (signed Laplacian eigenvalues)
- Measures graph coherence and structure
- Computes per-claim truth signals
- Identifies problematic edges

### Truth Derivation
- Truth states come from graph structure, not direct assignment
- Claims can be: Supported, Contradicted, Ungrounded, Inconclusive
- Truth scores computed from edge weights and structure

## Environment Variables

- `TCL_GRAPH_BUILDER`: `unified` | `legacy` | `truth-engine`
- `SPECTRAL_SERVICE_URL`: URL of spectral.py service (default: `http://localhost:8000`)
- `TCL_USE_TRUTH_ENGINE`: Legacy flag for truth-engine mode

## Files Involved

1. **Ingestion**: `packages/tcl-core/src/server/ingest/worker.ts`
2. **Orchestrator**: `packages/tcl-core/src/orchestrator.ts`
3. **Graph Builder**: `packages/tcl-core/src/graph/graph-builder.ts`
4. **Claim Extractor**: `packages/tcl-core/src/claim_extractor.ts`
5. **Spectral Service**: `packages/tcl-spectral/app/spectral.py`
6. **Edge Classification**: `packages/tcl-core/src/graph/edge-classification.ts`
7. **Truth Derivation**: `packages/tcl-core/src/graph/truth-state-derivation.ts`

