import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { AppHeaderComponent } from '../../shared/app-header.component';
import { ScoringProfilesService, ScoringProfile, CreateScoringProfileRequest, ValidationError } from '../../scoring-profiles.service';

@Component({
  selector: 'app-scoring-profiles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatTableModule,
    MatChipsModule,
    MatSnackBarModule,
    MatExpansionModule,
    AppHeaderComponent
  ],
  templateUrl: './scoring-profiles.component.html',
  styleUrls: ['./scoring-profiles.component.scss']
})
export class ScoringProfilesComponent implements OnInit {
  loading = false;
  profiles: ScoringProfile[] = [];
  activeProfile: ScoringProfile | null = null;
  
  // Form state
  editing = false;
  profileName = '';
  profileDescription = '';
  profileVersion = '1.0.0';
  
  // Risk Ranking Config
  riskScoringWeights = {
    impact: 0.40,
    evidence: 0.30,
    signal: 0.20,
    category: 0.10
  };
  
  severityThresholds = {
    low: 0.20,
    medium: 0.45,
    high: 0.70,
    critical: 0.85
  };
  
  evidenceMap = {
    EXTERNAL_VERIFIED: 1.0,
    TRANSCRIPT_ONLY: 0.45,
    NONE: 0.20
  };
  
  impactMap = {
    low: 0.3,
    medium: 0.6,
    high: 1.0
  };
  
  // Issue Scoring Config
  baseWeights = {
    impact: 0.55,
    verification: 0.30,
    confidence: 0.15
  };
  
  // Validation
  validationErrors: string[] = [];
  showAdvanced = false;
  
  // Full configs for JSON editor
  riskRankingConfigJson = '';
  issueScoringConfigJson = '';

  constructor(
    private scoringProfilesService: ScoringProfilesService,
    private snackBar: MatSnackBar
  ) {}

  async ngOnInit() {
    await this.loadProfiles();
  }

