# Testing Audio Ingestion

## Prerequisites

1. **Install dependencies:**
   ```bash
   cd packages/tcl-core
   npm install
   ```

2. **Set environment variable:**
   ```bash
   export OPENAI_API_KEY=your_openai_api_key_here
   ```
   Or add it to your `.env` file in `packages/tcl-core/`

3. **Start the backend:**
   ```bash
   cd packages/tcl-core
   npm run dev
   ```
   The server should start on port 8787 (or your configured port)

4. **Start the frontend:**
   ```bash
   cd packages/tcl-ui
   npm start
   ```
   The frontend should start on port 4200 (or your configured port)

## Testing Steps

### 1. Prepare Test Audio Files

You'll need audio files in these formats:
- `.wav` - WAV format
- `.mp3` - MP3 format  
- `.flac` - FLAC format
- `.m4a` - M4A/AAC format

**Note:** Keep files under 100MB for testing. The API has a 25MB limit for OpenAI Whisper.

### 2. Test via Frontend UI

1. Navigate to `http://localhost:4200/ingest` (or your frontend URL)
2. Click "Upload File" button
3. Select an audio file (.wav, .mp3, .flac, or .m4a)
4. You should see:
   - File name displayed
   - "(Audio - will be transcribed)" indicator
5. Fill in optional fields:
   - Title (optional)
   - Channel (call/chat/email/other)
6. Click "Transcribe & Analyze" button
7. You should see:
   - "Transcribing audio file..." progress indicator
   - Then the transcript will appear in the text area
   - Then it will automatically run analysis and navigate to results

### 3. Test via cURL (Direct API)

Test the transcription endpoint directly:

```bash
# Replace with your actual API key and org/project context
curl -X POST http://localhost:8787/transcribe \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "X-API-Key: YOUR_API_KEY" \
  -F "audio=@/path/to/your/audio.wav" \
  -F "filename=test.wav"
```

**Note:** You'll need proper authentication headers. Check your API key setup.

### 4. Expected Behavior

✅ **Success:**
- Audio file is uploaded
- Transcription happens (may take 10-60 seconds depending on file size)
- Transcript appears in the text area
- Analysis runs automatically
- Results page shows evaluation

❌ **Common Issues:**

1. **"OPENAI_API_KEY not configured"**
   - Set the `OPENAI_API_KEY` environment variable
   - Restart the backend server

2. **"Invalid file type"**
   - Make sure file extension is one of: .wav, .mp3, .flac, .m4a
   - Check file isn't corrupted

3. **"Transcription failed"**
   - Check OpenAI API key is valid
   - Check file size (must be < 25MB for OpenAI)
   - Check audio file isn't corrupted
   - Check network connectivity to OpenAI API

4. **"No audio file provided"**
   - Make sure you're sending the file in the `audio` form field
   - Check file input is working in browser

### 5. Test Different Formats

Try each format:
- `.wav` - Should work
- `.mp3` - Should work
- `.flac` - Should work
- `.m4a` - Should work

All should transcribe successfully if the audio is valid.

## Debugging

### Check Backend Logs

Watch the backend console for:
- File upload confirmation
- Transcription API calls
- Any error messages

### Check Frontend Console

Open browser DevTools (F12) and check:
- Network tab for API calls
- Console for any errors
- Check `/transcribe` endpoint response

### Test Transcription Service Directly

You can test the transcription service in isolation:

```typescript
import { transcribeAudio } from './server/transcription.js';
import fs from 'fs';

const audioBuffer = fs.readFileSync('test.wav');
const result = await transcribeAudio(audioBuffer, 'test.wav');
console.log(result.transcript);
```

## Next Steps

After confirming audio ingestion works:
1. Test with different audio qualities
2. Test with different languages (if supported)
3. Test file size limits
4. Move on to OAuth connectors

