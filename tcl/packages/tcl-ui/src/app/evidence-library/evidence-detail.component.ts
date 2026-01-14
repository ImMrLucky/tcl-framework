import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppHeaderComponent } from '../shared/app-header.component';
import { EvidenceService, EvidenceItem } from '../evidence.service';

@Component({
  selector: 'app-evidence-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatSnackBarModule,
    MatTooltipModule,
    AppHeaderComponent
  ],
  template: `
    <app-header 
      [pageTitle]="evidenceItem?.title || 'Evidence Details'"
      [showNavigation]="true"
      [showBackButton]="true"
      backButtonRoute="/evidence"
      backButtonText="Back to Evidence Library">
    </app-header>

    <div class="container" *ngIf="evidenceItem">
      <mat-card>
        <mat-card-header>
          <mat-card-title>
            {{ evidenceItem.title }}
            <mat-icon 
              *ngIf="evidenceItem.overridePolicy === 'LOCKED'" 
              class="lock-icon"
              matTooltip="Locked by org admin. Always applied in production runs.">
              lock
            </mat-icon>
          </mat-card-title>
          <mat-card-subtitle *ngIf="evidenceItem.description">
            {{ evidenceItem.description }}
          </mat-card-subtitle>
        </mat-card-header>
        
        <mat-card-content>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="label">Source Type:</span>
              <span class="value">{{ getSourceTypeLabel(evidenceItem.sourceType) }}</span>
            </div>
            <div class="detail-item" *ngIf="evidenceItem.authorityLevel">
              <span class="label">Authority Level:</span>
              <mat-chip [class]="'authority-' + evidenceItem.authorityLevel.toLowerCase()">
                {{ getAuthorityLevelLabel(evidenceItem.authorityLevel) }}
              </mat-chip>
            </div>
            <div class="detail-item" *ngIf="evidenceItem.overridePolicy">
              <span class="label">Override Policy:</span>
              <mat-chip [class]="'override-' + evidenceItem.overridePolicy.toLowerCase()">
                {{ getOverridePolicyLabel(evidenceItem.overridePolicy) }}
              </mat-chip>
            </div>
            <div class="detail-item">
              <span class="label">Status:</span>
              <mat-chip [class]="'status-' + evidenceItem.status.toLowerCase()">
                {{ evidenceItem.status | titlecase }}
              </mat-chip>
            </div>
            <div class="detail-item">
              <span class="label">Version:</span>
              <span class="value">{{ evidenceItem.version }}</span>
            </div>
            <div class="detail-item">
              <span class="label">Index Status:</span>
              <mat-chip [class]="'index-status-' + evidenceItem.indexStatus.toLowerCase()">
                {{ evidenceItem.indexStatus | titlecase }}
              </mat-chip>
              <span *ngIf="evidenceItem.chunkCount" class="chunk-count">
                ({{ evidenceItem.chunkCount }} chunks)
              </span>
            </div>
            <div class="detail-item" *ngIf="evidenceItem.effectiveFrom">
              <span class="label">Effective From:</span>
              <span class="value">{{ evidenceItem.effectiveFrom | date:'medium' }}</span>
            </div>
            <div class="detail-item" *ngIf="evidenceItem.effectiveTo">
              <span class="label">Effective To:</span>
              <span class="value">{{ evidenceItem.effectiveTo | date:'medium' }}</span>
            </div>
            <div class="detail-item">
              <span class="label">Created:</span>
              <span class="value">{{ evidenceItem.createdAt | date:'medium' }}</span>
            </div>
            <div class="detail-item" *ngIf="evidenceItem.approvedAt">
              <span class="label">Approved:</span>
              <span class="value">{{ evidenceItem.approvedAt | date:'medium' }}</span>
            </div>
          </div>

          <div *ngIf="evidenceItem.tags && evidenceItem.tags.length > 0" class="tags-section">
            <h3>Tags</h3>
            <div class="chips-container">
              <mat-chip *ngFor="let tag of evidenceItem.tags">{{ tag }}</mat-chip>
            </div>
          </div>

          <div *ngIf="evidenceItem.regions && evidenceItem.regions.length > 0" class="regions-section">
            <h3>Regions</h3>
            <div class="chips-container">
              <mat-chip *ngFor="let region of evidenceItem.regions">{{ region }}</mat-chip>
            </div>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    .lock-icon {
      color: #f44336;
      margin-left: 8px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
      margin: 20px 0;
    }

    .detail-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .label {
      font-weight: 500;
      color: #666;
    }

    .value {
      color: #333;
    }

    .tags-section, .regions-section {
      margin-top: 24px;
    }

    .chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .chunk-count {
      font-size: 12px;
      color: #666;
      margin-left: 4px;
    }
  `]
})
export class EvidenceDetailComponent implements OnInit {
  evidenceItem: EvidenceItem | null = null;
  loading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private evidenceService: EvidenceService,
    private snackBar: MatSnackBar
  ) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/evidence']);
      return;
    }

    this.loading = true;
    try {
      this.evidenceItem = await this.evidenceService.getEvidenceItem(id).toPromise() || null;
    } catch (error: any) {
      console.error('Failed to load evidence:', error);
      this.snackBar.open('Failed to load evidence: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      this.router.navigate(['/evidence']);
    } finally {
      this.loading = false;
    }
  }

  getSourceTypeLabel(sourceType: string): string {
    const labels: Record<string, string> = {
      'POLICY': 'Policy',
      'RULESET': 'Ruleset',
      'KNOWLEDGE': 'Knowledge',
      'ACCOUNT_FACTS': 'Account Facts',
      'LEGAL': 'Legal',
      'URL_LINK': 'URL Link',
      'SYSTEM_EXPORT': 'System Export'
    };
    return labels[sourceType] || sourceType;
  }

  getAuthorityLevelLabel(level: string): string {
    return level === 'BINDING' ? 'Binding' : 'Informational';
  }

  getOverridePolicyLabel(policy: string): string {
    const labels: Record<string, string> = {
      'LOCKED': 'Locked',
      'ALLOW_SUPPLEMENT': 'Allow Supplement',
      'ALLOW_OVERRIDE': 'Allow Override'
    };
    return labels[policy] || policy;
  }
}

