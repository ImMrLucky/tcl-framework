import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuditService } from '../audit.service';
import { TclService } from '../tcl.service';
import { AuthService } from '../auth.service';

// Note: extractClaims is used client-side for now
// In production, this should be done server-side via an API endpoint
type Claim = {
  id: string;
  text: string;
  confidence: number;
  evidence: any[];
  meta?: {
    speaker?: 'Agent' | 'Customer' | 'Other';
    turnIndex?: number;
  };
};

@Component({
  selector: 'app-ingestion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    AppHeaderComponent
  ],
  templateUrl: './ingestion.component.html',
  styleUrls: ['./ingestion.component.scss']
})
export class IngestionComponent implements OnInit {
  transcript = '';
  title = '';
  channel: 'call' | 'chat' | 'email' | 'other' = 'call';
  loading = false;
  errorMessage = '';
  selectedFile: File | null = null;
  selectedFileName = '';
  isAudioFile = false;
  transcriptionInProgress = false;

  constructor(
    private auditService: AuditService,
    private tclService: TclService,
    private router: Router,
    private snackBar: MatSnackBar,
    private authService: AuthService
  ) {}

  ngOnInit() {
    // Component initialization
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.selectedFile = file;
      this.selectedFileName = file.name;
      
      // Check if it's an audio file
      const audioExtensions = ['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.opus', '.aac'];
      const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
      this.isAudioFile = audioExtensions.includes(fileExt);
      
      if (this.isAudioFile) {
        // For audio files, we'll transcribe on submit
        this.transcript = '';
        this.snackBar.open('Audio file selected. Transcription will occur when you submit.', 'Close', { duration: 4000 });
      } else {
        // For text files, read directly
        try {
          const text = await file.text();
          this.transcript = text;
          this.snackBar.open('File loaded successfully', 'Close', { duration: 3000 });
        } catch (error: any) {
          this.errorMessage = `Failed to read file: ${error.message}`;
          this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
        }
      }
    }
  }

  async onSubmit() {
    // If audio file is selected, transcribe it first
    if (this.isAudioFile && this.selectedFile) {
      console.log('Audio file detected, starting transcription...');
      await this.transcribeAudio();
      if (!this.transcript || this.transcript.trim().length === 0) {
        console.log('Transcription failed or returned empty result');
        return; // Error already shown in transcribeAudio
      }
      console.log('Transcription successful, transcript length:', this.transcript.length);
    }

    if (!this.transcript || this.transcript.trim().length === 0) {
      this.errorMessage = 'Please enter or upload a transcript, or select an audio file';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    try {
      // Step 1: Create conversation using new REST endpoint
      const createResponse = await this.auditService.createConversation({
        title: this.title || this.selectedFileName || undefined,
        content: this.transcript,
        metadata: {
          channel: this.channel,
          source_file: this.selectedFileName || null,
          is_audio: this.isAudioFile
        }
      }).toPromise();

      if (!createResponse || !createResponse.conversation) {
        throw new Error('Failed to create conversation');
      }

      const conversationId = createResponse.conversation.id;

      // Step 2: Extract claims from transcript
      // Note: We're using the extractClaims function directly here
      // In a real implementation, you might want to call an API endpoint
      // that does this server-side, but for now we'll do it client-side
      const claims = this.extractClaimsFromTranscript(this.transcript);

      if (claims.length === 0) {
        throw new Error('No claims extracted from transcript');
      }

      // Step 2: Trigger evaluation using /validate endpoint with conversation_id
      // The backend will extract claims and run the evaluation
      const apiUrl = this.auditService['apiBase'];
      const validateResponse = await fetch(`${apiUrl}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: this.transcript,
          answer: '',
          sources: [],
          options: {},
          conversation_id: conversationId
        })
      });

      if (!validateResponse.ok) {
        const errorData = await validateResponse.json();
        throw new Error(errorData.error || 'Failed to run evaluation');
      }

      const evaluationData = await validateResponse.json();
      
      // Step 3: Get the evaluation ID from the response or fetch it from conversation
      // The evaluation should be linked to the conversation now
      // We'll navigate to the conversation evaluations page
      // First, wait a moment for the evaluation to be saved
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get evaluations for this conversation
      const evaluationsResponse = await this.auditService.getConversationEvaluations(conversationId, { limit: 1 }).toPromise();
      
      if (evaluationsResponse && evaluationsResponse.evaluations && evaluationsResponse.evaluations.length > 0) {
        // Navigate to the most recent evaluation
        this.router.navigate(['/evaluations', evaluationsResponse.evaluations[0].id]);
      } else {
        // Fallback: navigate to conversation page
        this.router.navigate(['/conversations', conversationId]);
      }
    } catch (error: any) {
      console.error('Ingestion error:', error);
      this.errorMessage = error.error?.error || error.message || 'An unexpected error occurred';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
    } finally {
      this.loading = false;
    }
  }

  /**
   * Extract claims from transcript text
   * This is a simplified client-side extraction
   * In production, this should be done server-side via an API endpoint
   */
  private extractClaimsFromTranscript(text: string): Claim[] {
    // Use the same logic as the backend claim extractor
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const claims: Claim[] = [];
    let claimIdx = 1;
    let turnIdx = 0;

    for (const ln of lines) {
      let speaker: 'Agent' | 'Customer' | 'Other' = 'Other';
      let body = ln;

      if (/^agent:/i.test(ln)) {
        speaker = 'Agent';
        body = ln.replace(/^agent:\s*/i, '');
      } else if (/^customer:/i.test(ln)) {
        speaker = 'Customer';
        body = ln.replace(/^customer:\s*/i, '');
      } else if (/^(rep|caller):/i.test(ln)) {
        speaker = 'Agent';
        body = ln.replace(/^(rep|caller):\s*/i, '');
      }

      if (body.length > 0) {
        // Split into sentences
        const sentences = body
          .replace(/\s+/g, ' ')
          .split(/(?<=[.!?])\s+/)
          .map(s => s.trim())
          .filter(s => s.length > 0 && s.length >= 10); // Skip very short sentences

        for (const sentence of sentences) {
          // Skip filler phrases
          const fillerPatterns = /^(thanks|thank you|okay|ok|yes|no|sure|alright|uh|um|hmm)/i;
          if (fillerPatterns.test(sentence.trim()) && sentence.length < 30) continue;

          claims.push({
            id: `c${claimIdx++}`,
            text: sentence,
            confidence: 0.75,
            evidence: [],
            meta: {
              speaker,
              turnIndex: turnIdx
            }
          });
        }
        turnIdx++;
      }
    }

    return claims;
  }

  /**
   * Transcribe audio file
   */
  async transcribeAudio(): Promise<void> {
    if (!this.selectedFile) {
      this.errorMessage = 'No audio file selected';
      return;
    }

    this.transcriptionInProgress = true;
    this.errorMessage = '';

    try {
      // Get session token for authentication
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated. Please log in.');
      }

      const apiUrl = this.auditService['apiBase'];
      console.log('Transcribing audio file:', this.selectedFile.name, 'API URL:', `${apiUrl}/transcribe`);
      
      const formData = new FormData();
      formData.append('audio', this.selectedFile);
      formData.append('filename', this.selectedFile.name);

      // Don't set Content-Type header - browser will set it automatically with boundary for FormData
      const headers: HeadersInit = {
        'Authorization': `Bearer ${accessToken}`
      };

      console.log('Sending transcription request...');
      const response = await fetch(`${apiUrl}/transcribe`, {
        method: 'POST',
        headers: headers,
        body: formData
      });

      console.log('Transcription response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Transcription failed with status ${response.status}` }));
        throw new Error(errorData.error || 'Transcription failed');
      }

      const result = await response.json();
      console.log('Transcription result:', result);
      
      this.transcript = result.transcript || result.text || '';
      
      if (!this.transcript || this.transcript.trim().length === 0) {
        throw new Error('Transcription returned empty result');
      }

      this.snackBar.open('Audio transcribed successfully', 'Close', { duration: 3000 });
    } catch (error: any) {
      console.error('Transcription error:', error);
      this.errorMessage = error.message || 'Failed to transcribe audio';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
    } finally {
      this.transcriptionInProgress = false;
    }
  }
}

