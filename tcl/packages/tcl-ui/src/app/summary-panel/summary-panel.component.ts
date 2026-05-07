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
  templateUrl: './summary-panel.component.html',
  styleUrls: ['./summary-panel.component.scss']
})
export class SummaryPanelComponent {
  @Input() result: ValidateOutput | null = null;
  @Input() loading = false;

  get primaryNumericScore(): number | null {
    if (!this.result?.scores) return null;
    const s = this.result.scores;
    const v = s.tcl ?? s.overall;
    return v === undefined || v === null ? null : Math.round(Number(v));
  }

  get primaryScoreLabel(): string {
    const ds = this.result?.dashboardSummary;
    return (
      ds?.conversationTrustScore?.label ??
      (ds?.dashboardMode === 'protectqa' ? 'ProtectQA risk score' : 'TCL score')
    );
  }

  get trustSubtitle(): string {
    return (
      this.result?.dashboardSummary?.conversationTrustScore?.subtitle ??
      'How trustworthy, compliant, grounded, and useful this conversation was.'
    );
  }

  formatScore(v: number | null | undefined): string {
    if (v === undefined || v === null || Number.isNaN(Number(v))) return '—';
    return String(Math.round(Number(v)));
  }

  hasExtendedScores(): boolean {
    if (!this.result?.scores) return false;
    const s = this.result.scores as unknown as Record<string, unknown>;
    return ['transcriptGrounding', 'compliance', 'hallucination', 'drift', 'evidenceSupport'].some(
      k => s[k] != null && !Number.isNaN(Number(s[k]))
    );
  }

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

  getComplianceScoreClass(score: number): string {
    if (score >= 80) return 'low-risk';
    if (score >= 60) return 'medium-risk';
    if (score >= 40) return 'high-risk';
    return 'critical-risk';
  }

  getRiskLevel(score: number): string {
    if (score >= 80) return 'Low Risk';
    if (score >= 60) return 'Medium Risk';
    if (score >= 40) return 'High Risk';
    return 'Critical Risk';
  }

  getRiskLevelClass(score: number): string {
    if (score >= 80) return 'low';
    if (score >= 60) return 'medium';
    if (score >= 40) return 'high';
    return 'critical';
  }

  getStatusClassForPrimary(): string {
    if (!this.result || this.primaryNumericScore === null) return '';
    const overall = this.primaryNumericScore;
    if (overall >= 70) return 'status-pass';
    if (overall >= 50) return 'status-warn';
    return 'status-fail';
  }

  getStatusTextForPrimary(): string {
    if (!this.result || this.primaryNumericScore === null) return '';
    const overall = this.primaryNumericScore;
    if (overall >= 70) return 'Pass';
    if (overall >= 50) return 'Warn';
    return 'Fail';
  }

  getScorerName(scorerId: string): string {
    if (scorerId.startsWith('transformers-')) {
      const model = scorerId.replace('transformers-', '');
      return `Local NLI (${model})`;
    }
    if (scorerId.startsWith('mistral-')) {
      return 'Mistral API';
    }
    if (scorerId.startsWith('token-heuristic')) {
      return 'Token Heuristic (Basic)';
    }
    if (scorerId.includes('nli-')) {
      return `Custom NLI (${scorerId})`;
    }
    return scorerId;
  }

  getScorerIcon(scorerId: string): string {
    if (scorerId.startsWith('transformers-')) {
      return 'psychology';
    }
    if (scorerId.startsWith('mistral-')) {
      return 'cloud';
    }
    if (scorerId.startsWith('token-heuristic')) {
      return 'speed';
    }
    return 'settings';
  }

  getScorerClass(scorerId: string): string {
    if (scorerId.startsWith('transformers-')) {
      return 'scorer-local';
    }
    if (scorerId.startsWith('mistral-')) {
      return 'scorer-cloud';
    }
    if (scorerId.startsWith('token-heuristic')) {
      return 'scorer-basic';
    }
    return 'scorer-custom';
  }
}

