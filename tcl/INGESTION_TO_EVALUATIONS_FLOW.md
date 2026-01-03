# Flow: Ingestion → Evaluations Page

## Complete File & API Flow

### 1. **FRONTEND: User Uploads File**

**File**: `packages/tcl-ui/src/app/ingestion/ingestion.component.ts`
- **Component**: `IngestionComponent`
- **Method**: `onSubmit()` (line 257)
- **Actions**:
  - If audio file: calls `transcribeAudio()` first
  - Encodes transcript to base64
  - Calls `/api/ingest` endpoint
  - Then calls `/validate` endpoint
  - Navigates to evaluations page

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
- **Function**: `validateOnce()` (line 47)
- **Steps**:
  1. **Claim Extraction**: `extractClaims()` from `claim_extractor.ts`
  2. **Truth Engine** (if enabled): `runTruthEngine()` from `engine/index.ts`
     - Extracts enhanced claims
     - Extracts facts
     - Runs rule engine
     - Builds graph
  3. **Graph Building** (if NLI): `buildClaimGraph()` from `graph/edge_builder.ts`
  4. **Spectral Analysis**: Calls `spectral/analyze` or `spectral/score`
  5. **Issue Analysis**: `analyzeForIssues()` from `issues/analyzer.ts`
  6. **Reproducibility**: `generateReproducibilityMetadata()` from `analysis/reproducibility.js`
  7. **Report Generation**: Builds full report with issues, metrics, manifest

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
- **After validation** (line 338):
  1. Calls `getConversationEvaluations(conversationId, { limit: 1 })`
  2. Navigates to `/evaluations/{evaluationId}`

**API Call**:
- **Endpoint**: `GET /api/conversations/:conversationId/evaluations?limit=1`
- **Backend File**: `packages/tcl-core/src/server/express.ts` (line 2431)
- **Returns**: `{ evaluations: [...] }`

---

### 5. **FRONTEND: Evaluations Page Loads**

**File**: `packages/tcl-ui/src/app/evaluation-results/evaluation-results.component.ts`
- **Component**: `EvaluationResultsComponent`
- **Method**: `ngOnInit()` → `loadEvaluation()` (line 198)

**API Calls Made**:

#### 5a. Get Evaluation by ID
- **Endpoint**: `GET /api/evaluations/:id`
- **Backend File**: `packages/tcl-core/src/server/audit/routes.ts` (line 243)
- **Service Method**: `auditService.getEvaluation(evaluationId)`
- **Returns**: `{ evaluation: Evaluation }`
- **Data**: Full evaluation object with `report`, `scores`, `manifest`, etc.

#### 5b. Get Issues (if separate endpoint exists)
- **Endpoint**: `GET /api/evaluations/:id/issues` (optional)
- **Backend File**: `packages/tcl-core/src/server/audit/routes.ts` (line 243)
- **Returns**: `{ issues: Issue[] }`

**Data Processing**:
- Extracts `report.issues` or `report.issueNarratives`
- Extracts `report.graph` for visualization
- Extracts `report.spectral` for metrics
- Extracts `report.manifest` for audit info
- Builds summary statistics

---

## Complete API Endpoint Reference

### Ingestion Endpoints
- `POST /api/ingest` - Ingest and normalize file
- `POST /api/ingest/preview` - Preview normalization without saving

### Evaluation Endpoints
- `POST /validate` - Run evaluation (main endpoint)
- `GET /api/evaluations` - List all evaluations
- `GET /api/evaluations/:id` - Get evaluation by ID
- `GET /api/evaluations/:id/issues` - Get issues for evaluation
- `GET /api/conversations/:conversationId/evaluations` - Get evaluations for conversation
- `POST /api/evaluations/run` - Run evaluation with full manifest

### Export Endpoints
- `GET /api/evaluations/:id/export/json` - Export as JSON
- `GET /api/evaluations/:id/export/csv` - Export as CSV
- `GET /api/evaluations/:id/export/pdf` - Export as PDF

---

## Key Backend Files

### Orchestration
- `packages/tcl-core/src/orchestrator.ts` - Main validation orchestrator
- `packages/tcl-core/src/server/express.ts` - Express server & routes

### Truth Engine (Deterministic)
- `packages/tcl-core/src/engine/truth-engine.ts` - Main truth engine
- `packages/tcl-core/src/engine/facts/fact-extractor.ts` - Fact extraction
- `packages/tcl-core/src/engine/rules/rule-engine.ts` - Rule-based edge generation
- `packages/tcl-core/src/engine/config/types.ts` - Configuration types

### Graph Building (NLI-based, legacy)
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

## Flow Summary

```
1. User uploads file → IngestionComponent.onSubmit()
   ↓
2. POST /api/ingest → normalizeFile() → Store in DB
   ↓
3. POST /validate → orchestrator.validateOnce()
   ↓
4. Truth Engine / Graph Building → Spectral Analysis
   ↓
5. Issue Analysis → Report Generation
   ↓
6. Store evaluation in DB → Return results
   ↓
7. GET /api/conversations/:id/evaluations → Navigate to /evaluations/:id
   ↓
8. GET /api/evaluations/:id → Load evaluation data
   ↓
9. Display results in EvaluationResultsComponent
```

---

## Key Configuration

### Environment Variables
- `SPECTRAL_SERVICE_URL` - Spectral service URL
- `TCL_USE_TRUTH_ENGINE` - Enable deterministic truth engine
- `SUPABASE_URL` - Supabase database URL
- `SUPABASE_SERVICE_KEY` - Supabase service key

### Config Files
- `packages/tcl-core/src/config/scoring.json` - Scoring thresholds
- `packages/tcl-core/src/config/templates.json` - Issue templates
- `packages/tcl-core/src/config/taxonomy.json` - Category taxonomy
- `packages/tcl-core/src/engine/config/types.ts` - Truth engine config

