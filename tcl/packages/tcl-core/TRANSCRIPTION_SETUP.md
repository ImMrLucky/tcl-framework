# Audio Transcription Setup

## Free Local Transcription (100% Self-Contained) ✅

The transcription service uses **local Whisper models** - **completely free, self-contained, no API keys needed, no external services!**

### How It Works

- Uses `@xenova/transformers` (already installed)
- Runs Whisper model locally on your server
- First run downloads the model (~1.5GB for tiny, ~3GB for base)
- Subsequent runs are fast and free
- Works offline, no internet required

### Model Options

Set `WHISPER_MODEL` environment variable to choose model:

```bash
# Tiny (fastest, smallest, ~1.5GB) - DEFAULT
export WHISPER_MODEL=Xenova/whisper-tiny

# Base (better quality, ~3GB)
export WHISPER_MODEL=Xenova/whisper-base

# Small (good balance, ~6GB)
export WHISPER_MODEL=Xenova/whisper-small

# Medium (high quality, ~12GB)
export WHISPER_MODEL=Xenova/whisper-medium

# Large (best quality, ~24GB)
export WHISPER_MODEL=Xenova/whisper-large-v2
```

**Recommendation:** Start with `whisper-tiny` for testing, upgrade to `whisper-base` or `whisper-small` for production.

### First Run

On first transcription, the model will download automatically:
```
Loading Whisper model: Xenova/whisper-tiny...
Downloading model files...
Transcribing audio...
```

This is a one-time download. Subsequent runs are instant.

## 100% Self-Contained

- ✅ No API keys required
- ✅ No external service calls
- ✅ No costs ever
- ✅ Works completely offline (after first model download)
- ✅ All processing happens on your server

## Performance Comparison

| Model | Speed | Cost | Quality | Size |
|-------|-------|------|---------|------|
| **whisper-tiny** | Fast | Free | Good | ~1.5GB |
| **whisper-base** | Medium | Free | Very Good | ~3GB |
| **whisper-small** | Slower | Free | Excellent | ~6GB |
| **whisper-medium** | Slow | Free | Excellent | ~12GB |
| **whisper-large-v2** | Very Slow | Free | Best | ~24GB |

## Requirements

- **No requirements!** Works out of the box.
- Just install dependencies: `npm install`
- Model downloads automatically on first use
- **Works in Docker/containers** - Uses WASM backend (no native dependencies needed)

## Troubleshooting

### "Error loading shared library ld-linux-x86-64.so.2" (Docker/Container)
- **Fixed!** The service now uses WASM backend automatically
- No native libraries required
- Works in any Docker/container environment
- If you still see this error, ensure you're using the latest code

### "Model download failed"
- Check internet connection (needed for first download only)
- Check disk space (models are 1.5GB - 24GB depending on size)
- Try a smaller model

### "Transcription too slow"
- Use a smaller model (`whisper-tiny` or `whisper-base`)
- Consider using GPU if available (set `device: 'gpu'` in code)
- For very large files, consider OpenAI API

### "Out of memory"
- Use a smaller model
- Process shorter audio files
- Increase server memory

## No API Key Needed! 🎉

**100% free and self-contained** - just start the server and upload audio files. The model downloads automatically on first use. No external services, no API keys, no costs ever!

