# Running TCL UI Locally

This guide will help you run the TCL UI along with the required backend services.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Python 3.8+ (for Spectral service - optional but recommended)
- OpenAI API key (optional, for LLM adapter features)

## Step-by-Step Setup

### 1. Install TCL Core Dependencies

```bash
cd packages/tcl-core
npm install
```

### 2. (Optional) Install TCL Spectral Service

If you want to use Spectral analysis (recommended):

```bash
cd packages/tcl-spectral
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Install TCL UI Dependencies

```bash
cd packages/tcl-ui
npm install
```

## Running the Services

You'll need to run multiple services. Open separate terminal windows/tabs for each:

### Terminal 1: TCL Spectral Service (Optional)

```bash
cd packages/tcl-spectral
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

The Spectral service will run on `http://localhost:8080`

### Terminal 2: TCL Core Service

```bash
cd packages/tcl-core

# Set environment variables (optional)
export OPENAI_API_KEY="your-key-here"  # Only if using LLM adapter
export TCL_SPECTRAL_URL="http://localhost:8080"  # Only if running Spectral

npm run dev
```

The Core service will run on `http://localhost:8787`

### Terminal 3: TCL UI

```bash
cd packages/tcl-ui
npm start
```

The UI will run on `http://localhost:4200` and automatically open in your browser.

## Quick Start (All Services)

If you want to run everything at once, you can use this script:

```bash
# In the root directory
cd packages/tcl-core && npm install && cd ../..
cd packages/tcl-ui && npm install && cd ../..

# Then in separate terminals:
# Terminal 1: Spectral (optional)
cd packages/tcl-spectral && source .venv/bin/activate && uvicorn app.main:app --port 8080

# Terminal 2: Core
cd packages/tcl-core && npm run dev

# Terminal 3: UI
cd packages/tcl-ui && npm start
```

## Using the UI

1. Open `http://localhost:4200` in your browser
2. Enter a question in the Input panel
3. Enter a model answer
4. (Optional) Add source documents
5. Toggle validation options:
   - **Spectral**: Enable spectral coherence analysis (requires Spectral service)
   - **ANN**: Use Approximate Nearest Neighbor for graph building
   - **Cache**: Cache semantic scoring results
6. Click "Validate" to see results

## Troubleshooting

### UI can't connect to Core service
- Make sure TCL Core is running on port 8787
- Check the browser console for errors
- Verify the proxy configuration in `proxy.conf.json`

### Spectral errors
- Make sure the Spectral service is running on port 8080
- Set `TCL_SPECTRAL_URL=http://localhost:8080` environment variable
- Or disable Spectral in the UI if you don't need it

### Port conflicts
- TCL Core: Change port in `packages/tcl-core/src/server/express.ts` (default: 8787)
- TCL UI: Change port with `ng serve --port 4201`
- TCL Spectral: Change port in uvicorn command (default: 8080)

### Angular CLI not found
```bash
cd packages/tcl-ui
npm install -g @angular/cli
# Or use npx: npx ng serve
```

## Development Notes

- The UI proxies `/api/*` requests to `http://localhost:8787` automatically
- Hot reload is enabled for both Core and UI during development
- Check browser console and terminal logs for debugging

