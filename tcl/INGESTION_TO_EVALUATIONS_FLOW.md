# Flow: Ingestion → Evaluations Page

## Quick Reference: API Call Sequence

**Complete API call sequence from file upload to evaluation display:**

1. **`POST /api/transcribe`** (if audio file) → Get transcript
2. **`POST /api/ingest`** → Normalize file, create conversation & artifact
3. **`POST /validate`** → Run evaluation, store in DB, returns `evaluationId`
4. **`GET /api/conversations/{id}/evaluations?limit=1`** (fallback only) → Get evaluation ID if not in response
5. **`GET /api/evaluations/{id}`** → Load full evaluation data
6. **`GET /api/evaluations/{id}/issues`** (fallback only) → Get issues if not in report

**Key Optimization**: Since `/validate` now returns `evaluationId` directly, step 4 is usually skipped.

---

## Complete File & API Flow with All API Calls

### 1. **FRONTEND: User Uploads File**

**File**: `packages/tcl-ui/src/app/ingestion/ingestion.component.ts`
- **Component**: `IngestionComponent`
- **Method**: `onSubmit()` (line 265) or `submitLinkedFiles()` (line 376)

**Flow Options**:
- **Option A: Audio File** → Transcribe first, then ingest
- **Option B: Text/Subtitle File** → Direct ingestion
- **Option C: Linked Audio + Transcript** → Transcribe audio, then link with transcript

**API Calls Made**:

#### 1a. Audio Transcription (if audio file)
- **Endpoint**: `POST /api/transcribe` (via `transcribeAudio()`)
- **Service**: External transcription service
- **Request**: `FormData` with audio file
- **Response**: `{ transcript: string, text: string }`
- **Location**: Line 504-520

#### 1b. File Preview (optional)
- **Endpoint**: `POST /api/ingest/preview`
- **Request**: `{ filename, content: base64, title, channel }`
- **Response**: `{ success, warnings, preview: { turnsCount, participants, sampleTurns } }`
- **Location**: Line 222-240
- **Purpose**: Preview normalization before submitting

#### 1c. File Ingestion
- **Endpoint**: `POST /api/ingest`
- **Request**: `{ filename, content: base64, title, channel }`
- **Response**: `{ success, conversationId, artifactId, normalized, warnings }`
- **Location**: Line 429-442 (single file) or 388-410 (linked files)

---

### 2. **API: File Ingestion & Normalization**

**Endpoint**: `POST /api/ingest`
- **Backend File**: `packages/tcl-core/src/server/ingestion/ingest-endpoint.ts`
- **Function**: `registerIngestEndpoints()` → `POST /ingest` handler (line 58)
- **Process**:
  1. Decodes base64 content
  2. Calls `normalizeFile()` from `packages/tcl-core/src/server/ingestion/normalizers/index.ts`
  3. Creates/updates conversation in Supabase (`conversations` table)
  4. Creates artifact in Supabase (`conversation_artifacts` table)
  5. Returns `{ conversationId, artifactId, normalized, warnings }`

**Normalizers** (based on file type):
- `packages/tcl-core/src/server/ingestion/normalizers/json-turns.ts` - JSON files
- `packages/tcl-core/src/server/ingestion/normalizers/csv-turns.ts` - CSV files
- `packages/tcl-core/src/server/ingestion/normalizers/text-turns.ts` - Plain text
- `packages/tcl-core/src/server/ingestion/normalizers/vtt-turns.ts` - VTT subtitles
- `packages/tcl-core/src/server/ingestion/normalizers/srt-turns.ts` - SRT subtitles

**Response**:
```json
{
  "success": true,
  "conversationId": "uuid",
  "artifactId": "uuid",
  "normalized": { ... },
  "warnings": []
}
```

---

### 3. **API: Run Evaluation (Validation)**

