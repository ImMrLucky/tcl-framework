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
import { EvidenceService, EvidenceItem } from '../evidence.service';
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
  
  // Mode selection
  selectedMode: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT' = 'TRANSCRIPT_ONLY';
  
  // Audio + transcript linking (for AUDIO_PLUS_TRANSCRIPT mode)
  audioFile: File | null = null;
  audioFileName = '';
  transcriptFile: File | null = null;
  transcriptFileName = '';

  // Job-based ingestion state
  currentJobId: string | null = null;
  jobStatus: 'UPLOADED' | 'READY' | 'TRANSCRIBING' | 'ANALYZING' | 'VERIFYING' | 'COMPLETE' | 'FAILED' | null = null;
  jobProgress = 0;
  jobStage: string | null = null;
  pollingInterval: any = null;

  // Supported formats
  readonly audioExtensions = ['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.opus', '.aac'];
  readonly subtitleExtensions = ['.vtt', '.srt'];
  readonly textExtensions = ['.txt', '.csv', '.json', '.vtt', '.srt'];

  // Evidence system state
  showEvidencePanel = false;
  evidenceFiles: File[] = [];
  evidenceLinks: Array<{ url: string; title: string; sourceType: EvidenceItem['sourceType'] }> = [];
  includeOrgEvidence = true;
  includeProjectEvidence = true;
  includeTemplateEvidence = true;
  templateId?: string;
  simulationMode = false;
  resolvedEvidenceSet: { orgEvidenceIds: string[]; projectEvidenceIds: string[]; conversationEvidenceIds: string[]; templateEvidenceIds: string[]; resolvedEvidenceIds: string[] } | null = null;
  evidencePreviewLoading = false;
  readonly evidenceSourceTypes: Array<{ value: EvidenceItem['sourceType']; label: string }> = [
    { value: 'POLICY', label: 'Policy' },
    { value: 'RULESET', label: 'Ruleset' },
    { value: 'KNOWLEDGE', label: 'Knowledge Base' },
    { value: 'ACCOUNT_FACTS', label: 'Account Facts' },
    { value: 'LEGAL', label: 'Legal Document' },
    { value: 'URL_LINK', label: 'URL Link' },
    { value: 'SYSTEM_EXPORT', label: 'System Export' },
  ];
  readonly evidenceFileExtensions = ['.pdf', '.docx', '.txt', '.csv', '.json', '.html', '.md'];

  constructor(
    private auditService: AuditService,
    private tclService: TclService,
    private router: Router,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private evidenceService: EvidenceService,
    private memberService: MemberService,
    private http: HttpClient,
    private evidenceService: EvidenceService
  ) {}

  ngOnInit() {
    // Component initialization
  }

  ngOnDestroy() {
    // Clean up polling interval
    this.stopJobPolling();
  }

  // ============================================================================
  // EVIDENCE SYSTEM METHODS
  // ============================================================================

  /**
   * Toggle evidence panel visibility
   */
  toggleEvidencePanel() {
    this.showEvidencePanel = !this.showEvidencePanel;
    if (this.showEvidencePanel && !this.resolvedEvidenceSet) {
      this.previewEvidenceSet();
    }
  }

  /**
   * Handle evidence file selection
   */
  onEvidenceFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        // Check if file extension is supported
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();
        if (this.evidenceFileExtensions.includes(ext)) {
          this.evidenceFiles.push(file);
        } else {
          this.snackBar.open(`Unsupported file type: ${ext}. Supported: ${this.evidenceFileExtensions.join(', ')}`, 'Close', { duration: 3000 });
        }
      }
      input.value = ''; // Reset input
    }
  }

  /**
   * Remove evidence file
   */
  removeEvidenceFile(index: number) {
    this.evidenceFiles.splice(index, 1);
  }

  /**
   * Add evidence link
   */
  addEvidenceLink() {
    const url = prompt('Enter URL:');
    if (url && url.trim()) {
      const title = prompt('Enter title (optional):') || url;
      this.evidenceLinks.push({
        url: url.trim(),
        title: title.trim(),
        sourceType: 'URL_LINK',
      });
    }
  }

  /**
   * Remove evidence link
   */
  removeEvidenceLink(index: number) {
    this.evidenceLinks.splice(index, 1);
  }

  /**
   * Preview resolved evidence set
   */
  async previewEvidenceSet() {
    const user = this.authService.getCurrentUser();
    if (!user?.id) {
      return;
    }
    
    // Get orgId from user's organizations (first org for now)
    // TODO: Support multi-org selection
    let orgId: string | undefined;
    try {
      const orgs = await firstValueFrom(this.auditService.getUserOrgs(user.id));
      if (orgs && orgs.length > 0) {
        orgId = orgs[0].id;
      }
    } catch (err) {
      console.error('Failed to get user orgs:', err);
      return;
    }
    
    if (!orgId) {
      return;
    }
    
    const projectId: string | undefined = undefined; // TODO: Get from user context or selection

    this.evidencePreviewLoading = true;
    try {
      // Get conversation evidence IDs from uploaded files/links
      // For preview, we'll just show org/project/template evidence
      const evidenceSet = await firstValueFrom(
        this.evidenceService.resolveEvidenceSet({
          orgId,
          projectId,
          templateId: this.templateId,
          includeOrgEvidence: this.includeOrgEvidence,
          includeProjectEvidence: this.includeProjectEvidence,
          includeTemplateEvidence: this.includeTemplateEvidence,
          simulationMode: this.simulationMode,
        })
      );
      this.resolvedEvidenceSet = evidenceSet;
    } catch (error: any) {
      console.error('Failed to preview evidence set:', error);
      this.snackBar.open('Failed to preview evidence set', 'Close', { duration: 3000 });
    } finally {
      this.evidencePreviewLoading = false;
    }
  }

  /**
   * Get evidence count for preview
   */
  getEvidenceCount(): string {
    if (!this.resolvedEvidenceSet) {
      return '0';
    }
    const total = this.resolvedEvidenceSet.resolvedEvidenceIds.length;
    const org = this.resolvedEvidenceSet.orgEvidenceIds.length;
    const project = this.resolvedEvidenceSet.projectEvidenceIds.length;
    const template = this.resolvedEvidenceSet.templateEvidenceIds.length;
    const conversation = this.evidenceFiles.length + this.evidenceLinks.length;
    
    const parts: string[] = [];
    if (org > 0) parts.push(`${org} org`);
    if (project > 0) parts.push(`${project} project`);
    if (template > 0) parts.push(`${template} template`);
    if (conversation > 0) parts.push(`${conversation} attached`);
    
    return parts.length > 0 ? parts.join(' + ') : '0';
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
   * Set ingestion mode
   */
  setMode(mode: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT') {
    this.selectedMode = mode;
    // Clear files when switching modes
    if (mode !== 'AUDIO_PLUS_TRANSCRIPT') {
      this.audioFile = null;
      this.audioFileName = '';
      this.transcriptFile = null;
      this.transcriptFileName = '';
    }
    if (mode !== 'AUDIO_ONLY') {
      // Clear audio file selection for non-audio modes
      if (this.isAudioFile) {
        this.selectedFile = null;
        this.selectedFileName = '';
        this.isAudioFile = false;
      }
    }
    if (mode !== 'TRANSCRIPT_ONLY') {
      // Clear transcript text for non-transcript-only modes
      if (!this.transcriptFile) {
        this.transcript = '';
      }
    }
  }

  async onSubmit() {
    // Determine ingestion mode
    let mode: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT';
    
    // Use the selected mode
    mode = this.selectedMode;
    
    console.log('[Ingestion] Using selected mode:', mode);
    
    // Validate inputs based on mode
    if (mode === 'TRANSCRIPT_ONLY') {
      if (!this.transcript || this.transcript.trim().length === 0) {
        if (!this.selectedFile || (!this.isSubtitleFile && !this.selectedFileName.endsWith('.txt'))) {
          this.errorMessage = 'Please enter or upload a transcript';
          this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
          return;
        }
      }
    } else if (mode === 'AUDIO_ONLY') {
      if (!this.selectedFile || !this.isAudioFile) {
        this.errorMessage = 'Please select an audio file';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
        return;
      }
    } else if (mode === 'AUDIO_PLUS_TRANSCRIPT') {
      if (!this.audioFile) {
        this.errorMessage = 'Please select an audio file';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
        return;
      }
      if (!this.transcriptFile && (!this.transcript || this.transcript.trim().length === 0)) {
        this.errorMessage = 'Please provide a transcript (file or text)';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
        return;
      }
    }

    this.loading = true;
    this.errorMessage = '';
    this.jobStatus = null;
    this.jobProgress = 0;
    this.jobStage = null;

    try {
      // Step 1: Create ingestion job
      const jobResponse = await firstValueFrom(
        this.auditService.createIngestionJob({ 
          mode, 
          title: this.title || undefined,
          channel: this.channel || undefined,
          options: { analyzeImmediately: mode !== 'AUDIO_ONLY' } // Don't auto-start for Audio Only
        })
      );

      this.currentJobId = jobResponse.jobId;

      // Step 2: Upload files
      // For TRANSCRIPT_ONLY: Use proxy upload (small files, no need for direct Supabase)
      // For AUDIO_ONLY or AUDIO_PLUS_TRANSCRIPT: Use direct Supabase upload (large files, bypasses Netlify 6MB limit)
      let transcriptFile: File | null = null;
      let audioFile: File | null = null;

      if (mode === 'TRANSCRIPT_ONLY') {
        // For transcript-only, use proxy upload (small files, works fine)
        // This is the OLD flow that was working before - no upload-metadata call
        console.log('[Ingestion] ✅ TRANSCRIPT_ONLY mode detected - using proxy upload (old flow)');
        console.log('[Ingestion] Transcript length:', this.transcript.length, 'characters');
        const blob = new Blob([this.transcript], { type: 'text/plain' });
        transcriptFile = new File([blob], this.selectedFileName || 'transcript.txt', { type: 'text/plain' });
        
        // Use proxy upload for transcript-only (calls /api/ingest/jobs/:jobId/upload, NOT upload-metadata)
        console.log('[Ingestion] Calling uploadJobFiles (proxy method)...');
        await firstValueFrom(
          this.auditService.uploadJobFiles(jobResponse.jobId, undefined, transcriptFile)
        );
        console.log('[Ingestion] ✅ Transcript uploaded via proxy - no upload-metadata call');
      } else {
        // For audio modes, use direct Supabase upload
        if (mode === 'AUDIO_ONLY') {
          audioFile = this.selectedFile!;
        } else if (mode === 'AUDIO_PLUS_TRANSCRIPT') {
          audioFile = this.audioFile!;
          // Transcript can be file or text
          if (this.transcriptFile) {
            transcriptFile = this.transcriptFile;
          } else if (this.transcript && this.transcript.trim().length > 0) {
            const blob = new Blob([this.transcript], { type: 'text/plain' });
            transcriptFile = new File([blob], 'transcript.txt', { type: 'text/plain' });
          }
        }

        console.log('[Ingestion] Starting direct Supabase uploads...');
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
      }

      // Step 3: Upload evidence files if any
      const conversationEvidenceIds: string[] = [];
      if (this.evidenceFiles.length > 0 || this.evidenceLinks.length > 0) {
        try {
          const user = this.authService.getCurrentUser();
          if (!user?.id) {
            throw new Error('User not authenticated');
          }
          
          // Get orgId from user's organizations (first org for now)
          // TODO: Support multi-org selection
          let orgId: string | undefined;
          try {
            const orgsResponse = await firstValueFrom(this.memberService.getUserOrgs(user.id));
            const orgs = orgsResponse.orgs;
            if (orgs && orgs.length > 0) {
              orgId = orgs[0].id;
            }
          } catch (err) {
            console.error('Failed to get user orgs:', err);
            throw new Error('Failed to get organization ID');
          }
          
          if (!orgId) {
            throw new Error('Organization ID not found - user must be a member of at least one organization');
          }

          // Upload evidence files
          for (const file of this.evidenceFiles) {
            try {
              const evidenceItem = await firstValueFrom(
                this.evidenceService.uploadEvidenceFile(
                  file,
                  orgId,
                  'POLICY', // Default source type, can be made configurable
                  file.name,
                  {
                    conversationId: jobResponse.jobId, // Use jobId as conversationId for now
                    scope: 'CONVERSATION',
                  }
                )
              );
              conversationEvidenceIds.push(evidenceItem.id);
              console.log('[Ingestion] Evidence file uploaded:', evidenceItem.id);
            } catch (evidenceError: any) {
              console.warn('[Ingestion] Failed to upload evidence file:', evidenceError);
              // Continue with other files
            }
          }

          // Add evidence links
          for (const link of this.evidenceLinks) {
            try {
              const evidenceItem = await firstValueFrom(
                this.evidenceService.addEvidenceLink(
                  link.url,
                  orgId,
                  link.sourceType,
                  link.title,
                  {
                    conversationId: jobResponse.jobId,
                    scope: 'CONVERSATION',
                    snapshotLink: true,
                  }
                )
              );
              conversationEvidenceIds.push(evidenceItem.id);
              console.log('[Ingestion] Evidence link added:', evidenceItem.id);
            } catch (evidenceError: any) {
              console.warn('[Ingestion] Failed to add evidence link:', evidenceError);
              // Continue with other links
            }
          }
        } catch (evidenceError: any) {
          console.warn('[Ingestion] Evidence upload failed, continuing without evidence:', evidenceError);
          // Continue without evidence - evaluation can still run
        }
      }

      // Step 4: Handle post-upload behavior based on mode
      if (mode === 'AUDIO_ONLY') {
        // For Audio Only: Upload is complete, show "Transcribe & Analyze" button
        // Don't start polling yet - wait for user to click "Transcribe & Analyze"
        this.loading = false;
        this.jobStatus = 'READY';
        console.log('[Ingestion] Audio uploaded successfully. Ready for transcription.');
      } else {
        // For other modes: Start polling immediately (processing starts automatically)
        // Note: Evidence parameters will be passed when the job is processed
        console.log('[Ingestion] Starting job status polling...');
        console.log('[Ingestion] Job ID:', jobResponse.jobId);
        this.startJobPolling(jobResponse.jobId);
      }
      
      // Keep loading state true while polling (will be cleared when job completes or fails)
      // Note: loading state controls button text, jobStatus controls progress display

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
      console.log(`[Upload] ✅ Metadata received, proceeding to get Supabase client...`);

      // Step 2: Use authenticated Supabase client from AuthService
      // This uses the user's session token
      // Note: For private buckets, we need Storage RLS policies that allow uploads
      // If RLS blocks the upload, we'll fall back to the proxy method
      console.log(`[Upload] Getting Supabase client from AuthService...`);
      const supabaseClient = (this.authService as any).supabase as SupabaseClient | undefined;
      console.log(`[Upload] Supabase client:`, supabaseClient ? 'found' : 'NOT FOUND');
      
      if (!supabaseClient) {
        console.warn(`[Upload] ⚠️ Supabase client not available, falling back to proxy method`);
        // Fallback to proxy upload
        const formData = new FormData();
        formData.append(kind, file);
        await firstValueFrom(
          this.auditService.uploadJobFiles(jobId, kind === 'audio' ? file : undefined, kind === 'transcript' ? file : undefined)
        );
        return;
      }

      // Skip session check - let the upload fail if not authenticated
      // This avoids hanging on getSession() calls
      console.log(`[Upload] Skipping session check, proceeding directly to upload`);
      console.log(`[Upload] If upload fails due to auth, we'll fall back to proxy method`);

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
      
      // Use Supabase SDK upload directly (handles auth automatically, no session check needed)
      // This is simpler and more reliable than REST API + manual session handling
      try {
        console.log(`[Upload] 🚀 Starting Supabase SDK upload for ${(file.size / 1024 / 1024).toFixed(2)} MB file`);
        console.log(`[Upload] Bucket: ${metadata.bucket}, Path: ${metadata.objectPath}`);
        console.log(`[Upload] File: ${file.name}, Size: ${file.size}, Type: ${file.type || 'application/octet-stream'}`);
        
        const sdkUploadStartTime = Date.now();
        const result = await supabaseClient.storage
          .from(metadata.bucket)
          .upload(metadata.objectPath, file, {
            upsert: false,
            contentType: file.type || 'application/octet-stream',
          });
        
        const sdkUploadDuration = Date.now() - sdkUploadStartTime;
        console.log(`[Upload] SDK upload completed in ${sdkUploadDuration}ms`);
        console.log(`[Upload] SDK upload result:`, { 
          data: result.data, 
          error: result.error,
          hasData: !!result.data,
          hasError: !!result.error,
        });
        
        if (result.error) {
          console.error(`[Upload] ❌ SDK upload returned error:`, {
            error: result.error,
            message: result.error.message,
            statusCode: (result.error as any).statusCode,
          });
          uploadError = result.error;
          uploadData = null;
        } else {
          console.log(`[Upload] ✅ SDK upload succeeded! Path: ${result.data.path}`);
          uploadData = { ok: true, path: result.data.path || metadata.objectPath };
          uploadError = null;
        }
      } catch (sdkError: any) {
        console.error(`[Upload] ❌ SDK upload exception:`, {
          error: sdkError,
          message: sdkError?.message,
          stack: sdkError?.stack,
          name: sdkError?.name,
        });
        uploadError = sdkError;
        uploadData = null;
      }

      const uploadDuration = Date.now() - uploadStartTime;
      console.log(`[Upload] 📊 Upload attempt summary (${uploadDuration}ms):`, {
        hasData: !!uploadData,
        hasError: !!uploadError,
        errorMessage: uploadError?.message,
        uploadData: uploadData,
        uploadError: uploadError,
      });

      if (uploadError) {
        console.error(`[Upload] 🚨 Upload failed - will not proceed to finalize`);
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

      console.log(`[Upload] ✅ File uploaded to Supabase Storage successfully:`, uploadData);
      console.log(`[Upload] Proceeding to compute hash and finalize...`);

      // Step 4: Compute SHA-256 hash
      console.log(`[Upload] 🔐 Computing SHA-256 hash for file (${file.size} bytes)...`);
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
      console.error(`[Upload] ❌❌❌ CRITICAL ERROR uploading ${kind}:`, {
        error: error,
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        toString: error?.toString(),
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });
      console.error(`[Upload] Error type:`, typeof error);
      console.error(`[Upload] Error constructor:`, error?.constructor?.name);
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

    // Get session with timeout to avoid hanging
    console.log('[Upload] Getting session for upload...');
    let session: any = null;
    let sessionError: any = null;
    
    try {
      const sessionPromise = supabaseClient.auth.getSession();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Session check timeout')), 3000)
      );
      
      const result = await Promise.race([sessionPromise, timeoutPromise]) as any;
      session = result?.data?.session;
      sessionError = result?.error;
      console.log('[Upload] Session retrieved:', { hasSession: !!session, hasError: !!sessionError });
    } catch (err: any) {
      console.warn('[Upload] Session check timed out or failed, trying localStorage fallback:', err?.message);
      sessionError = err;
      // Try to get session from storage directly as fallback
      try {
        // Try multiple possible storage keys
        const storageKeys = [
          'sb-uqwcmkyaskyduxuluqrm-auth-token',
          'supabase.auth.token',
        ];
        
        let storedSession: any = null;
        for (const key of storageKeys) {
          const stored = localStorage.getItem(key);
          if (stored) {
            try {
              storedSession = JSON.parse(stored);
              console.log(`[Upload] Found session in localStorage with key: ${key}`);
              break;
            } catch (e) {
              // Try next key
            }
          }
        }
        
        if (storedSession) {
          // Supabase stores session in different structures:
          // 1. Direct: { session: { access_token: ... } }
          // 2. Nested: { currentSession: { access_token: ... } }
          // 3. Flat: { access_token: ... }
          session = storedSession?.session || storedSession?.currentSession || storedSession;
          
          if (session?.access_token) {
            console.log('[Upload] ✅ Retrieved session from localStorage fallback');
            // Clear error since we got session from fallback
            sessionError = null;
          } else {
            console.warn('[Upload] Session from localStorage missing access_token. Structure:', {
              hasSession: !!storedSession?.session,
              hasCurrentSession: !!storedSession?.currentSession,
              hasAccessToken: !!storedSession?.access_token,
              keys: Object.keys(storedSession || {}),
            });
          }
        } else {
          console.warn('[Upload] No session found in localStorage with any known key');
        }
      } catch (storageErr) {
        console.error('[Upload] Failed to get session from storage:', storageErr);
      }
    }
    
    // Only throw if we don't have a session after all attempts
    if (!session?.access_token) {
      if (sessionError) {
        console.error('[Upload] Session error and no fallback session:', sessionError);
        throw new Error(`Session error: ${sessionError.message}`);
      } else {
        console.error('[Upload] No access token in session');
        throw new Error('No authentication token available');
      }
    }
    
    console.log('[Upload] ✅ Session token available, proceeding with upload');
    
    if (!supabaseAnonKey) {
      console.error('[Upload] Missing anon key. Client key:', (supabaseClient as any).supabaseKey, 'Window key:', typeof window !== 'undefined' ? (window as any).__SUPABASE_ANON_KEY : 'N/A');
      throw new Error('Missing Supabase anon key for apikey header');
    }

    // Encode per segment so slashes remain slashes (canonical encoding)
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    // Use canonical Supabase URL (no .storage. rewriting)
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`;
    
    console.log('[Upload] Upload URL:', uploadUrl);
    console.log('[Upload] Original path:', objectPath);
    console.log('[Upload] Encoded path (per segment):', encodedPath);
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
      console.log('[Upload] 🚀 Starting fetch request to:', uploadUrl);
      console.log('[Upload] Request headers:', {
        apikey: supabaseAnonKey ? '***set***' : 'MISSING',
        Authorization: session.access_token ? '***set***' : 'MISSING',
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      });
      
      const fetchStartTime = Date.now();
      // Use canonical Supabase URL, segment-encoded path, apikey header, no Content-Length
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'false',
          // Note: Do NOT include Content-Length - let browser set it automatically
        },
        body: file,
        signal: controller.signal,
      });
      
      const fetchDuration = Date.now() - fetchStartTime;
      console.log(`[Upload] 📡 Fetch completed in ${fetchDuration}ms`);
      console.log('[Upload] Response status:', res.status, res.statusText);
      // Log response headers (safe way that works with TypeScript)
      const headersObj: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      console.log('[Upload] Response headers:', headersObj);

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
   * Start processing for Audio Only mode (calls /start endpoint)
   */
  async startProcessing() {
    if (!this.currentJobId) {
      this.errorMessage = 'No job ID available';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      return;
    }

    if (this.jobStatus !== 'READY') {
      this.errorMessage = 'Job is not ready for processing';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    try {
      console.log('[Ingestion] Starting job processing...');
      const result = await firstValueFrom(this.auditService.startJob(this.currentJobId));
      
      if (result.alreadyComplete) {
        this.snackBar.open('Job is already complete', 'Close', { duration: 3000 });
        this.loading = false;
        // Refresh status
        await this.pollJobStatus(this.currentJobId);
        return;
      }

      if (result.alreadyProcessing) {
        this.snackBar.open('Job is already processing', 'Close', { duration: 3000 });
        // Start polling to track progress
        this.startJobPolling(this.currentJobId);
        return;
      }

      console.log('[Ingestion] Job processing started successfully');
      // Start polling to track progress
      this.startJobPolling(this.currentJobId);
    } catch (error: any) {
      console.error('[Ingestion] Error starting job:', error);
      this.errorMessage = error.error?.error || error.message || 'Failed to start job processing';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      this.loading = false;
    }
  }

  /**
   * Poll job status
   */
  async pollJobStatus(jobId: string) {
    try {
      const status = await firstValueFrom(this.auditService.getJobStatus(jobId));
      
      console.log(`[Poll] Job status update:`, {
        status: status.status,
        progress: status.progress.pct,
        stage: status.progress.stage,
        hasResult: !!status.result,
        analysisRunId: status.result?.analysisRunId,
      });
      
      // Update UI state
      const previousStatus = this.jobStatus;
      const previousProgress = this.jobProgress;
      
      this.jobStatus = status.status;
      this.jobProgress = status.progress.pct;
      this.jobStage = status.progress.stage;
      
      // Log if status/progress changed
      if (previousStatus !== this.jobStatus || previousProgress !== this.jobProgress) {
        console.log(`[Poll] UI updated: ${previousStatus}(${previousProgress}%) → ${this.jobStatus}(${this.jobProgress}%)`);
      }

      if (status.status === 'COMPLETE') {
        console.log(`[Poll] ✅ Job complete! Analysis Run ID: ${status.result?.analysisRunId}`);
        this.stopJobPolling();
        this.loading = false;
        this.jobProgress = 100; // Ensure progress shows 100%

        // Navigate to evaluation results
        if (status.result?.analysisRunId) {
          console.log(`[Poll] Navigating to evaluation: ${status.result.analysisRunId}`);
          this.router.navigate(['/evaluations', status.result.analysisRunId]);
        } else {
          console.warn(`[Poll] Job complete but no analysisRunId found`);
          this.snackBar.open('Analysis complete, but no evaluation ID found', 'Close', { duration: 3000 });
        }
      } else if (status.status === 'FAILED') {
        console.error(`[Poll] ❌ Job failed:`, status.error);
        this.stopJobPolling();
        this.loading = false;
        this.errorMessage = status.error?.message || 'Job failed';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      }
    } catch (error: any) {
      console.error('[Poll] Error polling job status:', error);
      // Don't stop polling on transient errors - might be network issue
    }
  }

  /**
   * Submit linked audio + transcript files
   * (Now handled by onSubmit with mode detection)
   */
  async submitLinkedFiles() {
    // This method is now handled by onSubmit() which uses selectedMode
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
    if (this.jobStatus === 'READY') return 'check_circle';
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
      case 'READY':
        return 'Ready to transcribe';
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
   * Check if submit button should be disabled
   */
  getSubmitButtonDisabled(): boolean {
    if (this.selectedMode === 'TRANSCRIPT_ONLY') {
      return (!this.transcript || this.transcript.trim().length === 0) && !this.selectedFile;
    } else if (this.selectedMode === 'AUDIO_ONLY') {
      return !this.selectedFile || !this.isAudioFile;
    } else if (this.selectedMode === 'AUDIO_PLUS_TRANSCRIPT') {
      return !this.audioFile || (!this.transcriptFile && (!this.transcript || this.transcript.trim().length === 0));
    }
    return true;
  }

  /**
   * Get submit button label based on mode
   */
  getSubmitButtonLabel(): string {
    if (this.selectedMode === 'AUDIO_PLUS_TRANSCRIPT') {
      return 'Analyze Transcript (Upload Audio Optional)';
    } else if (this.selectedMode === 'AUDIO_ONLY') {
      return 'Upload Audio';
    } else {
      return 'Analyze Transcript';
    }
  }
}

