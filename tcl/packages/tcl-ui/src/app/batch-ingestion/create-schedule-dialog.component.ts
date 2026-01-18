import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface ScheduleDialogData {
  schedule?: {
    id: string;
    name: string;
    source_id: string;
    rrule: string;
    template_id?: string;
    mode: string;
    representative_id?: string;
  };
  sources: Array<{ id: string; name?: string; type: string }>;
  templates?: Array<{ id: string; name: string }>;
  representatives?: Array<{ id: string; display_name: string }>;
}

@Component({
  selector: 'app-create-schedule-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.schedule ? 'Edit Schedule' : 'Create Schedule' }}</h2>
    <mat-dialog-content>
      <form #scheduleForm="ngForm">
        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="name" name="name" required>
        </mat-form-field>

        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>Data Source</mat-label>
          <mat-select [(ngModel)]="sourceId" name="sourceId" required [disabled]="!!data?.schedule">
            <mat-option *ngFor="let source of data.sources" [value]="source.id">
              {{ source.name || source.type }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>Frequency</mat-label>
          <mat-select [(ngModel)]="frequency" name="frequency" required (ngModelChange)="updateRRule()">
            <mat-option value="HOURLY">Hourly</mat-option>
            <mat-option value="DAILY">Daily</mat-option>
            <mat-option value="WEEKLY">Weekly</mat-option>
            <mat-option value="CUSTOM">Custom RRULE</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field *ngIf="frequency === 'CUSTOM'" appearance="outline" style="width: 100%;">
          <mat-label>RRULE</mat-label>
          <input matInput [(ngModel)]="customRRule" name="customRRule" placeholder="FREQ=DAILY;BYHOUR=2">
          <mat-hint>RFC 5545 RRULE format (e.g., FREQ=DAILY;BYHOUR=2)</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>Ingestion Mode</mat-label>
          <mat-select [(ngModel)]="mode" name="mode">
            <mat-option value="AUDIO_PLUS_TRANSCRIPT">Audio + Transcript</mat-option>
            <mat-option value="AUDIO_ONLY">Audio Only</mat-option>
            <mat-option value="TRANSCRIPT_ONLY">Transcript Only</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field *ngIf="data.templates && data.templates.length > 0" appearance="outline" style="width: 100%;">
          <mat-label>Template (optional)</mat-label>
          <mat-select [(ngModel)]="templateId" name="templateId">
            <mat-option [value]="null">None</mat-option>
            <mat-option *ngFor="let template of data.templates" [value]="template.id">
              {{ template.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field *ngIf="data.representatives && data.representatives.length > 0" appearance="outline" style="width: 100%;">
          <mat-label>Representative (optional)</mat-label>
          <mat-select [(ngModel)]="representativeId" name="representativeId">
            <mat-option [value]="null">None</mat-option>
            <mat-option *ngFor="let rep of data.representatives" [value]="rep.id">
              {{ rep.display_name }}
            </mat-option>
          </mat-select>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!isValid()">
        {{ data?.schedule ? 'Update' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 500px;
      max-width: 600px;
    }
    mat-form-field {
      margin-bottom: 16px;
    }
  `]
})
export class CreateScheduleDialogComponent implements OnInit {
  name: string = '';
  sourceId: string = '';
  frequency: string = 'DAILY';
  customRRule: string = '';
  mode: string = 'AUDIO_PLUS_TRANSCRIPT';
  templateId: string | null = null;
  representativeId: string | null = null;

  constructor(
    public dialogRef: MatDialogRef<CreateScheduleDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ScheduleDialogData
  ) {
    if (data?.schedule) {
      this.name = data.schedule.name;
      this.sourceId = data.schedule.source_id;
      this.mode = data.schedule.mode;
      this.templateId = data.schedule.template_id || null;
      this.representativeId = data.schedule.representative_id || null;
      
      // Parse RRULE to determine frequency
      const rrule = data.schedule.rrule;
      if (rrule.includes('FREQ=HOURLY')) {
        this.frequency = 'HOURLY';
      } else if (rrule.includes('FREQ=DAILY')) {
        this.frequency = 'DAILY';
      } else if (rrule.includes('FREQ=WEEKLY')) {
        this.frequency = 'WEEKLY';
      } else {
        this.frequency = 'CUSTOM';
        this.customRRule = rrule;
      }
    }
  }

  ngOnInit() {
    if (!this.data.sources) {
      this.data.sources = [];
    }
    if (!this.data.templates) {
      this.data.templates = [];
    }
    if (!this.data.representatives) {
      this.data.representatives = [];
    }
  }

  updateRRule() {
    // RRULE will be generated on save
  }

  isValid(): boolean {
    return !!(this.name && this.sourceId && this.frequency);
  }

  save() {
    let rrule: string;
    if (this.frequency === 'CUSTOM') {
      rrule = this.customRRule;
    } else {
      rrule = `FREQ=${this.frequency}`;
    }

    const result = {
      name: this.name,
      source_id: this.sourceId,
      rrule: rrule,
      mode: this.mode,
      template_id: this.templateId || null,
      representative_id: this.representativeId || null,
    };
    this.dialogRef.close(result);
  }

  cancel() {
    this.dialogRef.close();
  }
}