**Endpoint**: `POST /validate`
- **Backend File**: `packages/tcl-core/src/server/express.ts`
- **Handler**: `POST /validate` (line 474)
- **Process**:
  1. Extracts request body: `{ question, answer, sources, options, conversation_id }`
  2. Calls `validateOnce()` from orchestrator
  3. Stores evaluation in Supabase (`evaluations` table)
  4. Returns evaluation results with report

**Orchestrator Flow** (`packages/tcl-core/src/orchestrator.ts`):
- **Function**: `validateOnce()` (line 487)
- **Graph Builder Mode Selection** (line 501-510):
  - Defaults to `unified` (best for spectral.py)
  - Override via `TCL_GRAPH_BUILDER` env var or `options.graphBuilder`

**UNIFIED GRAPH BUILDER (Default)** - `runUnifiedGraphPath()` (line 182):
  1. **Claim Extraction**: `extractClaimsWithTypes()` from `claim_extractor.ts`
  2. **Template Selection**: Auto-detects `telco`, `loans`, `ai_chat`, or `generic`
  3. **Graph Building**: `buildGraph()` from `graph/graph-builder.ts`:
     ```
     Step 1: Build ClaimNodes (with Subject Slots)
     Step 2: Build EvidenceNodes
     Step 3: Topic Segmentation (assignTopicIds)
     Step 4: Candidate Generation (per-claim budgets)
     Step 5: Edge Classification (slot-first gating)
     Step 6: Weight Calibration
     Step 7: Truth State Derivation
     Step 8: Run Diagnostics
     ```
  4. **Spectral Analysis**: Calls `POST /spectral/analyze`
  5. **Destructive Claims**: `computeDestructiveClaims()`
  6. **Report Generation**: Builds full report with graph, metrics, diagnostics

**TRUTH ENGINE PATH** (if `TCL_GRAPH_BUILDER=truth-engine`):
  1. **Truth Engine**: `runTruthEngine()` from `engine/index.ts`
     - Extracts enhanced claims
     - Extracts facts
     - Runs rule engine
     - Builds graph
  2. **Spectral Analysis**: Calls `spectral/analyze`
  3. **Report Generation**

**LEGACY NLI PATH** (if `TCL_GRAPH_BUILDER=legacy`):
  1. **Claim Extraction**: `extractClaims()` from `claim_extractor.ts`
  2. **Graph Building**: `buildClaimGraph()` from `graph/edge_builder.ts`
  3. **Spectral Analysis**: Calls `spectral/analyze`
  4. **Report Generation**

**Spectral Service**:
- **URL**: `process.env.SPECTRAL_SERVICE_URL` (default: `http://localhost:8000`)
- **Endpoints**:
  - `POST /spectral/analyze` - Full analysis (preferred)
  - `POST /spectral/score` - Legacy scoring
- **File**: `packages/tcl-spectral/app/spectral.py`

**Database Write**:
- **Table**: `evaluations`
- **Fields**: `org_id`, `conversation_id`, `scores`, `report`, `engine_version`, `latency_ms`, etc.

**Response**:
```json
{
  "truth": 100,
  "consistency": 51,
  "coherence": 20,
  "overall": 69,
  "refusal": false,
  "report": {
    "claims": [...],
    "graph": {...},
    "spectral": {...},
    "issues": [...],
    "manifest": {...}
  }
}
```

---

### 4. **FRONTEND: Navigate to Evaluations Page**

**File**: `packages/tcl-ui/src/app/ingestion/ingestion.component.ts`
- **After validation** (line 346-362):
  
**Navigation Logic**:
1. **Primary Path**: If `evaluationData.evaluationId` exists in response → Navigate directly
   - **Location**: Line 346-348
   - **No additional API call needed** ✅
   
