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

  constructor(
    private auditService: AuditService,
    private tclService: TclService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    // Component initialization
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
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

  async onSubmit() {
    if (!this.transcript || this.transcript.trim().length === 0) {
      this.errorMessage = 'Please enter or upload a transcript';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    try {
      // Step 1: Ingest conversation
      const ingestResponse = await this.auditService.ingestConversation({
        transcript: this.transcript,
        title: this.title || undefined,
        channel: this.channel
      }).toPromise();

      if (!ingestResponse) {
        throw new Error('Failed to ingest conversation');
      }

      const conversationId = ingestResponse.conversationId;

      // Step 2: Extract claims from transcript
      // Note: We're using the extractClaims function directly here
      // In a real implementation, you might want to call an API endpoint
      // that does this server-side, but for now we'll do it client-side
      const claims = this.extractClaimsFromTranscript(this.transcript);

      if (claims.length === 0) {
        throw new Error('No claims extracted from transcript');
      }

      // Step 3: Build graph (simplified - in production, this should be done server-side)
      // For now, we'll create empty supports/contradictions and let the server build the graph
      const supports: Array<{ claimA: string; claimB: string; weight?: number }> = [];
      const contradictions: Array<{ claimA: string; claimB: string; weight?: number }> = [];
      const grounded: string[] = [];

      // Step 4: Run evaluation
      const evaluationResponse = await this.auditService.runEvaluation({
        conversationId,
        claims: claims.map(c => ({
          id: c.id,
          text: c.text,
          speaker: c.meta?.speaker === 'Agent' ? 'AGENT' : c.meta?.speaker === 'Customer' ? 'CUSTOMER' : undefined,
          turnIndex: c.meta?.turnIndex
        })),
        supports,
        contradictions,
        grounded,
        config: {
          // Use default config
        }
      }).toPromise();

      if (!evaluationResponse) {
        throw new Error('Failed to run evaluation');
      }

      // Step 5: Navigate to results page
      this.router.navigate(['/evaluations', evaluationResponse.evaluationId]);
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
}

