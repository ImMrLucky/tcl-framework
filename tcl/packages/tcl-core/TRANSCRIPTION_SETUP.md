# Audio Transcription Setup Guide

This document describes how to set up and configure the audio transcription service using whisper.cpp + VAD.

## Overview

The transcription service uses:
- **whisper.cpp**: C++ implementation of OpenAI's Whisper model for ASR
- **ffmpeg**: For audio normalization and VAD (Voice Activity Detection) preprocessing
- **VAD**: Removes silence/non-speech before transcription for faster, cleaner results

## Environment Variables

### Required

- `WHISPERCPP_BIN`: Path to whisper.cpp binary (default: `./vendor/whispercpp/main`)
- `WHISPERCPP_MODEL`: Path to Whisper model file (default: `./models/ggml-small.en.bin`)
- `FFMPEG_BIN`: Path to ffmpeg binary (default: `ffmpeg`)

### Optional

- `WHISPERCPP_THREADS`: Number of threads for whisper.cpp (default: `2`)
- `WHISPERCPP_LANGUAGE`: Language code (default: `en`, use `auto` for auto-detection)
- `WHISPERCPP_ARGS`: Additional whisper.cpp command-line arguments
- `ASR_MAX_CONCURRENCY`: Maximum concurrent transcriptions (default: `1`)
- `VAD_MODE`: VAD mode (default: `silenceremove`)
- `VAD_SILENCE_THRESHOLD_DB`: Silence threshold in dB (default: `-35`)
- `VAD_MIN_SILENCE_SEC`: Minimum silence duration to remove (default: `0.35`)
- `VAD_KEEP_SILENCE_SEC`: Silence to keep at start/end (default: `0.2`)
- `DEBUG_ASR`: Set to `1` to enable debug logging

## Model Selection

Whisper models are available in different sizes:

- **tiny**: ~75MB, fastest, lowest accuracy (good for testing/quick demos)
- **base**: ~142MB (default), good balance of speed and accuracy
- **small**: ~466MB, better accuracy but slower
- **medium**: ~1.5GB, high accuracy
- **large**: ~3GB, best accuracy

Models are available at: https://huggingface.co/ggerganov/whisper.cpp

To use a different model:
1. Download the model file (e.g., `ggml-base.en.bin`)
2. Set `WHISPERCPP_MODEL` to the path of the downloaded model

## Docker Setup

The Dockerfile automatically:
1. Installs ffmpeg and build tools
2. Compiles whisper.cpp from source
3. Downloads the default model (`ggml-small.en.bin`)

To build:
```bash
docker build -t tcl-core .
```

To customize the model, modify the Dockerfile:
```dockerfile
# Change this line in Dockerfile:
RUN cd /app/models && \
    wget -q https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin && \
    ls -lh /app/models/
```

## Local Development Setup

### Prerequisites

1. **ffmpeg**: Install via package manager
   ```bash
   # macOS
   brew install ffmpeg
   
   # Ubuntu/Debian
   sudo apt-get install ffmpeg
   ```

2. **whisper.cpp**: Build from source or download binary
   ```bash
   git clone https://github.com/ggerganov/whisper.cpp.git
   cd whisper.cpp
   make
   # Binary will be at: whisper.cpp/main
   ```

3. **Whisper Model**: Download a model file
   ```bash
   mkdir -p models
   cd models
   wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
   ```

### Configuration

Create a `.env` file in `packages/tcl-core/`:
```bash
WHISPERCPP_BIN=./vendor/whispercpp/main
WHISPERCPP_MODEL=./models/ggml-small.en.bin
WHISPERCPP_THREADS=2
WHISPERCPP_LANGUAGE=en
FFMPEG_BIN=ffmpeg
ASR_MAX_CONCURRENCY=1
```

Or set environment variables:
```bash
export WHISPERCPP_BIN=/path/to/whisper.cpp/main
export WHISPERCPP_MODEL=/path/to/models/ggml-small.en.bin
```

## Verification

### Test ffmpeg
```bash
ffmpeg -version
```

### Test whisper.cpp
```bash
./vendor/whispercpp/main -h
```

### Test transcription endpoint
```bash
curl -X POST http://localhost:8787/api/transcribe \
  -F "audio=@test-audio.wav" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected response:
```json
{
  "transcript": "Hello world",
  "text": "Hello world",
  "language": "en",
  "durationMs": 5000,
  "vadStats": {
    "originalDurationMs": 5000,
    "speechDurationMs": 3000,
    "removedMs": 2000,
    "mode": "silenceremove"
  }
}
```

## Troubleshooting

### Error: "Failed to spawn ffmpeg"
- Ensure ffmpeg is installed and in PATH
- Set `FFMPEG_BIN` to full path if needed

### Error: "Failed to spawn whisper.cpp"
- Check `WHISPERCPP_BIN` path is correct
- Ensure binary has execute permissions: `chmod +x /path/to/main`

### Error: "Model file not found"
- Verify `WHISPERCPP_MODEL` path is correct
- Ensure model file exists and is readable

### Error: "ASR_BUSY" (429)
- Transcription is CPU-intensive; only one concurrent job is allowed by default
- Increase `ASR_MAX_CONCURRENCY` if you have multiple CPU cores (not recommended for production)

### Slow transcription
- Use a smaller model (tiny/base instead of small/medium/large)
- Increase `WHISPERCPP_THREADS` (but not more than CPU cores)
- VAD preprocessing should help by removing silence

## API Endpoint

### POST /api/transcribe

**Request:**
- Content-Type: `multipart/form-data`
- Field name: `audio`
- File: Audio file (wav, mp3, flac, m4a, ogg, opus, aac, ulaw, alaw)

**Response:**
```typescript
{
  transcript: string;        // Full transcript text
  text?: string;            // Alias for transcript (backward compat)
  language?: string;         // Detected language
  durationMs?: number;       // Audio duration in milliseconds
  segments?: Array<{         // Optional: time-aligned segments
    startMs: number;
    endMs: number;
    text: string;
  }>;
  vadStats?: {               // Optional: VAD statistics
    originalDurationMs: number;
    speechDurationMs: number;
    removedMs: number;
    mode: 'silenceremove' | 'failed_fallback';
  };
}
```

**Error Responses:**
- `400`: No audio file provided
- `401`: Authorization required
- `429`: Transcription worker is busy (ASR_BUSY)
- `500`: Transcription failed

## Performance Notes

- **VAD preprocessing**: Removes silence, typically reducing audio length by 20-40%, resulting in faster transcription
- **Concurrency**: Default is 1 concurrent transcription to prevent CPU overload
- **Model size**: Larger models are more accurate but slower
- **Threads**: More threads = faster, but don't exceed CPU cores

## Railway Deployment

The Dockerfile is configured for Railway deployment:
1. Builds whisper.cpp from source
2. Downloads default model during build
3. Installs ffmpeg
4. Sets environment variables

No additional configuration needed - just deploy!