2. **Fallback Path**: If no `evaluationId` in response → Fetch latest evaluation
   - **API Call**: `GET /api/conversations/:conversationId/evaluations?limit=1`
   - **Service Method**: `auditService.getConversationEvaluations(conversationId, { limit: 1 })`
   - **Backend File**: `packages/tcl-core/src/server/express.ts` (line ~2431)
   - **Returns**: `{ evaluations: [{ id, ... }] }`
   - **Location**: Line 353-358
   - **Then**: Navigate to `/evaluations/{evaluationId}`

**Router Navigation**:
- **Route**: `/evaluations/:id`
- **Component**: `EvaluationResultsComponent`

---

### 5. **FRONTEND: Evaluations Page Loads**

**File**: `packages/tcl-ui/src/app/evaluation-results/evaluation-results.component.ts`
- **Component**: `EvaluationResultsComponent`
- **Method**: `ngOnInit()` (line 189) → `loadEvaluation()` (line 198)

**API Calls Made**:

#### 5a. Get Evaluation by ID (REQUIRED)
- **Endpoint**: `GET /api/evaluations/:id`
- **Backend File**: `packages/tcl-core/src/server/audit/routes.ts` (line ~243)
- **Service Method**: `auditService.getEvaluation(evaluationId)` (line 204)
- **Request**: `GET /api/evaluations/{evaluationId}`
- **Response**: `{ evaluation: Evaluation }`
- **Data Includes**:
  - `evaluation.id`, `evaluation.org_id`, `evaluation.conversation_id`
  - `evaluation.scores` (truth, consistency, coherence, counts)
  - `evaluation.report` (claims, graph, spectral, issues, manifest)
  - `evaluation.report.issueNarratives` or `evaluation.report.issueAnalysis`
  - `evaluation.engine_version`, `evaluation.latency_ms`

#### 5b. Get Issues (FALLBACK - only if narratives not in report)
- **Endpoint**: `GET /api/evaluations/:id/issues`
- **Backend File**: `packages/tcl-core/src/server/audit/routes.ts` (line ~285)
- **Service Method**: `auditService.getIssues(evaluationId)` (line 257)
- **Request**: `GET /api/evaluations/{evaluationId}/issues`
- **Response**: `{ issues: Issue[] }`
- **Condition**: Only called if `report.issueNarratives` and `report.issueAnalysis` are both missing
- **Location**: Line 256-262

**Data Processing** (line 210-274):
1. **Extract Issue Narratives** (Primary):
   - Checks `report.issueNarratives` first
   - Falls back to `report.issueAnalysis.narratives`
   - Falls back to `report.narratives` (direct array)
   
2. **Extract Summary Statistics**:
   - `totalIssues`, `bySeverity`, `byCategory`, `primaryRiskCategories`
   - `auditReady` flag
   
3. **Convert to Issues Array**:
   - Calls `convertNarrativesToIssues()` (line 252)
   - Sorts and processes issues (line 253)
   - Extracts top offenders (line 254)
   
4. **Extract Graph Data**:
   - `report.graph.supports`, `report.graph.contradictions`, `report.graph.grounding`
   
5. **Extract Spectral Metrics**:
   - `report.spectral.coherenceScore`, `report.spectral.contradictionEnergy`, etc.

---

## Complete API Endpoint Reference

### Ingestion Endpoints
- `POST /api/ingest` - Ingest and normalize file
  - **Request**: `{ filename, content: base64, title?, channel? }`
  - **Response**: `{ success, conversationId, artifactId, normalized, warnings }`
  - **Backend**: `packages/tcl-core/src/server/ingestion/ingest-endpoint.ts`
  
- `POST /api/ingest/preview` - Preview normalization without saving
  - **Request**: `{ filename, content: base64, title?, channel? }`
  - **Response**: `{ success, warnings?, preview: { turnsCount, participants, sampleTurns } }`
  - **Backend**: `packages/tcl-core/src/server/ingestion/ingest-endpoint.ts`

- `POST /api/transcribe` - Transcribe audio file
  - **Request**: `FormData` with audio file
  - **Response**: `{ transcript: string, text: string }`
  - **Backend**: External transcription service

