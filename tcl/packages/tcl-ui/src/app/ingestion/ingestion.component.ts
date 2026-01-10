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
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

      // Step 2: Upload files directly to Supabase Storage (bypasses Netlify 6MB limit)
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

      // Step 2: Upload files directly to Supabase Storage (bypasses Netlify 6MB limit)
      // If direct upload fails (e.g., RLS policy), it will fall back to proxy method
      console.log('[Ingestion] Starting file uploads...');
      try {
        if (audioFile) {
          console.log('[Ingestion] Uploading audio file...');
          await this.uploadFileDirectly(jobResponse.jobId, audioFile, 'audio');
          console.log('[Ingestion] Audio file uploaded successfully');
        }
        if (transcriptFile) {
          console.log('[Ingestion] Uploading transcript file...');
          await this.uploadFileDirectly(jobResponse.jobId, transcriptFile, 'transcript');
          console.log('[Ingestion] Transcript file uploaded successfully');
        }
        console.log('[Ingestion] All files uploaded successfully');
      } catch (uploadError: any) {
        console.error('[Ingestion] File upload failed:', uploadError);
        throw new Error(`File upload failed: ${uploadError.message || 'Unknown error'}`);
      }

      // Step 3: Start polling for job status
      console.log('[Ingestion] Starting job status polling...');
      this.startJobPolling(jobResponse.jobId);
      
      // Keep loading state true while polling (will be cleared when job completes or fails)

    } catch (error: any) {
      console.error('Ingestion error:', error);
      this.errorMessage = error.error?.error || error.message || 'An unexpected error occurred';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      this.loading = false;
      this.stopJobPolling();
    }
  }

  /**
   * Upload file directly to Supabase Storage (bypasses Netlify 6MB limit)
   */
  async uploadFileDirectly(jobId: string, file: File | null, kind: 'audio' | 'transcript'): Promise<void> {
    if (!file) {
      return; // Skip if no file
    }

    try {
      console.log(`[Upload] Starting direct upload for ${kind}:`, file.name, file.size);

      // Step 1: Get upload metadata from backend
      const metadata = await firstValueFrom(
        this.auditService.getUploadMetadata(jobId, kind, file.name)
      );

      console.log(`[Upload] Got upload metadata:`, { bucket: metadata.bucket, objectPath: metadata.objectPath });

      // Step 2: Use authenticated Supabase client from AuthService
      // This uses the user's session token
      // Note: For private buckets, we need Storage RLS policies that allow uploads
      // If RLS blocks the upload, we'll fall back to the proxy method
      const supabaseClient = (this.authService as any).supabase as SupabaseClient | undefined;
      if (!supabaseClient) {
        console.warn(`[Upload] Supabase client not available, falling back to proxy method`);
        // Fallback to proxy upload
        const formData = new FormData();
        formData.append(kind, file);
        await firstValueFrom(
          this.auditService.uploadJobFiles(jobId, kind === 'audio' ? file : undefined, kind === 'transcript' ? file : undefined)
        );
        return;
      }

      // Check if user is authenticated
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !session) {
        console.warn(`[Upload] User not authenticated, falling back to proxy method:`, sessionError);
        // Fallback to proxy upload
        const formData = new FormData();
        formData.append(kind, file);
        await firstValueFrom(
          this.auditService.uploadJobFiles(jobId, kind === 'audio' ? file : undefined, kind === 'transcript' ? file : undefined)
        );
        return;
      }

      console.log(`[Upload] User authenticated, uploading to Supabase Storage...`);
      console.log(`[Upload] Upload details:`, {
        bucket: metadata.bucket,
        objectPath: metadata.objectPath,
        fileSize: file.size,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
      });

      // Step 3: Upload file directly to Supabase Storage
      // Use direct storage hostname for all uploads (faster and just as secure)
      // The direct storage hostname uses the same authentication and RLS policies
      const uploadStartTime = Date.now();
      
      console.log(`[Upload] Starting Supabase Storage upload via direct hostname...`);
      console.log(`[Upload] Upload parameters:`, {
        bucket: metadata.bucket,
        path: metadata.objectPath,
        fileSize: file.size,
        fileName: file.name,
      });
      
      let uploadData: any = null;
      let uploadError: any = null;
      
      try {
        // Try direct REST API upload first (faster, bypasses Netlify)
        console.log(`[Upload] Uploading ${(file.size / 1024 / 1024).toFixed(2)} MB file via direct REST API`);
        uploadData = await this.uploadFileDirectStorage(
          supabaseClient,
          metadata.bucket,
          metadata.objectPath,
          file
        );
      } catch (restError: any) {
        console.warn(`[Upload] Direct REST upload failed, trying supabase-js SDK fallback:`, restError.message);
        
        // Fallback to supabase-js SDK upload (still browser → Supabase directly, no Netlify)
        try {
          const result = await supabaseClient.storage
            .from(metadata.bucket)
            .upload(metadata.objectPath, file, {
              upsert: false,
              contentType: file.type || 'application/octet-stream',
            });
          
          if (result.error) {
            uploadError = result.error;
            uploadData = null;
          } else {
            uploadData = { ok: true, path: result.data.path || metadata.objectPath };
            uploadError = null;
          }
        } catch (sdkError: any) {
          console.error(`[Upload] Supabase SDK upload also failed:`, sdkError);
          uploadError = sdkError;
          uploadData = null;
        }
      }

      const uploadDuration = Date.now() - uploadStartTime;
      console.log(`[Upload] Upload attempt completed in ${uploadDuration}ms`, {
        hasData: !!uploadData,
        hasError: !!uploadError,
        errorMessage: uploadError?.message,
      });

      if (uploadError) {
        console.error(`[Upload] All upload methods failed:`, {
          error: uploadError,
          message: uploadError.message,
          statusCode: (uploadError as any).statusCode,
          name: (uploadError as any).name,
        });
        
        // If both direct methods fail, fall back to proxy method (goes through Netlify, 6MB limit)
        if (uploadError.message?.includes('new row violates') || 
            uploadError.message?.includes('permission') || 
            uploadError.message?.includes('policy') ||
            uploadError.message?.includes('Unauthorized') ||
            uploadError.message?.includes('403') ||
            uploadError.message?.includes('network') ||
            uploadError.message?.includes('CORS')) {
          console.warn(`[Upload] Direct uploads blocked, falling back to proxy method (6MB limit applies)`);
          // Fallback to proxy upload
          const formData = new FormData();
          formData.append(kind, file);
          await firstValueFrom(
            this.auditService.uploadJobFiles(jobId, kind === 'audio' ? file : undefined, kind === 'transcript' ? file : undefined)
          );
          return;
        }
        throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`);
      }

      console.log(`[Upload] File uploaded to Supabase Storage successfully:`, uploadData);

      // Step 4: Compute SHA-256 hash
      console.log(`[Upload] Computing SHA-256 hash for file (${file.size} bytes)...`);
      const hashStartTime = Date.now();
      const sha256 = await this.computeFileHash(file);
      const hashDuration = Date.now() - hashStartTime;
      console.log(`[Upload] Computed SHA-256 in ${hashDuration}ms:`, sha256);

      // Step 5: Finalize upload with backend
      console.log(`[Upload] Calling finalize-upload endpoint...`);
      const finalizeStartTime = Date.now();
      try {
        const finalizeResult = await firstValueFrom(
          this.auditService.finalizeUpload(
            jobId,
            metadata.assetId,
            metadata.bucket,
            metadata.objectPath,
            file.name,
            file.size,
            sha256,
            kind
          )
        );
        const finalizeDuration = Date.now() - finalizeStartTime;
        console.log(`[Upload] Upload finalized in ${finalizeDuration}ms:`, finalizeResult);
        console.log(`[Upload] ✅ Upload completed successfully for ${kind}`);
      } catch (finalizeError: any) {
        console.error(`[Upload] Finalize upload failed:`, finalizeError);
        throw new Error(`Failed to finalize upload: ${finalizeError.message || finalizeError.error?.message || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error(`[Upload] Error uploading ${kind}:`, error);
      throw new Error(`Failed to upload ${kind} file: ${error.message || error.error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Upload file via direct Supabase Storage REST API (faster and just as secure)
   * Uses PUT method with proper path encoding and apikey header
   * Security: Uses same authentication (Bearer token) and RLS policies apply
   */
  async uploadFileDirectStorage(
    supabaseClient: SupabaseClient,
    bucket: string,
    objectPath: string,
    file: File
  ): Promise<any> {
    const supabaseUrl = (supabaseClient as any).supabaseUrl;

    if (!supabaseUrl) {
      console.error('[Upload] Supabase URL not found in client');
      throw new Error('Supabase URL not available in client');
    }

    // Get anon key for apikey header
    const supabaseAnonKey =
      (supabaseClient as any).supabaseKey ||
      (typeof window !== 'undefined' && (window as any).__SUPABASE_ANON_KEY);

    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    
    if (sessionError) {
      console.error('[Upload] Session error:', sessionError);
      throw new Error(`Session error: ${sessionError.message}`);
    }
    
    if (!session?.access_token) {
      console.error('[Upload] No access token in session');
      throw new Error('No authentication token available');
    }
    
    if (!supabaseAnonKey) {
      console.error('[Upload] Missing anon key. Client key:', (supabaseClient as any).supabaseKey, 'Window key:', typeof window !== 'undefined' ? (window as any).__SUPABASE_ANON_KEY : 'N/A');
      throw new Error('Missing Supabase anon key for apikey header');
    }

    // Encode per segment so slashes remain slashes
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`;
    
    console.log('[Upload] Upload URL:', uploadUrl);
    console.log('[Upload] Original path:', objectPath);
    console.log('[Upload] Encoded path:', encodedPath);
    console.log('[Upload] Bucket:', bucket);
    console.log('[Upload] File size:', file.size, 'bytes');
    console.log('[Upload] File type:', file.type);

    const uploadTimeout = 10 * 60 * 1000; // 10 minutes
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error(`[Upload] Upload timeout after ${uploadTimeout/1000}s`);
      controller.abort();
    }, uploadTimeout);

    try {
      console.log('[Upload] Starting fetch request...');
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'false',
        },
        body: file,
        signal: controller.signal,
      });

      console.log('[Upload] Fetch response status:', res.status, res.statusText);
      console.log('[Upload] Response headers:', Object.fromEntries(res.headers.entries()));

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Upload] Upload failed with response:', {
          status: res.status,
          statusText: res.statusText,
          errorText,
          url: uploadUrl,
        });
        throw new Error(`Storage upload failed (${res.status}): ${errorText}`);
      }

      // Some storage responses are JSON, some aren't; don't assume JSON.
      const text = await res.text();
      console.log('[Upload] Upload successful, response text:', text.substring(0, 200));
      return { ok: true, responseText: text, path: objectPath };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('[Upload] Upload aborted due to timeout');
        throw new Error(`Upload timeout after ${uploadTimeout/1000} seconds. File may be too large or network connection is slow.`);
      }
      console.error('[Upload] Upload error:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Compute SHA-256 hash of a file (browser)
   */
  async computeFileHash(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
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

