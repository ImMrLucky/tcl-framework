# Audio Transcription Environment Variables

## Required Environment Variables

To use audio transcription in serverless environments (Netlify Functions, Railway, etc.), you **MUST** set these environment variables:

```bash
USE_WASM=1
ONNXRUNTIME_DISABLE_NATIVE=1
TRANSFORMERS_USE_WASM=1
USE_BROWSER=0
USE_WASM_ONLY=1
ONNXRUNTIME_EXECUTION_PROVIDERS=
ONNXRUNTIME_USE_WASM=1
ONNXRUNTIME_USE_WEB=1
```

## Why These Are Required

The audio transcription service uses `@xenova/transformers` with Whisper models. By default, this library tries to use `onnxruntime-node` (native Node.js bindings), which requires system libraries like `ld-linux-x86-64.so.2` that are not available in serverless environments.

Setting these environment variables forces the library to use **WASM-only mode**, which works in any environment without native dependencies.

## Setting Environment Variables

### Railway (TCL Core Backend)

Since your TCL Core service runs on Railway, set these variables there:

1. Go to your Railway project dashboard
2. Click on your **TCL Core** service
3. Go to **Variables** tab
4. Add all the variables listed above (with `ONNXRUNTIME_EXECUTION_PROVIDERS` set to blank/empty)
5. The service will automatically restart

**Important**: These variables need to be set in Railway (where your backend runs), not in Netlify.

### Netlify (Frontend Only)

If you're running transcription through Netlify Functions (not recommended due to timeout limits), you would set them in Netlify:

1. Go to your Netlify dashboard
2. Navigate to **Site settings** → **Environment variables**
3. Add all the variables listed above
4. Redeploy your site

**Note**: For audio transcription, it's better to call your Railway backend directly to avoid Netlify's 30-second function timeout.

### Local Development

Create a `.env` file in `packages/tcl-core/`:

```bash
USE_WASM=1
ONNXRUNTIME_DISABLE_NATIVE=1
TRANSFORMERS_USE_WASM=1
USE_BROWSER=0
USE_WASM_ONLY=1
ONNXRUNTIME_EXECUTION_PROVIDERS=
ONNXRUNTIME_USE_WASM=1
ONNXRUNTIME_USE_WEB=1
```

**Note**: `ONNXRUNTIME_EXECUTION_PROVIDERS` should be set to an **empty string** (no value after the `=`). This disables all native execution providers and forces WASM-only mode.

Or set them when running:

```bash
USE_WASM=1 ONNXRUNTIME_DISABLE_NATIVE=1 TRANSFORMERS_USE_WASM=1 npm run dev
```

## Verifying Configuration

After setting environment variables, check the logs when transcribing audio. You should see:

```
Loading Whisper model: Xenova/whisper-tiny...
WASM mode: 1, DISABLE_NATIVE: 1
```

If you see errors about `ld-linux-x86-64.so.2` or `onnxruntime-node`, the environment variables are not set correctly.

## Troubleshooting

**Error: "Error loading shared library ld-linux-x86-64.so.2"**

- This means native libraries are being loaded
- Verify all environment variables are set
- Check that they're set in the deployment environment (not just locally)
- Restart/redeploy the service after setting variables

**Error: "onnxruntime-node is disabled"**

- This is expected - it means WASM mode is working
- The transcription should still proceed using WASM

**Transcription is slow**

- WASM mode is slower than native, but works everywhere
- Consider using a smaller model: `WHISPER_MODEL=Xenova/whisper-tiny` (default)
- For faster transcription, use a dedicated server with native libraries

