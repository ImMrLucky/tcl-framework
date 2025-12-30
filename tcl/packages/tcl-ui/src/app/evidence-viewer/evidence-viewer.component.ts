import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';

export interface EvidenceViewerData {
  issue: any;
  claim: any;
  conversationId?: string;
  transcript?: string | null;
  turns?: Array<{ idx: number; speaker: string; text: string; startMs?: number; endMs?: number }>;
  evaluation?: any;
}

@Component({
  selector: 'app-evidence-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressBarModule
  ],
  templateUrl: './evidence-viewer.component.html',
  styleUrls: ['./evidence-viewer.component.scss']
})
export class EvidenceViewerComponent {
  constructor(
    public dialogRef: MatDialogRef<EvidenceViewerComponent>,
    @Inject(MAT_DIALOG_DATA) public data: EvidenceViewerData
  ) {}

  close() {
    this.dialogRef.close();
  }

  getTruthStateColor(state: string): string {
    switch (state) {
      case 'Contradicted': return '#d32f2f';
      case 'Ungrounded': return '#f57c00';
      case 'Supported': return '#388e3c';
      default: return '#666';
    }
  }

  /**
   * Get context turns (5 before and after claim/evidence)
   */
  getContextTurns(): Array<{ idx: number; speaker: string; text: string; startMs?: number; endMs?: number }> {
    if (!this.data.turns || this.data.turns.length === 0) {
      return [];
    }

    const claimTurnIdx = this.data.issue.turnStartIdx;
    const evidenceTurnIdx = this.data.issue.primaryEvidence?.turnIdx;
    
    if (claimTurnIdx === undefined && evidenceTurnIdx === undefined) {
      return this.data.turns.slice(0, 20); // Show first 20 if no turn info
    }

    const targetTurn = claimTurnIdx !== undefined ? claimTurnIdx : evidenceTurnIdx!;
    const startIdx = Math.max(0, targetTurn - 5);
    const endIdx = Math.min(this.data.turns.length, targetTurn + 6);
    
    return this.data.turns.slice(startIdx, endIdx);
  }

  /**
   * Check if turn is the claim turn
   */
  isClaimTurn(turnIdx: number): boolean {
    return this.data.issue.turnStartIdx === turnIdx || 
           (this.data.issue.turnEndIdx !== undefined && 
            turnIdx >= this.data.issue.turnStartIdx && 
            turnIdx <= this.data.issue.turnEndIdx);
  }

  /**
   * Check if turn is the evidence turn
   */
  isEvidenceTurn(turnIdx: number): boolean {
    return this.data.issue.primaryEvidence?.turnIdx === turnIdx;
  }

  /**
   * Check if turn should be highlighted (claim or evidence)
   */
  isHighlightedTurn(turnIdx: number): boolean {
    return this.isClaimTurn(turnIdx) || this.isEvidenceTurn(turnIdx);
  }

  /**
   * Format timestamp from milliseconds
   */
  formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Get explanation for truth state
   */
  getStateExplanation(state: string): string {
    const explanations: Record<string, string> = {
      'Contradicted': 'This claim contradicts other claims in the conversation.',
      'Ungrounded': 'No supporting evidence found in conversation.',
      'Supported': 'This claim is supported by other claims.',
      'Inconclusive': 'Signal is weak or ambiguous.'
    };
    return explanations[state] || '';
  }
}

