# TCL UI (ProtectQA Experience)

Angular app for **ProtectQA** and broader **Conversation Truth & Risk Intelligence** — compliance, drift, hallucination posture, disclosures, speaker confidence, evidence gaps, business insights (`dashboardSummary`), and client risk labels (`risk`). Not positioning as coaching-only tooling.

Powered by TCL Core `@/validate`, evaluation history (`/evaluations/:id`), and ingest workflows.

## Features

- **Input Panel**: Paste transcripts or Q+A with validation toggles (Spectral, ANN, Cache)
- **Summary Panel**: **TCL / ProtectQA primary score**, optional extended metrics (truth vs transcript grounding, compliance, hallucination safety, drift, evidence support…), API `risk` strip, coherence/consistency legacy fields
- **Claim Table**: Displays all claims with their grounded status, support/contradiction counts, and cycle information
- **Graph View**: Interactive D3.js visualization showing claim relationships with colored edges:
  - Green → support
  - Red → contradiction  
  - Dashed blue → grounding
  - Highlights ungrounded cycles and instability contributors

## Setup

```bash
cd packages/tcl-ui
npm install
npm start
```

The app will run on `http://localhost:4200` (default Angular dev server port).

## Configuration

The UI expects the TCL Core service to be running on `http://localhost:8787`. The Angular dev server is configured to proxy `/api/*` requests to the TCL Core service.

Make sure both services are running:
1. TCL Core: `cd packages/tcl-core && npm run dev` (runs on port 8787)
2. TCL Spectral (if using): `cd packages/tcl-spectral && uvicorn app.main:app --port 8080`
3. TCL UI: `cd packages/tcl-ui && npm start` (runs on port 4200)

## Architecture

The UI is decoupled from the TCL framework and communicates via HTTP API calls to the `/validate` endpoint. This allows the framework to remain independent and the UI to be easily replaced or extended.

## Components

- `InputPanelComponent`: Form for question, answer, sources, and validation options
- `SummaryPanelComponent`: Coherence score display, flags, and overall status
- `ClaimTableComponent`: Material table showing claim details
- `GraphViewComponent`: D3.js force-directed graph visualization

