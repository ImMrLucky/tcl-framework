# TCL UI

Angular-based UI for demonstrating the TCL (Truth & Consistency Layer) framework.

## Features

- **Input Panel**: Enter questions, answers, and optional sources with validation toggles (Spectral, ANN, Cache)
- **Summary Panel**: Shows coherence score (0-100), flags (contradictions, ungrounded claims, circular reasoning), and Pass/Warn/Fail status
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

