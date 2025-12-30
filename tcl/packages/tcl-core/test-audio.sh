#!/bin/bash

# Quick test script for audio transcription endpoint
# Usage: ./test-audio.sh <audio-file> [api-key]

AUDIO_FILE=$1
API_KEY=${2:-$TCL_API_KEY}

if [ -z "$AUDIO_FILE" ]; then
  echo "Usage: ./test-audio.sh <audio-file> [api-key]"
  echo "Example: ./test-audio.sh test.wav sk-..."
  exit 1
fi

if [ ! -f "$AUDIO_FILE" ]; then
  echo "Error: File not found: $AUDIO_FILE"
  exit 1
fi

if [ -z "$API_KEY" ]; then
  echo "Error: API key required. Set TCL_API_KEY or pass as second argument"
  exit 1
fi

echo "Testing audio transcription for: $AUDIO_FILE"
echo "Sending to: http://localhost:8787/transcribe"
echo ""

curl -X POST http://localhost:8787/transcribe \
  -H "X-API-Key: $API_KEY" \
  -F "audio=@$AUDIO_FILE" \
  -F "filename=$(basename $AUDIO_FILE)" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -v

echo ""
echo "Test complete!"

