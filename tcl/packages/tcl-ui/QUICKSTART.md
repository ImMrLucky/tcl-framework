# Quick Start Guide

## Minimal Setup (No Spectral)

If you just want to test the UI without Spectral analysis:

### Terminal 1: Core Service
```bash
cd packages/tcl-core
npm install  # First time only
npm run dev
```

### Terminal 2: UI
```bash
cd packages/tcl-ui
npm install  # First time only
npm start
```

Then open `http://localhost:4200` in your browser.

## Full Setup (With Spectral)

### Terminal 1: Spectral Service
```bash
cd packages/tcl-spectral
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8080
```

### Terminal 2: Core Service
```bash
cd packages/tcl-core
export TCL_SPECTRAL_URL="http://localhost:8080"
npm run dev
```

### Terminal 3: UI
```bash
cd packages/tcl-ui
npm start
```

## What You'll See

1. **Input Panel** (left top): Enter question, answer, and optional sources
2. **Summary Panel** (left bottom): Coherence score, flags, and Pass/Warn/Fail status
3. **Claim Table** (right top): All claims with metadata
4. **Graph View** (right bottom): Interactive D3.js visualization

## Example Test

Try this in the UI:
- **Question**: "What is the capital of France?"
- **Answer**: "Paris is the capital of France. It is located in the north of the country."
- **Sources** (optional): Add a source document
- Click "Validate"

