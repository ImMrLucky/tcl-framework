# TCL Application Overview

## Table of Contents
1. [High-Level Architecture](#high-level-architecture)
2. [Core Purpose](#core-purpose)
3. [Technology Stack](#technology-stack)
4. [Database Schema](#database-schema)
5. [Backend Architecture](#backend-architecture)
6. [Frontend Architecture](#frontend-architecture)
7. [Authentication & Authorization](#authentication--authorization)
8. [Plan Tiers & Entitlements](#plan-tiers--entitlements)
9. [Key Features](#key-features)
10. [Data Flow](#data-flow)
11. [API Structure](#api-structure)
12. [Recent Additions](#recent-additions)

---

## High-Level Architecture

TCL (Trust & Compliance Layer) is a **conversation analysis and compliance platform** that:

1. **Ingests** audio recordings and transcripts from various sources
2. **Analyzes** conversations using NLP (Natural Language Processing) and graph-based analysis
3. **Identifies** compliance issues, contradictions, and risk factors
4. **Tracks** evidence, decisions, signoffs, and audit trails
5. **Exports** audit-grade reports for legal defensibility

### Architecture Pattern
- **Monorepo** structure using TypeScript
- **Backend**: Node.js/Express.js API server (`tcl-core`)
- **Frontend**: Angular 17+ SPA (`tcl-ui`)
- **Database**: Supabase (PostgreSQL with RLS)
- **Storage**: Supabase Storage for audio files and artifacts
- **NLP**: Custom entity extraction + spaCy microservice (`tcl-nlp`)

---

## Core Purpose

TCL helps organizations:
- **Monitor** customer service interactions for compliance
- **Detect** policy violations, contradictions, and risk factors
- **Maintain** audit trails for legal defensibility
- **Track** issue resolution with decisions and signoffs
- **Export** comprehensive audit packs for regulators

### Primary Use Cases
1. **Call Center QA**: Analyze customer service calls for compliance
2. **Compliance Monitoring**: Track adherence to policies and regulations
3. **Risk Management**: Identify and escalate high-risk interactions
4. **Audit Preparation**: Generate defensible audit reports
5. **Batch Processing**: Ingest and analyze large volumes of conversations

---

## Technology Stack

### Backend (`tcl-core`)
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **NLP**: Custom regex + spaCy (Python microservice)
- **File Processing**: Multer, yauzl (ZIP parsing)
- **PDF Generation**: PDFKit
- **Archiving**: Archiver (ZIP creation)

### Frontend (`tcl-ui`)
- **Framework**: Angular 17+ (standalone components)
- **UI Library**: Angular Material
- **State Management**: RxJS Observables
- **HTTP Client**: Angular HttpClient
- **Routing**: Angular Router

### Infrastructure
- **Database**: Supabase PostgreSQL with Row Level Security (RLS)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage buckets
- **Deployment**: Railway (backend), Vercel/Netlify (frontend)

---

## Database Schema

### Core Tables

#### Organizations & Users
- **`organizations`**: Multi-tenant org structure
- **`org_members`**: User membership with roles (OWNER, ADMIN, MANAGER, ANALYST, VIEWER)
- **`profiles`**: User profile information
- **`org_entitlements`**: Feature flags per organization (Enterprise features)

#### Conversations & Evaluations
- **`conversations`**: Raw conversation transcripts with metadata
- **`evaluations`**: Analysis results (claims, issues, graph)
- **`conversation_artifacts`**: Linked files (audio, transcripts, evidence)
- **`representatives`**: Business representatives (for attribution)
- **`projects`**: Project grouping for conversations
- **`project_envs`**: Environment isolation (sandbox/production)

#### Analysis & Issues
- **`issues`**: Detected compliance issues and risk factors
- **`issue_decisions`**: Decisions made on issues (APPROVED, REJECTED, DEFERRED)
- **`issue_decision_events`**: Audit trail of decision changes
- **`issue_signoffs`**: Reviewer signoffs on issues
- **`issue_snapshots`**: Point-in-time snapshots for legal hold
- **`issue_locks`**: Locks to prevent modifications

#### Evidence & Compliance
- **`evidence`**: Policy documents, guidelines, reference materials
- **`cases`**: Collections of related issues for investigation
- **`case_issues`**: Many-to-many relationship between cases and issues

#### Ingestion
- **`ingestion_jobs`**: Single file ingestion jobs
- **`ingestion_batches`**: Batch ingestion operations
- **`ingestion_batch_items`**: Individual items in a batch
- **`ingest_imports`**: Batch upload imports (ZIP, JSONL, CSV)
- **`ingest_import_items`**: Per-file results from batch imports
- **`ingest_sources`**: Data sources for scheduled ingestion (S3, Dropbox, GDrive, GCS, Azure Blob, SFTP, Manifest URL)
  - Stores source configuration in `config_json` (credentials, bucket, path, etc.)
  - Supports connection testing
- **`ingest_schedules`**: Scheduled ingestion jobs with recurrence rules (RRULE)
  - Links to `ingest_sources`
  - Supports template and representative assignment
  - Tracks `next_run_at` for execution timing
- **`ingest_schedule_runs`**: Execution history for schedules
  - Stores stats (new files, parsed, failed)
  - Links to `ingest_imports` for detailed results
- **`ingest_objects`**: Deduplication tracking for processed objects
  - Tracks object keys, ETags, hashes per source
  - Prevents reprocessing of already-ingested files

#### Integrations
- **`enterprise_integrations`**: Integration configurations (Jira, Webhooks)
- **`integration_secrets`**: Encrypted credentials for integrations
- **`integration_exports`**: Export history for integrations
- **`webhook_deliveries`**: Webhook delivery logs

#### Exports & Audit
- **`exports`**: Export ledger (tracks all exports for audit)

#### Templates & Scoring
- **`templates`**: Conversation analysis templates
- **`scoring_profiles`**: Custom scoring configurations

---

## Backend Architecture

### Directory Structure (`tcl-core/src/server/`)

```
server/
├── express.ts              # Main Express app setup
├── supabase.ts             # Supabase client and utilities
├── auth-context.ts         # Authentication middleware
├── plans/                  # Plan tier management
├── entitlements/           # Feature entitlement system
├── permissions/            # Role-based permissions
├── ingest/                 # Single file ingestion
│   ├── jobs.ts            # Job creation
│   ├── worker.ts          # Background job processing
│   └── storage-supabase.ts # Storage utilities
├── ingestion/             # Batch ingestion system
│   ├── batch-upload-routes.ts    # Batch file upload API
│   ├── scheduled-routes.ts       # Scheduled ingestion API (sources & schedules CRUD)
│   ├── scheduler-worker.ts       # Background scheduler (executes schedules)
│   ├── canonical-transcript.ts   # Canonical format
│   ├── canonical-to-conversation.ts # Conversion logic
│   ├── batch-config.ts           # Configuration
│   ├── config-routes.ts          # Config API
│   └── parsers/                  # Format parsers
│       ├── zip-parser.ts
│       ├── jsonl-parser.ts
│       └── csv-batch-parser.ts
├── batch-ingestion/        # Legacy batch system (connectors)
├── connectors/             # Storage connectors (S3, Dropbox, GDrive)
├── conversations/          # Conversation CRUD
├── evaluations/            # Evaluation management
├── issues/                # Issue management
│   ├── routes.ts          # Issue CRUD
│   ├── decisions-routes.ts # Decision API
│   ├── signoffs-routes.ts  # Signoff API
│   └── snapshots-routes.ts # Snapshot API
├── cases/                  # Case management
├── evidence/               # Evidence library
├── exports/                # Export generation
│   └── audit-pack.ts      # Audit pack ZIP generation
├── integrations/           # Integration framework
│   ├── webhooks-routes.ts # Webhook delivery
│   └── jira-routes.ts     # Jira ticket creation
├── representatives/        # Representative management
├── admin/                  # Admin endpoints
└── nlp/                    # NLP utilities
    ├── entity-extractor.ts # Entity extraction
    └── spacy-client.ts     # spaCy microservice client
```

### Key Backend Services

#### 1. **Ingestion Pipeline**
- **Single File**: `/api/ingest` - Upload audio/transcript, normalize, create conversation
- **Batch Upload**: `/api/ingest/batch/upload` - Upload ZIP/JSONL/CSV, parse, create conversations
- **Manual Connector Batch**: Browse S3/Dropbox/GDrive, select files, create batch immediately
- **Scheduled**: Background worker polls schedules, downloads from sources, processes automatically

#### 2. **Analysis Pipeline**
- **Graph Building**: Extracts claims, builds semantic graph, identifies contradictions
- **Issue Detection**: Analyzes graph for compliance violations and risk factors
- **NLP Integration**: Uses regex patterns + spaCy for entity extraction and coreference

#### 3. **Enterprise Features**
- **Decisions**: Track issue decisions with audit trail
- **Signoffs**: Reviewer approval workflow
- **Cases**: Group related issues for investigation
- **Snapshots**: Point-in-time captures for legal hold
- **Locks**: Prevent modifications to locked issues

#### 4. **Export System**
- **Audit Packs**: ZIP files with JSON summaries, issues, decisions, signoffs, snapshots
- **Formats**: JSON, CSV, PDF, HTML
- **Ledger**: Tracks all exports for audit compliance

---

## Frontend Architecture

### Directory Structure (`tcl-ui/src/app/`)

```
app/
├── shared/
│   ├── app-header.component.ts    # Global header with plan badge
│   └── add-representative-dialog.component.ts
├── features/
│   └── feature.service.ts          # Unified feature checking
├── dashboard/                     # Main dashboard
├── ingestion/                     # Single file ingestion page
├── batch-ingestion/               # Batch ingestion UI
│   ├── batch-ingestion.component.ts
│   ├── batch-ingestion.service.ts
│   ├── batch-upload.service.ts
│   ├── batch-import-results.component.ts
│   ├── scheduled-ingestion.component.ts
│   ├── create-source-dialog.component.ts
│   └── create-schedule-dialog.component.ts
├── evaluations/                   # Evaluations list and detail
├── issues/                        # Issues list and detail
├── cases/                         # Cases list and detail
├── evidence-library/             # Evidence management
├── integrations/                  # Integrations hub
├── admin/                         # Admin dashboard
├── account/                       # Account/plan management
├── auth/                          # Authentication
├── plan.service.ts                # Plan context management
├── entitlements.service.ts        # Entitlement checking
└── auth.interceptor.ts            # HTTP interceptor for auth headers
```

### Key Frontend Services

#### 1. **PlanService**
- Manages plan context (tier, limits, usage)
- Loads from `/api/me` endpoint
- Caches in memory, updates on navigation

#### 2. **EntitlementsService**
- Checks enterprise feature availability
- Loads from `/api/entitlements` or `/api/me`
- Caches in sessionStorage

#### 3. **FeatureService**
- Unified service combining plan capabilities + entitlements
- Provides `hasFeature(key)` for UI gating
- Defines all features with metadata

#### 4. **AuthInterceptor**
- Adds `Authorization` header (Bearer token)
- Adds `X-Active-Org-Id` header from localStorage
- Handles 401 errors (redirects to login)

---

## Authentication & Authorization

### Authentication Flow
1. User logs in via Supabase Auth (email/password or OAuth)
2. Frontend receives session token
3. Token stored in localStorage
4. All API requests include `Authorization: Bearer <token>` header

### Organization Context
- Users can belong to multiple organizations
- `activeOrgId` stored in localStorage
- API requests include `X-Active-Org-Id` header
- Backend uses this to determine org context

### Authorization Layers

#### 1. **Row Level Security (RLS)**
- Database-level policies enforce access
- Users can only see data from orgs they're members of
- Policies check `org_members` table

#### 2. **Role-Based Permissions**
- **OWNER**: Full access
- **ADMIN**: Full access except billing
- **MANAGER**: Can manage issues, cases, evidence
- **ANALYST**: Can create evaluations, view issues
- **VIEWER**: Read-only access

#### 3. **Plan Tiers**
- **SANDBOX**: Free tier, limited features
- **TEAM/DEVELOPER**: Paid tier, more features
- **ENTERPRISE**: Full feature set, governance features

#### 4. **Entitlements**
- Feature flags per organization
- Stored in `org_entitlements` table
- Checked via `requireEntitlement` middleware

---

## Plan Tiers & Entitlements

### Plan Tiers

#### SANDBOX (Free)
- Limited evaluations per day
- Basic issue detection
- No batch ingestion
- No enterprise features

#### TEAM/DEVELOPER (Paid)
- Higher evaluation limits
- Batch ingestion (file upload)
- Basic integrations
- No governance features

#### ENTERPRISE (Paid)
- Unlimited evaluations
- Scheduled batch ingestion
- Full governance suite:
  - Issue decisions
  - Reviewer signoffs
  - Cases
  - Legal hold (snapshots)
  - Advanced audit packs
- Full integrations (Jira, Webhooks)
- Connectors (S3, Dropbox, Google Drive)

### Entitlements System
- **Database**: `org_entitlements` table
- **Backend**: `EntitlementsService` with in-memory cache
- **Frontend**: `EntitlementsService` with sessionStorage cache
- **Middleware**: `requireEntitlement` for API protection

### Feature Gating
- **UI**: `FeatureService.hasFeature()` checks both plan capabilities and entitlements
- **Navigation**: Menu items hidden based on features
- **Buttons**: Disabled/hidden based on features
- **Upgrade Prompts**: Shown when limits hit or features blocked

---

## Key Features

### 1. Conversation Ingestion
- **Single Upload**: Audio files (MP3, WAV, M4A) or transcripts (TXT, JSON, VTT, SRT)
- **Batch Upload**: ZIP files, JSONL, CSV with automatic parsing and per-file status tracking
- **Manual Connector Batch**: 
  - Browse S3, Dropbox, Google Drive with file browser
  - Test connections before browsing
  - Select files and create batch immediately
  - Real-time progress tracking
- **Scheduled Ingestion**: 
  - Configure data sources (S3, Dropbox, GDrive, GCS, Azure Blob, SFTP, Manifest URL)
  - Create recurring schedules (hourly/daily/weekly/custom RRULE)
  - Automatic file discovery and deduplication
  - Execution history with detailed stats
- **Transcription**: Audio files transcribed using Whisper.cpp + VAD

### 2. Analysis Engine
- **Entity Extraction**: Regex patterns + spaCy for NER
- **Graph Building**: Semantic graph of claims with relationships
- **Contradiction Detection**: Identifies conflicting statements
- **Issue Generation**: Creates compliance issues from graph analysis
- **Slot Canonicalization**: Registry system for consistent slot mapping

### 3. Issue Management
- **Issue List**: Filterable, sortable list of all issues
- **Issue Detail**: Full context, evidence, related issues
- **Decisions**: Track decisions (APPROVED, REJECTED, DEFERRED)
- **Signoffs**: Reviewer approval workflow
- **Snapshots**: Point-in-time captures for legal hold
- **Locks**: Prevent modifications to locked issues

### 4. Cases
- **Case Creation**: Group related issues for investigation
- **Case Management**: Add/remove issues, track status
- **Case Export**: Export case as JSON or PDF/ZIP

### 5. Evidence Library
- **Evidence Upload**: Policy documents, guidelines, reference materials
- **Evidence Linking**: Link evidence to issues
- **Evidence Verification**: Compare conversations against evidence

### 6. Integrations
- **Webhooks**: Outbound webhooks for issue events
- **Jira**: Create Jira tickets from issues
- **API Keys**: Programmatic access via API keys

### 7. Exports
- **Audit Packs**: Comprehensive ZIP files with:
  - Executive summary
  - Issues list
  - Decisions history
  - Signoffs
  - Snapshots
  - Evidence manifest
  - Checksums for integrity
- **Formats**: JSON, CSV, PDF, HTML
- **Presets**: AUDIT, LEGAL_HOLD, CUSTOMER_DISPUTE

### 8. Batch Ingestion
- **File Upload**: ZIP, JSONL, CSV with format parsing
- **Connector Browsers**: Browse S3, Dropbox, Google Drive with file selection
- **Manual Batch Creation**: Select files from connectors, create batch immediately
- **Scheduled Ingestion**: Recurring jobs (hourly/daily/weekly/custom RRULE)
  - **Data Sources**: Configure S3, Dropbox, Google Drive, GCS, Azure Blob, SFTP, Manifest URL
  - **Schedules**: Create recurring ingestion jobs with frequency, templates, representatives
  - **Run History**: View execution history with stats and import links
- **Deduplication**: Tracks processed objects to avoid duplicates
- **Progress Tracking**: Real-time progress for batch operations

---

## Data Flow

### 1. Ingestion Flow
```
User uploads file
  ↓
Backend creates ingestion_job
  ↓
Worker processes job:
  - Downloads/reads file
  - Normalizes to canonical format
  - Creates conversation record
  - Stores artifacts (audio/transcript)
  ↓
If analyzeImmediately:
  - Builds semantic graph
  - Extracts claims
  - Detects issues
  - Creates evaluation record
```

### 2. Analysis Flow
```
Conversation created
  ↓
Analysis triggered (manual or automatic)
  ↓
Graph building:
  - Entity extraction (regex + spaCy)
  - Claim extraction
  - Slot canonicalization
  - Relationship detection
  ↓
Issue detection:
  - Contradiction analysis
  - Policy violation checking
  - Risk factor identification
  ↓
Evaluation created with:
  - Claims graph
  - Issues list
  - Risk scores
```

### 3. Batch Upload Flow
```
User uploads ZIP/JSONL/CSV
  ↓
Backend creates ingest_import record
  ↓
Parser extracts transcripts:
  - ZIP: Extracts and pairs audio/transcript
  - JSONL: Parses each line
  - CSV: Groups by conversation_id
  ↓
Creates canonical transcripts
  ↓
Converts to conversations
  ↓
Creates ingest_import_items with status
  ↓
Returns import_id for tracking
```

### 4. Scheduled Ingestion Flow
```
User creates data source (S3/Dropbox/GDrive/etc.)
  - Configures credentials and settings
  - Tests connection
  ↓
User creates schedule
  - Selects data source
  - Sets frequency (hourly/daily/weekly/custom RRULE)
  - Configures template, representative, mode
  - Schedule saved with next_run_at calculated
  ↓
Scheduler worker runs (every minute)
  ↓
Checks for schedules with next_run_at <= now AND enabled = true
  ↓
For each due schedule:
  - Loads source configuration
  - Lists objects from source using connector provider
  - Filters out already processed (checks ingest_objects table)
  - Downloads new objects
  - Parses (ZIP/JSONL/CSV) based on file type
  - Creates conversations from canonical transcripts
  - Updates ingest_objects with processed status
  - Creates ingest_import record for tracking
  - Creates ingest_schedule_run record with stats
  ↓
Updates schedule next_run_at based on RRULE
```

### 5. Manual Connector Batch Flow
```
User navigates to /bulk-ingest
  ↓
User selects connector tab (S3/Dropbox/GDrive)
  ↓
User enters credentials and clicks "Connect"
  - Frontend calls POST /api/connectors/:type/test
  - Backend tests connection using connector provider
  ↓
If successful, frontend calls GET /api/connectors/:type/list
  - Backend lists objects from connector
  - Returns files and folders
  ↓
User browses and selects files
  ↓
User clicks "Create Batch"
  - Frontend calls POST /api/connectors/:type/batch-from-selection
  - Backend creates ingestion_batches record
  - Backend creates ingestion_batch_items for each selected file
  ↓
User navigates to batch detail page
  ↓
User clicks "Start Batch" (or auto-starts)
  - Backend enqueues batch for processing
  - Background worker processes items concurrently
  - Downloads files, creates conversations, enqueues analysis
  ↓
UI polls batch status to show progress
```

---

## API Structure

### Authentication Endpoints
- `GET /api/me` - Get current user, org, plan context, entitlements
- `GET /api/entitlements` - Get entitlements for current org

### Ingestion Endpoints
- `POST /api/ingest` - Single file ingestion
- `POST /api/ingest/jobs` - Create ingestion job
- `POST /api/ingest/batch/upload` - Batch file upload
- `GET /api/ingest/batch/:importId` - Get import details
- `GET /api/ingest/batch/:importId/items` - Get import items
- `GET /api/config/ingestion` - Get ingestion configuration

### Scheduled Ingestion Endpoints
- `GET /api/ingest/sources` - List data sources
- `POST /api/ingest/sources` - Create data source
- `PUT /api/ingest/sources/:id` - Update data source
- `PATCH /api/ingest/sources/:id` - Partial update data source
- `DELETE /api/ingest/sources/:id` - Delete data source
- `POST /api/ingest/sources/:id/test` - Test source connection
- `GET /api/ingest/schedules` - List schedules
- `POST /api/ingest/schedules` - Create schedule
- `PATCH /api/ingest/schedules/:id` - Update schedule
- `DELETE /api/ingest/schedules/:id` - Delete schedule
- `GET /api/ingest/schedules/:id/runs` - Get schedule run history

### Conversation Endpoints
- `GET /api/conversations` - List conversations
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/:id` - Get conversation details

### Evaluation Endpoints
- `GET /api/evaluations` - List evaluations
- `GET /api/evaluations/:id` - Get evaluation details
- `POST /api/evaluations/:id/analyze` - Trigger analysis

### Issue Endpoints
- `GET /api/issues` - List issues
- `GET /api/issues/:id` - Get issue details
- `PATCH /api/issues/:id` - Update issue
- `POST /api/issues/:id/decisions` - Create decision
- `GET /api/issues/:id/decisions/history` - Get decision history
- `POST /api/issues/:id/signoffs` - Create signoff
- `POST /api/issues/:id/snapshots` - Create snapshot
- `POST /api/issues/:id/lock` - Lock issue
- `POST /api/issues/:id/unlock` - Unlock issue

### Case Endpoints
- `GET /api/cases` - List cases
- `POST /api/cases` - Create case
- `GET /api/cases/:id` - Get case details
- `PATCH /api/cases/:id` - Update case
- `POST /api/cases/:id/issues` - Add issue to case

### Export Endpoints
- `GET /api/evaluations/:id/export/json` - Export evaluation as JSON
- `GET /api/evaluations/:id/export/csv` - Export evaluation as CSV
- `GET /api/evaluations/:id/export/issues-v2/pdf` - Export issues as PDF
- `GET /api/cases/:id/export` - Export case (JSON or PDF/ZIP)
- `POST /api/audit-packs/generate` - Generate audit pack

### Integration Endpoints
- `GET /api/integrations` - List integrations
- `POST /api/integrations` - Create integration
- `POST /api/integrations/:id/webhooks/test` - Test webhook
- `POST /api/integrations/:id/jira/tickets` - Create Jira ticket

---

## Recent Additions

### Batch Upload System (SPEC 1)
- **Purpose**: Allow users to upload multiple files in batch formats (ZIP, JSONL, CSV)
- **Components**:
  - `batch-upload-routes.ts`: API for file uploads
  - Parsers: `zip-parser.ts`, `jsonl-parser.ts`, `csv-batch-parser.ts`
  - `canonical-transcript.ts`: Standardized transcript format
  - `canonical-to-conversation.ts`: Conversion logic
  - `batch-import-results.component.ts`: UI for viewing results
- **Database**: `ingest_imports`, `ingest_import_items` tables
- **Features**:
  - Multi-format parsing
  - Per-file status tracking
  - Error reporting
  - Progress tracking

### Scheduled Ingestion (SPEC 2) - COMPLETED
- **Purpose**: Automatically ingest new files from cloud storage on a schedule
- **Components**:
  - `scheduled-routes.ts`: API for sources and schedules (CRUD operations)
  - `scheduler-worker.ts`: Background worker that executes schedules
  - `scheduled-ingestion.component.ts`: UI for managing sources and schedules
  - `create-source-dialog.component.ts`: Dialog for creating/editing data sources
  - `create-schedule-dialog.component.ts`: Dialog for creating/editing schedules
- **Database**: `ingest_sources`, `ingest_schedules`, `ingest_schedule_runs`, `ingest_objects` tables
- **Features**:
  - Multiple source types (S3, Dropbox, Google Drive, GCS, Azure Blob, SFTP, Manifest URL)
  - Source configuration with credentials (stored in `config_json`)
  - Connection testing for sources
  - Recurrence rules (hourly/daily/weekly/custom RRULE)
  - Schedule management (create, update, delete, enable/disable)
  - Template and representative assignment per schedule
  - Deduplication tracking via `ingest_objects` table
  - Run history with stats (new files, parsed, failed)
  - Links to import results from schedule runs
- **UI Features**:
  - Three-tab interface: Data Sources, Schedules, Run History
  - Source creation/editing with type-specific configuration forms
  - Schedule creation with frequency selection and RRULE support
  - Real-time schedule status (enabled/disabled)
  - Schedule run history with detailed stats

### Slot Registry System
- **Purpose**: Eliminate "unknown" slots and improve consistency
- **Components**:
  - `slot-registry.ts`: Registry loader
  - `slot-registry.global.json`: Global slot definitions
  - `slot-registry.templates.json`: Template-specific slots
- **Features**:
  - Canonical slot mapping
  - Equivalence sets
  - Edge eligibility metadata
  - Improved contradiction detection

### Representative Attribution
- **Purpose**: Track business representatives independently of transcript speaker labels
- **Components**:
  - `representatives` table
  - `speaker-role-mapper.ts`: Role normalization
  - Representative selection in UI
- **Features**:
  - Representative management
  - Speaker role normalization (REPRESENTATIVE, CUSTOMER, THIRD_PARTY, UNKNOWN)
  - Attribution in claims and issues

---

## Environment Variables

### Backend
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for admin operations
- `__TCL_API_URL`: API base URL (for frontend)
- `TCL_NLP_URL`: spaCy microservice URL (default: http://localhost:8081)
- `ENABLE_SPACY`: Enable spaCy integration (true/false)
- `BATCH_INGESTION_CONCURRENCY`: Concurrent batch items (default: 5)
- `BATCH_ITEM_MAX_RETRIES`: Max retries for failed items (default: 3)
- `PORT`: Server port (default: 8787)

### Frontend
- `__TCL_API_URL`: API base URL
- `__SUPABASE_ANON_KEY`: Supabase anonymous key

---

## Development Workflow

### Running Locally
1. **Backend**: `cd tcl/packages/tcl-core && npm run dev`
2. **Frontend**: `cd tcl/packages/tcl-ui && npm start`
3. **spaCy Service** (optional): `cd tcl/packages/tcl-nlp && uvicorn app.main:app --reload --port 8081`

### Database Migrations
- Migrations in `tcl/supabase/sql/`
- Run via Supabase CLI or dashboard
- Numbered sequentially (e.g., `042_batch_imports.sql`)

### Testing
- Backend: Vitest (`npm test`)
- Frontend: Angular testing framework

---

## Key Design Decisions

1. **Multi-tenancy**: Organizations isolate data via RLS policies
2. **Role-based Access**: Permissions matrix defines what each role can do
3. **Plan Tiers**: Feature gating based on subscription tier
4. **Entitlements**: Additional feature flags for enterprise features
5. **Canonical Formats**: Standardized transcript format for consistency
6. **Graph-based Analysis**: Semantic graph enables contradiction detection
7. **Audit Trail**: All actions logged for compliance
8. **Export Ledger**: Tracks all exports for audit requirements

---

## Future Enhancements

- **Advanced Scheduling**: More flexible recurrence rules (cron expressions) - Currently supports RRULE
- **More Connectors**: Azure Blob, SFTP, Webhook manifest URLs - Currently supports S3, Dropbox, Google Drive, GCS, Azure Blob, SFTP, Manifest URL
- **Real-time Processing**: WebSocket updates for batch progress
- **Advanced NLP**: More sophisticated entity extraction and coreference
- **Custom Templates**: User-defined analysis templates
- **API Webhooks**: Inbound webhooks for external integrations
- **Advanced Analytics**: Dashboards and reporting
- **Credential Encryption**: Encrypt source credentials in `ingest_sources.config_json` (currently stored as plain JSON)
- **Connection Validation**: Enhanced connection testing with detailed error messages

---

## Support & Maintenance

### Logging
- Backend: Console logging with structured format
- Frontend: Console logging for debugging
- Database: Audit logs in `audit_logs` table (if implemented)

### Error Handling
- Backend: Try-catch with error responses
- Frontend: Error interceptors with user-friendly messages
- Database: RLS policies prevent unauthorized access

### Performance
- Backend: In-memory caching for entitlements
- Frontend: SessionStorage caching for entitlements
- Database: Indexes on frequently queried columns
- Batch Processing: Concurrent processing with configurable limits

---

This document should be updated as the application evolves. For specific implementation details, refer to the code comments and inline documentation.

