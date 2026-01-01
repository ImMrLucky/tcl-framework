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
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuditService } from '../audit.service';
import { TclService } from '../tcl.service';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// Normalized turn from backend
interface NormalizedTurn {
  turnIndex: number;
  participantId: string;
  role: 'agent' | 'customer' | 'supervisor' | 'bot' | 'unknown';
  speakerLabel: string;
  text: string;
  startTimeMs?: number;
  lineStart?: number;
  meta?: any;
}

// Preview response from /api/ingest/preview
interface IngestPreview {
  success: boolean;
  warnings?: string[];
  preview?: {
    turnsCount: number;
    participantsCount: number;
    participants: Array<{ displayName: string; role: string }>;
    sampleTurns: Array<{
      turnIndex: number;
      speakerLabel: string;
      role: string;
      text: string;
    }>;
  };
  normalized?: any;
}

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
    MatTabsModule,
    MatTableModule,
    MatChipsModule,
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
  isSubtitleFile = false;
  transcriptionInProgress = false;
  
  // Preview state
  showPreview = false;
  previewData: IngestPreview | null = null;
  previewLoading = false;
  
  // Audio + transcript linking
  audioFile: File | null = null;
  audioFileName = '';
  transcriptFile: File | null = null;
  transcriptFileName = '';
  linkingMode = false;

  // Supported formats
  readonly audioExtensions = ['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.opus', '.aac'];
  readonly subtitleExtensions = ['.vtt', '.srt'];
  readonly textExtensions = ['.txt', '.csv', '.json', '.vtt', '.srt'];

  constructor(
    private auditService: AuditService,
    private tclService: TclService,
    private router: Router,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private http: HttpClient
  ) {}

  ngOnInit() {
    // Component initialization
  }

  /**
   * Get file extension
   */
  private getFileExtension(filename: string): string {
    return '.' + (filename.split('.').pop()?.toLowerCase() || '');
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.selectedFile = file;
      this.selectedFileName = file.name;
      
      const fileExt = this.getFileExtension(file.name);
      this.isAudioFile = this.audioExtensions.includes(fileExt);
      this.isSubtitleFile = this.subtitleExtensions.includes(fileExt);
      
      // Reset preview
      this.showPreview = false;
      this.previewData = null;
      
      if (this.isAudioFile) {
        // For audio files, we'll transcribe on submit
        this.transcript = '';
        this.snackBar.open('Audio file selected. Transcription will occur when you submit.', 'Close', { duration: 4000 });
      } else {
        // For text/subtitle files, read and preview
        try {
          const text = await file.text();
          this.transcript = text;
          this.snackBar.open('File loaded successfully', 'Close', { duration: 3000 });
          
          // Auto-preview for supported formats
          if (this.textExtensions.includes(fileExt)) {
            await this.previewNormalization();
          }
        } catch (error: any) {
          this.errorMessage = `Failed to read file: ${error.message}`;
          this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
        }
      }
    }
  }

  /**
   * Handle audio file selection for linking mode
   */
  async onAudioFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const fileExt = this.getFileExtension(file.name);
      
      if (this.audioExtensions.includes(fileExt)) {
        this.audioFile = file;
        this.audioFileName = file.name;
        this.snackBar.open('Audio file selected for linking', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Please select a valid audio file', 'Close', { duration: 3000 });
      }
    }
  }

  /**
   * Handle transcript file selection for linking mode
   */
  async onTranscriptFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const fileExt = this.getFileExtension(file.name);
      
      if (this.textExtensions.includes(fileExt)) {
        this.transcriptFile = file;
        this.transcriptFileName = file.name;
        
        // Read and preview
        const text = await file.text();
        this.transcript = text;
        await this.previewNormalization();
        
        this.snackBar.open('Transcript file loaded for linking', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Please select a valid transcript file', 'Close', { duration: 3000 });
      }
    }
  }

  /**
   * Preview normalization without saving
   */
  async previewNormalization() {
    if (!this.transcript && !this.selectedFile) return;
    
    this.previewLoading = true;
    
    try {
      const apiUrl = this.auditService.getApiBaseUrl();
      const content = this.transcript;
      const filename = this.selectedFileName || 'transcript.txt';
      
      // Convert to base64 for API
      const base64Content = btoa(unescape(encodeURIComponent(content)));
      
      const result = await firstValueFrom(
        this.http.post<IngestPreview>(`${apiUrl}/ingest/preview`, {
          content: base64Content,
          filename
        })
      );
      
      this.previewData = result;
      this.showPreview = true;
      
      if (result.warnings && result.warnings.length > 0) {
        this.snackBar.open(`Preview ready (${result.warnings.length} warnings)`, 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Preview error:', error);
      // Don't show error for preview failures, just hide preview
      this.showPreview = false;
    } finally {
      this.previewLoading = false;
    }
  }

  /**
   * Toggle linking mode
   */
  toggleLinkingMode() {
    this.linkingMode = !this.linkingMode;
    if (!this.linkingMode) {
      this.audioFile = null;
      this.audioFileName = '';
      this.transcriptFile = null;
      this.transcriptFileName = '';
    }
  }

  async onSubmit() {
    // Handle linking mode separately
    if (this.linkingMode) {
      await this.submitLinkedFiles();
      return;
    }
    
    // If audio file is selected, transcribe it first
    if (this.isAudioFile && this.selectedFile) {
      await this.transcribeAudio();
      if (!this.transcript || this.transcript.trim().length === 0) {
        return;
      }
    }

    if (!this.transcript || this.transcript.trim().length === 0) {
      this.errorMessage = 'Please enter or upload a transcript, or select an audio file';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    try {
      const apiUrl = this.auditService.getApiBaseUrl();
      const filename = this.selectedFileName || 'transcript.txt';
      
      // Step 1: Use new /api/ingest endpoint for normalization
      const base64Content = btoa(unescape(encodeURIComponent(this.transcript)));
      
      const ingestResponse = await firstValueFrom(
        this.http.post<{
          success: boolean;
          conversationId?: string;
          artifactId?: string;
          normalized?: any;
          warnings?: string[];
          error?: string;
        }>(`${apiUrl}/ingest`, {
          content: base64Content,
          filename,
          title: this.title || filename,
          runEvaluation: false // We'll run evaluation separately
        })
      );

      if (!ingestResponse.success || !ingestResponse.conversationId) {
        throw new Error(ingestResponse.error || 'Failed to ingest file');
      }

      const conversationId = ingestResponse.conversationId;
      const artifactId = ingestResponse.artifactId;

      // Show normalization warnings if any
      if (ingestResponse.warnings && ingestResponse.warnings.length > 0) {
        console.warn('Normalization warnings:', ingestResponse.warnings);
      }

      // Step 2: Run evaluation with /validate endpoint
      // The normalized data is now stored, pass artifact reference
      const evaluationData = await firstValueFrom(
        this.http.post<any>(`${apiUrl}/validate`, {
          question: this.transcript,
          answer: '',
          sources: [],
          options: {
            spectral: true,
            spectralMode: 'analyze',
            includeConfidenceMetrics: true,
            includeSuggestions: true,
            artifactId // Pass artifact ID for evidence linking
          },
          conversation_id: conversationId
        })
      );
      
      // Step 3: Navigate to evaluation results
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const evaluationsResponse = await firstValueFrom(
        this.auditService.getConversationEvaluations(conversationId, { limit: 1 })
      );
      
      if (evaluationsResponse?.evaluations?.length > 0) {
        this.router.navigate(['/evaluations', evaluationsResponse.evaluations[0].id]);
      } else {
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
   * Submit linked audio + transcript files
   */
  async submitLinkedFiles() {
    if (!this.audioFile || !this.transcriptFile) {
      this.errorMessage = 'Please select both an audio file and a transcript file';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    try {
      const apiUrl = this.auditService.getApiBaseUrl();
      
      // Step 1: Ingest transcript first
      const transcriptContent = await this.transcriptFile.text();
      const base64Content = btoa(unescape(encodeURIComponent(transcriptContent)));
      
      const transcriptResponse = await firstValueFrom(
        this.http.post<{
          success: boolean;
          conversationId?: string;
          artifactId?: string;
          error?: string;
        }>(`${apiUrl}/ingest`, {
          content: base64Content,
          filename: this.transcriptFileName,
          title: this.title || `Linked: ${this.audioFileName}`,
          runEvaluation: false
        })
      );

      if (!transcriptResponse.success || !transcriptResponse.conversationId) {
        throw new Error(transcriptResponse.error || 'Failed to ingest transcript');
      }

      const conversationId = transcriptResponse.conversationId;

      // Step 2: Link audio file to the same conversation
      const audioFormData = new FormData();
      audioFormData.append('audio', this.audioFile);
      audioFormData.append('filename', this.audioFileName);
      audioFormData.append('conversationId', conversationId);
      audioFormData.append('linkToTranscript', 'true');

      // Store audio metadata (not the full file for now)
      const audioArrayBuffer = await this.audioFile.arrayBuffer();
      const audioBase64 = btoa(
        new Uint8Array(audioArrayBuffer.slice(0, 1000)) // Just header for metadata
          .reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      await firstValueFrom(
        this.http.post<any>(`${apiUrl}/ingest`, {
          content: audioBase64,
          filename: this.audioFileName,
          conversationId, // Link to existing conversation
          title: this.title || this.audioFileName,
          runEvaluation: false
        })
      );

      this.snackBar.open('Audio and transcript linked successfully', 'Close', { duration: 3000 });

      // Step 3: Run evaluation
      await firstValueFrom(
        this.http.post<any>(`${apiUrl}/validate`, {
          question: transcriptContent,
          answer: '',
          sources: [],
          options: {
            spectral: true,
            spectralMode: 'analyze',
            includeConfidenceMetrics: true,
            includeSuggestions: true
          },
          conversation_id: conversationId
        })
      );

      // Navigate to results
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const evaluationsResponse = await firstValueFrom(
        this.auditService.getConversationEvaluations(conversationId, { limit: 1 })
      );
      
      if (evaluationsResponse?.evaluations?.length > 0) {
        this.router.navigate(['/evaluations', evaluationsResponse.evaluations[0].id]);
      } else {
        this.router.navigate(['/conversations', conversationId]);
      }
    } catch (error: any) {
      console.error('Linking error:', error);
      this.errorMessage = error.error?.error || error.message || 'Failed to link files';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
    } finally {
      this.loading = false;
    }
  }

  /**
   * Transcribe audio file
   */
  async transcribeAudio(): Promise<void> {
    if (!this.selectedFile) {
      this.errorMessage = 'No audio file selected';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      return;
    }

    this.transcriptionInProgress = true;
    this.errorMessage = '';

    // Authorization header is now automatically added by AuthInterceptor
    // No need to manually check for token here - interceptor will handle it
    const apiUrl = this.auditService.getApiBaseUrl();
    const fullUrl = `${apiUrl}/transcribe`;
    
    const formData = new FormData();
    formData.append('audio', this.selectedFile);
    formData.append('filename', this.selectedFile.name);

    // Authorization header is now automatically added by AuthInterceptor
    // No need to manually set it here
    try {
      const result = await firstValueFrom(
        this.http.post<{ transcript?: string; text?: string }>(fullUrl, formData)
      );
      
      this.transcript = result.transcript || result.text || '';
      
      if (!this.transcript || this.transcript.trim().length === 0) {
        this.errorMessage = 'Transcription returned empty result';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
        return;
      }

      this.snackBar.open('Audio transcribed successfully', 'Close', { duration: 3000 });
    } catch (error: any) {
      this.errorMessage = error.error?.error || error.message || 'Failed to transcribe audio';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
    } finally {
      this.transcriptionInProgress = false;
    }
  }
}

