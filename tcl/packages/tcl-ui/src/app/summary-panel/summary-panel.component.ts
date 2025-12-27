import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { ValidateOutput } from '../types';

@Component({
  selector: 'app-summary-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatChipsModule
  ],
  template: `
    <mat-card class="summary-panel">
      <mat-card-header>
        <mat-card-title>Summary</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <div *ngIf="loading" class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
          <p>Validating...</p>
        </div>

        <div *ngIf="!loading && result" class="summary-content">
          <div class="coherence-score">
            <div class="score-circle" [class]="getScoreClass(result.scores.coherence)">
              <span class="score-value">{{ result.scores.coherence }}</span>
              <span class="score-label">Coherence</span>
            </div>
          </div>

          <div class="flags-section">
            <h3>Flags</h3>
            <div class="flags-grid">
              <div class="flag-item" *ngIf="hasContradictions()">
                <mat-icon class="flag-icon error">cancel</mat-icon>
                <span>Contradictions</span>
              </div>
              <div class="flag-item" *ngIf="hasUngroundedClaims()">
                <mat-icon class="flag-icon warning">warning</mat-icon>
                <span>Ungrounded Claims</span>
              </div>
              <div class="flag-item" *ngIf="hasCircularReasoning()">
                <mat-icon class="flag-icon circular">refresh</mat-icon>
                <span>Circular Reasoning</span>
              </div>
            </div>
          </div>

          <div class="status-section">
            <mat-chip [class]="getStatusClass()">
              {{ getStatusText() }}
            </mat-chip>
          </div>

          <div class="scores-breakdown">
            <h3>Score Breakdown</h3>
            <div class="score-item">
              <span class="score-name">Truth:</span>
              <span class="score-value-small">{{ result.scores.truth }}</span>
            </div>
            <div class="score-item">
              <span class="score-name">Consistency:</span>
              <span class="score-value-small">{{ result.scores.consistency }}</span>
            </div>
            <div class="score-item">
              <span class="score-name">Coherence:</span>
              <span class="score-value-small">{{ result.scores.coherence }}</span>
            </div>
            <div class="score-item overall">
              <span class="score-name">Overall:</span>
              <span class="score-value-small">{{ result.scores.overall }}</span>
            </div>
          </div>
        </div>

        <div *ngIf="!loading && !result" class="empty-state">
          <mat-icon>info</mat-icon>
          <p>Enter a question and answer to see validation results</p>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .summary-panel {
      min-height: 400px;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 16px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #666;
      gap: 16px;
    }

    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #ccc;
    }

    .summary-content {
      padding: 8px 0;
    }

    .coherence-score {
      display: flex;
      justify-content: center;
      margin-bottom: 32px;
    }

    .score-circle {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 4px solid;
      transition: all 0.3s;
    }

    .score-circle.pass {
      border-color: #4caf50;
      background: #e8f5e9;
    }

    .score-circle.warn {
      border-color: #ff9800;
      background: #fff3e0;
    }

    .score-circle.fail {
      border-color: #f44336;
      background: #ffebee;
    }

    .score-value {
      font-size: 2.5rem;
      font-weight: bold;
      line-height: 1;
    }

    .score-label {
      font-size: 0.875rem;
      margin-top: 4px;
      opacity: 0.8;
    }

    .flags-section {
      margin-bottom: 24px;
    }

    .flags-section h3 {
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 12px;
      color: #666;
    }

    .flags-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .flag-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #f5f5f5;
      border-radius: 4px;
    }

    .flag-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .flag-icon.error {
      color: #f44336;
    }

    .flag-icon.warning {
      color: #ff9800;
    }

    .flag-icon.circular {
      color: #2196f3;
    }

    .status-section {
      margin-bottom: 24px;
      display: flex;
      justify-content: center;
    }

    .status-section mat-chip {
      font-size: 1rem;
      font-weight: 500;
      padding: 8px 24px;
    }

    .status-pass {
      background-color: #4caf50;
      color: white;
    }

    .status-warn {
      background-color: #ff9800;
      color: white;
    }

    .status-fail {
      background-color: #f44336;
      color: white;
    }

    .scores-breakdown {
      padding-top: 24px;
      border-top: 1px solid #e0e0e0;
    }

    .scores-breakdown h3 {
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 12px;
      color: #666;
    }

    .score-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }

    .score-item.overall {
      border-top: 1px solid #e0e0e0;
      margin-top: 8px;
      padding-top: 16px;
      font-weight: 500;
    }

    .score-name {
      color: #666;
    }

    .score-value-small {
      font-weight: 500;
    }
  `]
})
export class SummaryPanelComponent {
  @Input() result: ValidateOutput | null = null;
  @Input() loading = false;

  hasContradictions(): boolean {
    return (this.result?.report.contradictions?.length ?? 0) > 0;
  }

  hasUngroundedClaims(): boolean {
    return (this.result?.report.missingEvidence?.length ?? 0) > 0;
  }

  hasCircularReasoning(): boolean {
    return (this.result?.report.spectral?.circularityScore ?? 0) > 50;
  }

  getScoreClass(score: number): string {
    if (score >= 70) return 'pass';
    if (score >= 50) return 'warn';
    return 'fail';
  }

  getStatusClass(): string {
    if (!this.result) return '';
    const overall = this.result.scores.overall;
    if (overall >= 70) return 'status-pass';
    if (overall >= 50) return 'status-warn';
    return 'status-fail';
  }

  getStatusText(): string {
    if (!this.result) return '';
    const overall = this.result.scores.overall;
    if (overall >= 70) return 'Pass';
    if (overall >= 50) return 'Warn';
    return 'Fail';
  }
}

