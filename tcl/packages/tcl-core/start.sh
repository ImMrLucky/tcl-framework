#!/bin/sh
# Startup script that sets WASM-only environment variables before starting the server
# This prevents onnxruntime-node from trying to load native bindings

export USE_WASM=1
export ONNXRUNTIME_EXECUTION_PROVIDERS=""
export ONNXRUNTIME_DISABLE_NATIVE=1
export TRANSFORMERS_USE_WASM=1
export USE_BROWSER=0
export USE_WASM_ONLY=1

# Start the server
exec node dist/server/express.js