  async loadProfiles() {
    this.loading = true;
    try {
      const [profilesResponse, activeResponse] = await Promise.all([
        this.scoringProfilesService.getProfiles().toPromise(),
        this.scoringProfilesService.getActiveProfile().toPromise(),
      ]);

      if (profilesResponse) {
        this.profiles = profilesResponse.profiles;
      }
      if (activeResponse) {
        this.activeProfile = activeResponse.profile;
      }
    } catch (error: any) {
      console.error('Failed to load profiles:', error);
      this.snackBar.open('Failed to load profiles: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }

  startEditing(profile?: ScoringProfile) {
    if (profile) {
      // Load existing profile
      this.profileName = profile.name;
      this.profileDescription = profile.description || '';
      this.profileVersion = profile.version;
      
      // Load configs
      if (profile.risk_ranking_config) {
        const rrc = profile.risk_ranking_config;
        if (rrc.weights?.riskScoring) {
          this.riskScoringWeights = { ...rrc.weights.riskScoring };
        }
        if (rrc.severityThresholds) {
          this.severityThresholds = { ...rrc.severityThresholds };
        }
        if (rrc.evidenceMap) {
          this.evidenceMap = { ...rrc.evidenceMap };
        }
        if (rrc.impactMap) {
          this.impactMap = { ...rrc.impactMap };
        }
        this.riskRankingConfigJson = JSON.stringify(rrc, null, 2);
      }
      
      if (profile.issue_scoring_config) {
        const isc = profile.issue_scoring_config;
        if (isc.weights?.baseWeights) {
          this.baseWeights = { ...isc.weights.baseWeights };
        }
        this.issueScoringConfigJson = JSON.stringify(isc, null, 2);
      }
    } else {
      // New profile - load defaults
      this.loadDefaults();
    }
    
    this.editing = true;
    this.validationErrors = [];
  }

  loadDefaults() {
    // Load default values from current configs
    this.profileName = '';
    this.profileDescription = '';
    this.profileVersion = '1.0.0';
    this.riskScoringWeights = { impact: 0.40, evidence: 0.30, signal: 0.20, category: 0.10 };
    this.severityThresholds = { low: 0.20, medium: 0.45, high: 0.70, critical: 0.85 };
    this.evidenceMap = { EXTERNAL_VERIFIED: 1.0, TRANSCRIPT_ONLY: 0.45, NONE: 0.20 };
    this.impactMap = { low: 0.3, medium: 0.6, high: 1.0 };
    this.baseWeights = { impact: 0.55, verification: 0.30, confidence: 0.15 };
    
    // Load full default configs (simplified - in production, fetch from API)
    this.riskRankingConfigJson = JSON.stringify({
      ui: { maxTopIssues: 10 },
      issueLimits: { perClaimMax: 10, globalMax: 50, topIssuesMax: 10, evidenceQuotesMax: 5 },
      severityThresholds: this.severityThresholds,
      impactMap: this.impactMap,
      evidenceMap: this.evidenceMap,
      categoryNormalization: { min: 1.0, max: 1.3 },
      degradedMode: { missingSpectralSignal01: 0.5, missingEdgesSignal01: 0.5 },
      weights: {
        riskScoring: this.riskScoringWeights,
        typeBase: {},
        speakerMultiplier: {},
        verificationMultiplier: {},
      },
      typePriority: []
    }, null, 2);
    
    this.issueScoringConfigJson = JSON.stringify({
      weights: {
        baseWeights: this.baseWeights,
        verification: this.evidenceMap,
      },
      caps: {
        transcriptOnlyMaxSeverityDisplay: 'medium',
      }
    }, null, 2);
  }

  validateForm(): boolean {
    this.validationErrors = [];

    // Validate risk scoring weights sum to 1.0
    const riskSum = this.riskScoringWeights.impact + this.riskScoringWeights.evidence +
                    this.riskScoringWeights.signal + this.riskScoringWeights.category;
    if (Math.abs(riskSum - 1.0) > 0.001) {
      this.validationErrors.push(`Risk scoring weights must sum to 1.0 (currently ${riskSum.toFixed(3)})`);
    }

    // Validate base weights sum to 1.0
    const baseSum = this.baseWeights.impact + this.baseWeights.verification + this.baseWeights.confidence;
    if (Math.abs(baseSum - 1.0) > 0.001) {
      this.validationErrors.push(`Base weights must sum to 1.0 (currently ${baseSum.toFixed(3)})`);
    }

    // Validate severity thresholds are monotonic
    if (this.severityThresholds.low >= this.severityThresholds.medium) {
      this.validationErrors.push('Severity threshold: low must be < medium');
    }
    if (this.severityThresholds.medium >= this.severityThresholds.high) {
      this.validationErrors.push('Severity threshold: medium must be < high');
    }
    if (this.severityThresholds.high >= this.severityThresholds.critical) {
      this.validationErrors.push('Severity threshold: high must be < critical');
    }

    // Validate JSON configs if using advanced mode
    if (this.showAdvanced) {
      try {
        JSON.parse(this.riskRankingConfigJson);
      } catch (e) {
        this.validationErrors.push('Risk ranking config JSON is invalid');
      }
      try {
        JSON.parse(this.issueScoringConfigJson);
      } catch (e) {
        this.validationErrors.push('Issue scoring config JSON is invalid');
      }
    }

    return this.validationErrors.length === 0;
  }

  async saveProfile() {
    if (!this.validateForm()) {
      this.snackBar.open('Please fix validation errors before saving', 'Close', { duration: 5000 });
      return;
    }

    if (!this.profileName.trim()) {
      this.snackBar.open('Profile name is required', 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    try {
      let riskRankingConfig: any;
      let issueScoringConfig: any;

      if (this.showAdvanced) {
        // Use JSON editor values
        riskRankingConfig = JSON.parse(this.riskRankingConfigJson);
        issueScoringConfig = JSON.parse(this.issueScoringConfigJson);
      } else {
        // Build from form fields
        riskRankingConfig = {
          ui: { maxTopIssues: 10 },
          issueLimits: { perClaimMax: 10, globalMax: 50, topIssuesMax: 10, evidenceQuotesMax: 5 },
          severityThresholds: this.severityThresholds,
          impactMap: this.impactMap,
          evidenceMap: this.evidenceMap,
          categoryNormalization: { min: 1.0, max: 1.3 },
          degradedMode: { missingSpectralSignal01: 0.5, missingEdgesSignal01: 0.5 },
          weights: {
            riskScoring: this.riskScoringWeights,
            typeBase: {
              CONTRADICTION: 0.75,
              UNVERIFIED_CLAIM: 0.35,
              UNSUPPORTED_CLAIM: 0.65,
              UNGROUNDED: 0.50,
              RISK_SIGNAL: 0.60,
              POLICY: 0.70,
              FEE_DISCLOSURE_RISK: 0.70,
              COMMITMENT_INCONSISTENCY: 0.60,
              NUMERIC_MISMATCH: 0.55,
              DATA_INTEGRITY: 0.80,
              OTHER: 0.30
            },
            speakerMultiplier: { AGENT: 1.15, CUSTOMER: 0.85, SYSTEM: 1.25, UNKNOWN: 1.00 },
            verificationMultiplier: { EXTERNAL_VERIFIED: 1.10, TRANSCRIPT_ONLY: 0.90, NONE: 0.80 },
          },
          typePriority: [
            'CONTRADICTION', 'DATA_INTEGRITY', 'POLICY', 'FEE_DISCLOSURE_RISK',
            'RISK_SIGNAL', 'COMMITMENT_INCONSISTENCY', 'NUMERIC_MISMATCH',
            'UNSUPPORTED_CLAIM', 'UNGROUNDED', 'UNVERIFIED_CLAIM', 'OTHER'
          ]
        };

        issueScoringConfig = {
          weights: {
            baseWeights: this.baseWeights,
            verification: this.evidenceMap,
            impact: { low: 0.2, medium: 0.5, high: 0.8 },
            disputeBoostPoints: 6,
            contradictionBoostPoints: 3,
            commitmentBoostPoints: 4,
            escalationBoostPoints: 8,
          },
          caps: {
            transcriptOnlyMaxSeverityDisplay: 'medium',
            transcriptOnlyHighExceptions: {
              allowIfEscalation: true,
              allowIfStrictContradiction: true,
              allowIfDisputedCommitment: true
            }
          }
        };
      }

      const request: CreateScoringProfileRequest = {
        name: this.profileName.trim(),
        description: this.profileDescription.trim() || undefined,
        riskRankingConfig,
        issueScoringConfig,
        version: this.profileVersion || '1.0.0',
      };

      await this.scoringProfilesService.createProfile(request).toPromise();
      this.snackBar.open('Profile created successfully', 'Close', { duration: 3000 });
      this.editing = false;
      await this.loadProfiles();
    } catch (error: any) {
      console.error('Failed to save profile:', error);
      const validationError = error.error as ValidationError;
      if (validationError?.errors) {
        this.validationErrors = validationError.errors;
        this.snackBar.open('Validation failed: ' + validationError.errors.join(', '), 'Close', {
          duration: 5000
        });
      } else {
        this.snackBar.open('Failed to save profile: ' + (error.error?.error || error.message), 'Close', {
          duration: 5000
        });
      }
    } finally {
      this.loading = false;
    }
  }

  async activateProfile(profile: ScoringProfile) {
    if (!confirm(`Activate "${profile.name}"? This will affect all new evaluations.`)) {
      return;
    }

    this.loading = true;
    try {
      const response = await this.scoringProfilesService.activateProfile(profile.id).toPromise();
      if (response) {
        this.snackBar.open(response.message + ` Config hash: ${response.configHash}`, 'Close', {
          duration: 5000
        });
        await this.loadProfiles();
      }
    } catch (error: any) {
      console.error('Failed to activate profile:', error);
      this.snackBar.open('Failed to activate profile: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }

  cancelEditing() {
    this.editing = false;
    this.validationErrors = [];
  }

  getRiskScoringSum(): number {
    return this.riskScoringWeights.impact + this.riskScoringWeights.evidence +
           this.riskScoringWeights.signal + this.riskScoringWeights.category;
  }

  getBaseWeightsSum(): number {
    return this.baseWeights.impact + this.baseWeights.verification + this.baseWeights.confidence;
  }

  // Expose Math for template
  Math = Math;

  abs(value: number): number {
    return Math.abs(value);
  }
}

