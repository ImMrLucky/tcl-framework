import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';

export interface SourceDialogData {
  source?: {
    id: string;
    type: string;
    name?: string;
    description?: string;
    config_json: any;
  };
}

@Component({
  selector: 'app-create-source-dialog',
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
    MatExpansionModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.source ? 'Edit Data Source' : 'Create Data Source' }}</h2>
    <mat-dialog-content>
      <form #sourceForm="ngForm">
        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="name" name="name" required>
          <mat-hint>Optional: A friendly name for this source</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="type" name="type" required [disabled]="!!data?.source">
            <mat-option value="S3">Amazon S3</mat-option>
            <mat-option value="GCS">Google Cloud Storage</mat-option>
            <mat-option value="AZURE_BLOB">Azure Blob Storage</mat-option>
            <mat-option value="SFTP">SFTP</mat-option>
            <mat-option value="MANIFEST_URL">Manifest URL</mat-option>
            <mat-option value="GDRIVE">Google Drive</mat-option>
            <mat-option value="DROPBOX">Dropbox</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="description" name="description" rows="3"></textarea>
        </mat-form-field>

        <!-- S3 Configuration -->
        <mat-expansion-panel *ngIf="type === 'S3'" [expanded]="true">
          <mat-expansion-panel-header>
            <mat-panel-title>S3 Configuration</mat-panel-title>
          </mat-expansion-panel-header>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Bucket Name</mat-label>
            <input matInput [(ngModel)]="config.bucket" name="bucket" required>
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Region</mat-label>
            <input matInput [(ngModel)]="config.region" name="region" placeholder="us-east-1">
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Prefix (optional)</mat-label>
            <input matInput [(ngModel)]="config.prefix" name="prefix" placeholder="path/to/files/">
            <mat-hint>Only process files in this path</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Access Key ID</mat-label>
            <input matInput type="password" [(ngModel)]="config.accessKeyId" name="accessKeyId" required>
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Secret Access Key</mat-label>
            <input matInput type="password" [(ngModel)]="config.secretAccessKey" name="secretAccessKey" required>
          </mat-form-field>
        </mat-expansion-panel>

        <!-- Google Drive Configuration -->
        <mat-expansion-panel *ngIf="type === 'GDRIVE'" [expanded]="true">
          <mat-expansion-panel-header>
            <mat-panel-title>Google Drive Configuration</mat-panel-title>
          </mat-expansion-panel-header>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Folder ID</mat-label>
            <input matInput [(ngModel)]="config.folderId" name="folderId">
            <mat-hint>Optional: Specific folder to monitor</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Access Token</mat-label>
            <input matInput type="password" [(ngModel)]="config.accessToken" name="accessToken" required>
          </mat-form-field>
        </mat-expansion-panel>

        <!-- Dropbox Configuration -->
        <mat-expansion-panel *ngIf="type === 'DROPBOX'" [expanded]="true">
          <mat-expansion-panel-header>
            <mat-panel-title>Dropbox Configuration</mat-panel-title>
          </mat-expansion-panel-header>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Path</mat-label>
            <input matInput [(ngModel)]="config.path" name="path" placeholder="/">
            <mat-hint>Optional: Specific path to monitor</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Access Token</mat-label>
            <input matInput type="password" [(ngModel)]="config.accessToken" name="accessToken" required>
          </mat-form-field>
        </mat-expansion-panel>

        <!-- SFTP Configuration -->
        <mat-expansion-panel *ngIf="type === 'SFTP'" [expanded]="true">
          <mat-expansion-panel-header>
            <mat-panel-title>SFTP Configuration</mat-panel-title>
          </mat-expansion-panel-header>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Host</mat-label>
            <input matInput [(ngModel)]="config.host" name="host" required>
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Port</mat-label>
            <input matInput type="number" [(ngModel)]="config.port" name="port" value="22">
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Username</mat-label>
            <input matInput [(ngModel)]="config.username" name="username" required>
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Password</mat-label>
            <input matInput type="password" [(ngModel)]="config.password" name="password">
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Path</mat-label>
            <input matInput [(ngModel)]="config.path" name="path" placeholder="/">
          </mat-form-field>
        </mat-expansion-panel>

        <!-- Manifest URL Configuration -->
        <mat-expansion-panel *ngIf="type === 'MANIFEST_URL'" [expanded]="true">
          <mat-expansion-panel-header>
            <mat-panel-title>Manifest URL Configuration</mat-panel-title>
          </mat-expansion-panel-header>
          <mat-form-field appearance="outline" style="width: 100%;">
            <mat-label>Manifest URL</mat-label>
            <input matInput [(ngModel)]="config.url" name="url" required placeholder="https://example.com/manifest.json">
            <mat-hint>URL that returns a JSON manifest of files to ingest</mat-hint>
          </mat-form-field>
        </mat-expansion-panel>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!isValid()">
        {{ data?.source ? 'Update' : 'Create' }}
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
export class CreateSourceDialogComponent {
  name: string = '';
  type: string = '';
  description: string = '';
  config: any = {};

  constructor(
    public dialogRef: MatDialogRef<CreateSourceDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SourceDialogData
  ) {
    if (data?.source) {
      this.name = data.source.name || '';
      this.type = data.source.type;
      this.description = data.source.description || '';
      this.config = { ...data.source.config_json };
    }
  }

  isValid(): boolean {
    if (!this.type) return false;
    
    if (this.type === 'S3') {
      return !!(this.config.bucket && this.config.accessKeyId && this.config.secretAccessKey);
    } else if (this.type === 'GDRIVE' || this.type === 'DROPBOX') {
      return !!this.config.accessToken;
    } else if (this.type === 'SFTP') {
      return !!(this.config.host && this.config.username);
    } else if (this.type === 'MANIFEST_URL') {
      return !!this.config.url;
    }
    
    return true;
  }

  save() {
    const result = {
      name: this.name || null,
      description: this.description || null,
      type: this.type,
      config_json: this.config,
    };
    this.dialogRef.close(result);
  }

  cancel() {
    this.dialogRef.close();
  }
}

