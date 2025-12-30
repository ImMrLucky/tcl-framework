# Quick Test: Audio Ingestion

## Setup (One-time)

1. **Install dependencies:**
   ```bash
   cd packages/tcl-core
   npm install
   ```

2. **Optional: Choose Whisper model size (default: whisper-tiny):**
   ```bash
   # No API key needed! Uses free local Whisper (100% self-contained)
   # Optional: Choose model size for better quality
   export WHISPER_MODEL=Xenova/whisper-base  # or whisper-small, whisper-medium
   ```

3. **Start backend:**
   ```bash
   cd packages/tcl-core
   npm run dev
   ```
   Should see: "Server running on port 8787"

4. **Start frontend (in another terminal):**
   ```bash
   cd packages/tcl-ui
   npm start
   ```
   Should open: `http://localhost:4200`

## Quick Test Steps

### Option 1: Frontend UI (Easiest)

1. Go to: `http://localhost:4200/ingest`
2. Click "Upload File"
3. Select an audio file (.wav, .mp3, .flac, or .m4a)
4. You should see:
   - File name with "(Audio - will be transcribed)" indicator
5. Fill in:
   - Title (optional): "Test Audio"
   - Channel: "call"
6. Click "Transcribe & Analyze"
7. Wait for transcription (10-60 seconds)
8. Transcript should appear, then analysis runs automatically

### Option 2: cURL (Direct API)

```bash
# Replace with your actual API key
export TCL_API_KEY=your-api-key-here

# Test with a WAV file
./packages/tcl-core/test-audio.sh test.wav

# Or manually:
curl -X POST http://localhost:8787/transcribe \
  -H "X-API-Key: $TCL_API_KEY" \
  -F "audio=@test.wav" \
  -F "filename=test.wav"
```

## What to Check

✅ **Success indicators:**
- File uploads without error
- "Transcribing audio file..." message appears
- Transcript text appears in textarea
- Analysis runs and shows results page

❌ **Common issues:**

1. **"Model download failed" (first run only)**
   - Check internet connection (needed to download model once)
   - Check disk space (models are 1.5GB - 24GB)
   - Wait for download to complete (one-time, ~1-5 minutes)

2. **"Model download failed" (first run only)**
   - Check internet connection (needed to download model once)
   - Check disk space (models are 1.5GB - 24GB)
   - Wait for download to complete (one-time, ~1-5 minutes)

2. **"Authorization required"**
   - Make sure you're logged in (frontend)
   - Or provide API key header (API)

3. **"Invalid file type"**
   - Use .wav, .mp3, .flac, or .m4a files
   - Check file extension is correct

4. **Transcription fails**
   - First run: Wait for model download (one-time, ~1-5 minutes)
   - Check file size (no hard limit for local, but larger files take longer)
   - Check audio file isn't corrupted
   - Try a smaller Whisper model: `export WHISPER_MODEL=Xenova/whisper-tiny`

## Test Files

You can use any audio file in these formats:
- `.wav` - WAV format
- `.mp3` - MP3 format
- `.flac` - FLAC format
- `.m4a` - M4A/AAC format

**Note:** Keep test files under 25MB for OpenAI Whisper API.

## Expected Flow

1. Upload audio file → File selected
2. Click "Transcribe & Analyze" → Transcription starts
   - **First time:** Model downloads (~1-5 minutes, one-time)
   - **Subsequent:** Transcription starts immediately
3. Transcription completes → Transcript appears
4. Analysis runs → Results page shown

## 100% Free & Self-Contained! 🎉

The transcription service uses **free local Whisper models** - completely self-contained, no API keys, no external services, no costs ever! Works offline after first model download.

## Debugging

**Backend logs:**
- Watch console for file upload confirmation
- Check for OpenAI API calls
- Look for error messages

**Frontend console (F12):**
- Network tab: Check `/transcribe` request
- Console: Check for errors
- Response: Should contain `transcript` field

## Next Steps

Once audio ingestion works:
- Test different audio formats
- Test different file sizes
- Move to OAuth connectors

