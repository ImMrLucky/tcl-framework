import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
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
    MatProgressBarModule,
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
export class IngestionComponent implements OnInit, OnDestroy {
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

  // Job-based ingestion state
  currentJobId: string | null = null;
  jobStatus: 'UPLOADED' | 'TRANSCRIBING' | 'ANALYZING' | 'VERIFYING' | 'COMPLETE' | 'FAILED' | null = null;
  jobProgress = 0;
  jobStage: string | null = null;
  pollingInterval: any = null;

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

  ngOnDestroy() {
    // Clean up polling interval
    this.stopJobPolling();
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
        const snackBarRef = this.snackBar.open('Audio file selected. Transcription will occur when you submit.', 'Close', { duration: 4000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      } else {
        // For text/subtitle files, read and preview
        try {
          const text = await file.text();
          this.transcript = text;
          const snackBarRef = this.snackBar.open('File loaded successfully', 'Close', { duration: 3000 });
          snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
          
          // Auto-preview for supported formats
          if (this.textExtensions.includes(fileExt)) {
            await this.previewNormalization();
          }
        } catch (error: any) {
          this.errorMessage = `Failed to read file: ${error.message}`;
          const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
          snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
        const snackBarRef = this.snackBar.open('Audio file selected for linking', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      } else {
        const snackBarRef = this.snackBar.open('Please select a valid audio file', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
        
        const snackBarRef = this.snackBar.open('Transcript file loaded for linking', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      } else {
        const snackBarRef = this.snackBar.open('Please select a valid transcript file', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
        const snackBarRef = this.snackBar.open(`Preview ready (${result.warnings.length} warnings)`, 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
    // Determine ingestion mode
    let mode: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT';
    
    if (this.linkingMode) {
      // Audio + Transcript mode
      if (!this.audioFile || !this.transcriptFile) {
        this.errorMessage = 'Please select both an audio file and a transcript file';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
        return;
      }
      mode = 'AUDIO_PLUS_TRANSCRIPT';
    } else if (this.isAudioFile && this.selectedFile) {
      // Audio only mode
      mode = 'AUDIO_ONLY';
    } else {
      // Transcript only mode
      if (!this.transcript || this.transcript.trim().length === 0) {
        this.errorMessage = 'Please enter or upload a transcript, or select an audio file';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
        return;
      }
      mode = 'TRANSCRIPT_ONLY';
    }

    this.loading = true;
    this.errorMessage = '';
    this.jobStatus = null;
    this.jobProgress = 0;
    this.jobStage = null;

    try {
      // Step 1: Create ingestion job
      const jobResponse = await firstValueFrom(
        this.auditService.createIngestionJob({ mode, options: { analyzeImmediately: true } })
      );

      this.currentJobId = jobResponse.jobId;

      // Step 2: Upload files
      let transcriptFile: File | null = null;
      let audioFile: File | null = null;

      if (mode === 'TRANSCRIPT_ONLY') {
        // Create a text file from the transcript
        const blob = new Blob([this.transcript], { type: 'text/plain' });
        transcriptFile = new File([blob], this.selectedFileName || 'transcript.txt', { type: 'text/plain' });
      } else if (mode === 'AUDIO_ONLY') {
        audioFile = this.selectedFile!;
      } else if (mode === 'AUDIO_PLUS_TRANSCRIPT') {
        audioFile = this.audioFile!;
        transcriptFile = this.transcriptFile!;
      }

      await firstValueFrom(
        this.auditService.uploadJobFiles(jobResponse.jobId, audioFile || undefined, transcriptFile || undefined)
      );

      // Step 3: Start polling for job status
      this.startJobPolling(jobResponse.jobId);

    } catch (error: any) {
      console.error('Ingestion error:', error);
      this.errorMessage = error.error?.error || error.message || 'An unexpected error occurred';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      this.loading = false;
      this.stopJobPolling();
    }
  }

  /**
   * Start polling for job status
   */
  startJobPolling(jobId: string) {
    // Poll immediately
    this.pollJobStatus(jobId);

    // Then poll every 2 seconds
    this.pollingInterval = setInterval(() => {
      this.pollJobStatus(jobId);
    }, 2000);
  }

  /**
   * Stop polling for job status
   */
  stopJobPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Poll job status
   */
  async pollJobStatus(jobId: string) {
    try {
      const status = await firstValueFrom(this.auditService.getJobStatus(jobId));
      
      this.jobStatus = status.status;
      this.jobProgress = status.progress.pct;
      this.jobStage = status.progress.stage;

      if (status.status === 'COMPLETE') {
        this.stopJobPolling();
        this.loading = false;

        // Navigate to evaluation results
        if (status.result.analysisRunId) {
          this.router.navigate(['/evaluations', status.result.analysisRunId]);
        } else {
          this.snackBar.open('Analysis complete, but no evaluation ID found', 'Close', { duration: 3000 });
        }
      } else if (status.status === 'FAILED') {
        this.stopJobPolling();
        this.loading = false;
        this.errorMessage = status.error?.message || 'Job failed';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      }
    } catch (error: any) {
      console.error('Error polling job status:', error);
      // Don't stop polling on transient errors
    }
  }

  /**
   * Submit linked audio + transcript files
   * (Now handled by onSubmit with mode detection)
   */
  async submitLinkedFiles() {
    // This method is now handled by onSubmit() which detects linkingMode
    await this.onSubmit();
  }

  /**
   * Legacy submit linked files (kept for reference)
   */
  async submitLinkedFilesLegacy() {
    if (!this.audioFile || !this.transcriptFile) {
      this.errorMessage = 'Please select both an audio file and a transcript file';
      const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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

      const snackBarRef = this.snackBar.open('Audio and transcript linked successfully', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());

      // Step 3: Run evaluation
      // Use evaluation URL (Railway direct) to bypass Netlify timeout
      const evalUrl = this.auditService.getEvaluationBaseUrl();
      const evaluationData = await firstValueFrom(
        this.http.post<any>(`${evalUrl}/validate`, {
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
      // Use evaluation ID from response if available, otherwise fetch it
      if (evaluationData?.evaluationId) {
        // Evaluation ID is in the response - no need for extra API call
        this.router.navigate(['/evaluations', evaluationData.evaluationId]);
      } else {
        // Fallback: fetch latest evaluation for this conversation
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const evaluationsResponse = await firstValueFrom(
          this.auditService.getConversationEvaluations(conversationId, { limit: 1 })
        );
        
        if (evaluationsResponse?.evaluations?.length > 0) {
          this.router.navigate(['/evaluations', evaluationsResponse.evaluations[0].id]);
        } else {
          this.router.navigate(['/conversations', conversationId]);
        }
      }
    } catch (error: any) {
      console.error('Linking error:', error);
      this.errorMessage = error.error?.error || error.message || 'Failed to link files';
      const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
      const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
        const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        return;
      }

        const snackBarRef = this.snackBar.open('Audio transcribed successfully', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } catch (error: any) {
      this.errorMessage = error.error?.error || error.message || 'Failed to transcribe audio';
      const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.transcriptionInProgress = false;
    }
  }

  /**
   * Get icon for job status
   */
  getJobStatusIcon(): string {
    switch (this.jobStatus) {
      case 'UPLOADED':
        return 'upload';
      case 'TRANSCRIBING':
        return 'mic';
      case 'ANALYZING':
        return 'analytics';
      case 'VERIFYING':
        return 'verified';
      default:
        return 'hourglass_empty';
    }
  }

  /**
   * Get label for job status
   */
  getJobStatusLabel(): string {
    switch (this.jobStatus) {
      case 'UPLOADED':
        return 'Uploading files...';
      case 'TRANSCRIBING':
        return 'Transcribing audio...';
      case 'ANALYZING':
        return 'Analyzing transcript...';
      case 'VERIFYING':
        return 'Verifying audio against transcript...';
      default:
        return 'Processing...';
    }
  }

  /**
   * Get submit button label based on mode
   */
  getSubmitButtonLabel(): string {
    if (this.linkingMode) {
      return 'Analyze now + Verify with audio';
    } else if (this.isAudioFile && this.selectedFile) {
      return 'Generate transcript + Analyze';
    } else {
      return 'Run Analysis';
    }
  }
}