### Evaluation Endpoints
- `POST /validate` - Run evaluation (main endpoint)
  - **Request**: `{ question, answer?, sources?, options?, conversation_id? }`
  - **Response**: `{ truth, consistency, coherence, overall, refusal, report, evaluationId }`
  - **Backend**: `packages/tcl-core/src/server/express.ts` (line 545)
  - **Timeout**: 5 minutes (300 seconds)
  
- `GET /api/evaluations` - List all evaluations
  - **Query Params**: `limit?, offset?`
  - **Response**: `{ evaluations: Evaluation[], total? }`
  - **Backend**: `packages/tcl-core/src/server/audit/routes.ts`
  
- `GET /api/evaluations/:id` - Get evaluation by ID
  - **Response**: `{ evaluation: Evaluation }`
  - **Backend**: `packages/tcl-core/src/server/audit/routes.ts` (line ~243)
  
- `GET /api/evaluations/:id/issues` - Get issues for evaluation
  - **Response**: `{ issues: Issue[] }`
  - **Backend**: `packages/tcl-core/src/server/audit/routes.ts` (line ~285)
  
- `GET /api/conversations/:conversationId/evaluations` - Get evaluations for conversation
  - **Query Params**: `limit?, offset?`
  - **Response**: `{ evaluations: Evaluation[] }`
  - **Backend**: `packages/tcl-core/src/server/express.ts` (line ~2431)
  
- `POST /api/evaluations/run` - Run evaluation with full manifest
  - **Request**: `{ conversationId, claims, supports, contradictions, grounded, config?, sources? }`
  - **Response**: `{ evaluationId, conversationId, inputHash, configHash, latency }`
  - **Backend**: `packages/tcl-core/src/server/audit/routes.ts`

### Export Endpoints
- `POST /api/exports/claims-csv` - Export claims as CSV
  - **Request**: `{ evaluation_id }`
  - **Response**: `{ artifactId, downloadUrl, checksum }`
  
- `POST /api/exports/run-json` - Export run as JSON bundle
  - **Request**: `{ evaluation_id }`
  - **Response**: `{ artifactId, downloadUrl, checksum }`
  
- `POST /api/exports/issue-pdf` - Export single issue as PDF
  - **Request**: `{ evaluation_id, claim_id }`
  - **Response**: `{ artifactId, downloadUrl, checksum }`

---

## Key Backend Files

### Orchestration
- `packages/tcl-core/src/orchestrator.ts` - Main validation orchestrator (graph mode selection)
- `packages/tcl-core/src/server/express.ts` - Express server & routes

### Unified Graph Builder (DEFAULT - Best for spectral.py)
- `packages/tcl-core/src/graph/graph-builder.ts` - Main entry point for unified pipeline
- `packages/tcl-core/src/graph/candidate-generation.ts` - Stage A: High-recall candidate pairs
- `packages/tcl-core/src/graph/edge-classification.ts` - Stage B: Slot-first edge gating
- `packages/tcl-core/src/graph/weight-calibration.ts` - Stage C: Edge weight calibration
- `packages/tcl-core/src/graph/subject-slot.ts` - Subject slot computation (THE KEY UPGRADE)
- `packages/tcl-core/src/graph/topic-segmentation.ts` - Topic clustering & gating
- `packages/tcl-core/src/graph/truth-state-derivation.ts` - Truth states from graph topology
- `packages/tcl-core/src/graph/run-diagnostics.ts` - Run status (OK/DEGRADED/FAILED)
- `packages/tcl-core/src/graph/template-config.ts` - Config-driven thresholds & lexicons
- `packages/tcl-core/src/graph/types.ts` - Canonical node/edge types

