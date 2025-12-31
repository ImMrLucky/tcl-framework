# Transcription in Docker/Containers

## WASM Backend (No Native Dependencies)

The transcription service automatically uses **WASM backend** to avoid native library dependencies. This means:

✅ **Works in Docker** - No need for native libraries  
✅ **Works in containers** - No system dependencies  
✅ **Works in serverless** - Pure JavaScript/WASM  
✅ **Cross-platform** - Works on any architecture  

## How It Works

The service automatically:
1. Sets `USE_WASM=1` environment variable
2. Disables native ONNX runtime
3. Uses pure WASM backend (no native bindings)
4. Works in any Node.js environment

## No Configuration Needed

The WASM mode is **automatic** - no configuration required. The service detects the environment and uses WASM backend to avoid native dependency issues.

## Performance

WASM backend is slightly slower than native, but:
- ✅ Works everywhere (Docker, containers, serverless)
- ✅ No installation issues
- ✅ Reliable and portable
- ✅ Still fast enough for production use

## If You Still See Native Library Errors

1. **Check you're using latest code** - WASM mode was added to fix this
2. **Clear node_modules and reinstall:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
3. **Verify environment variables are set:**
   ```bash
   # These should be set automatically, but you can verify:
   echo $USE_WASM  # Should be '1'
   ```

## Alternative: Use Native Backend (Optional)

If you want native performance and have the libraries available:

```bash
# Don't set USE_WASM (or set to '0')
unset USE_WASM
```

But WASM is recommended for Docker/containers to avoid dependency issues.