### Truth Engine (Deterministic, rule-based)
- `packages/tcl-core/src/engine/truth-engine.ts` - Main truth engine
- `packages/tcl-core/src/engine/facts/fact-extractor.ts` - Fact extraction
- `packages/tcl-core/src/engine/rules/rule-engine.ts` - Rule-based edge generation
- `packages/tcl-core/src/engine/config/types.ts` - Configuration types

### Legacy Graph Building (NLI-based)
- `packages/tcl-core/src/graph/edge_builder.ts` - Graph construction
- `packages/tcl-core/src/graph/transformers_scorer.ts` - Local NLI scorer
- `packages/tcl-core/src/graph/spectral_nli_scorer.ts` - Spectral NLI scorer

### Issue Analysis
- `packages/tcl-core/src/issues/analyzer.ts` - Issue analysis
- `packages/tcl-core/src/issues/narratives.ts` - Issue narrative generation
- `packages/tcl-core/src/issues/quotes.ts` - Evidence quote extraction
- `packages/tcl-core/src/issues/clustering.ts` - Issue clustering

### Reproducibility
- `packages/tcl-core/src/analysis/reproducibility.ts` - Reproducibility metadata
- `packages/tcl-core/src/config/loader.ts` - Config loading & hashing

### Ingestion
- `packages/tcl-core/src/server/ingestion/ingest-endpoint.ts` - Ingestion API
- `packages/tcl-core/src/server/ingestion/normalizers/index.ts` - Normalizer dispatcher

### Audit Routes
- `packages/tcl-core/src/server/audit/routes.ts` - Audit-grade routes
- `packages/tcl-core/src/server/audit/evaluation-run.ts` - Evaluation run handler

---

## Database Tables

### `conversations`
- Stores conversation metadata
- Fields: `id`, `org_id`, `title`, `channel`, `created_at`

### `conversation_artifacts`
- Stores normalized file content
- Fields: `id`, `conversation_id`, `filename`, `content`, `normalized`, `storage_ref`

### `evaluations`
- Stores evaluation results
- Fields: `id`, `org_id`, `conversation_id`, `scores`, `report`, `engine_version`, `latency_ms`, `created_at`

---

## External Services

### Spectral Service
- **URL**: `process.env.SPECTRAL_SERVICE_URL`
- **Endpoints**: `/spectral/analyze`, `/spectral/score`
- **File**: `packages/tcl-spectral/app/spectral.py`
- **Purpose**: Graph analysis, truth propagation, centrality metrics

### Supabase
- **Purpose**: Database (PostgreSQL)
- **Tables**: `conversations`, `conversation_artifacts`, `evaluations`, `orgs`, `projects`, etc.

---

## Frontend Components

### Ingestion
- `packages/tcl-ui/src/app/ingestion/ingestion.component.ts` - File upload UI
- `packages/tcl-ui/src/app/ingestion/ingestion.component.html` - Template

### Evaluations
- `packages/tcl-ui/src/app/evaluation-results/evaluation-results.component.ts` - Results display
- `packages/tcl-ui/src/app/evaluation-results/evaluation-results.component.html` - Template
- `packages/tcl-ui/src/app/issue-detail-modal/issue-detail-modal.component.ts` - Issue detail modal

### Services
- `packages/tcl-ui/src/app/audit.service.ts` - API service for evaluations
- `packages/tcl-ui/src/app/tcl.service.ts` - General API service

---

## Complete Flow Summary with API Calls

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER UPLOADS FILE                                           │
│    IngestionComponent.onSubmit() or submitLinkedFiles()        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2a. (IF AUDIO) POST /api/transcribe                            │
│     → Returns: { transcript, text }                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2b. POST /api/ingest                                            │
│     Request: { filename, content: base64, title, channel }     │
│     → normalizeFile() → Store in DB                              │
│     → Returns: { conversationId, artifactId, normalized }        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. POST /validate                                               │
│    Request: { question, answer, sources, options, conversation_id } │
│    → orchestrator.validateOnce()                                │
│      ├─ Claim Extraction                                        │
│      ├─ Truth Engine / Graph Building                           │
│      ├─ Spectral Analysis (POST /spectral/analyze)               │
│      ├─ Issue Analysis (buildIssueNarratives)                   │
│      └─ Report Generation                                       │
│    → Store in DB (evaluations table)                            │
│    → Returns: { truth, consistency, report, evaluationId }      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. NAVIGATION LOGIC                                             │
│    IF evaluationId in response:                                 │
│      → Navigate to /evaluations/{evaluationId} ✅ (no API call) │
│    ELSE:                                                        │
│      → GET /api/conversations/{conversationId}/evaluations?limit=1 │
│      → Navigate to /evaluations/{evaluationId}                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. EVALUATION RESULTS PAGE LOADS                                │
│    EvaluationResultsComponent.ngOnInit()                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6a. GET /api/evaluations/{evaluationId} (REQUIRED)              │
│     → Returns: { evaluation: { id, scores, report, ... } }     │
│     → Extract: report.issueNarratives, report.graph, etc.        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6b. (FALLBACK) GET /api/evaluations/{evaluationId}/issues       │
│     → Only if issueNarratives not in report                      │
│     → Returns: { issues: Issue[] }                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. DISPLAY RESULTS                                              │
│    - Executive Summary (from issueNarrativesSummary)            │
│    - Problem Statements (from issueNarratives)                   │
│    - Top Claim Issues Table (from converted issues)              │
│    - Top Offenders (from extractTopOffenders)                   │
│    - Graph Visualization (from report.graph)                    │
└─────────────────────────────────────────────────────────────────┘
```

## API Call Sequence Diagram

```
Frontend                    Backend API              Spectral Service        Database
  │                            │                          │                    │
  │── POST /api/ingest ───────>│                          │                    │
  │                            │── normalizeFile() ──────┼──────────────────>│
  │<── {conversationId} ───────│                          │                    │
  │                            │                          │                    │
  │── POST /validate ──────────>│                          │                    │
  │                            │── validateOnce()        │                    │
  │                            │   ├─ extractClaims()     │                    │
  │                            │   ├─ buildGraph()         │                    │
  │                            │   ├─ POST /spectral/analyze ────────────────>│
  │                            │   │<── SpectralReport ────────────────────────│
  │                            │   ├─ buildIssueNarratives()                   │
  │                            │   └─ Store evaluation ───────────────────────>│
  │<── {evaluationId, report} ─│                          │                    │
  │                            │                          │                    │
  │── Navigate to /evaluations/{id}                        │                    │
  │                            │                          │                    │
  │── GET /api/evaluations/{id} ─────────────────────────┼──────────────────>│
  │<── {evaluation} ───────────│                          │<───────────────────│
  │                            │                          │                    │
  │── (Optional) GET /api/evaluations/{id}/issues ────────┼──────────────────>│
  │<── {issues} ───────────────│                          │<───────────────────│
  │                            │                          │                    │
  │── Display Results          │                          │                    │
```

---

## Key Configuration

### Environment Variables
- `SPECTRAL_SERVICE_URL` - Spectral service URL
- `TCL_GRAPH_BUILDER` - Graph builder mode: `unified` (default) | `legacy` | `truth-engine`
- `TCL_USE_TRUTH_ENGINE` - (Legacy) Enable deterministic truth engine
- `TCL_USE_LEGACY_GRAPH` - (Legacy) Force legacy NLI-based graph
- `SUPABASE_URL` - Supabase database URL
- `SUPABASE_SERVICE_KEY` - Supabase service key

### Config Files
- `packages/tcl-core/src/config/scoring.json` - Scoring thresholds
- `packages/tcl-core/src/config/templates.json` - Issue templates
- `packages/tcl-core/src/config/taxonomy.json` - Category taxonomy
- `packages/tcl-core/src/engine/config/types.ts` - Truth engine config

