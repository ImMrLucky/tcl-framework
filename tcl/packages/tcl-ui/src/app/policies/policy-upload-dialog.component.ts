import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PoliciesService } from '../policies.service';

@Component({
  selector: 'app-policy-upload-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title>Upload Policy</h2>
    <mat-dialog-content>
      <div class="upload-form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Policy Name</mat-label>
          <input matInput [(ngModel)]="name" required>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Description (optional)</mat-label>
          <input matInput [(ngModel)]="description">
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Version</mat-label>
          <input matInput [(ngModel)]="version" placeholder="1.0.0">
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Policy Content</mat-label>
          <textarea matInput [(ngModel)]="content" rows="10" required placeholder="Paste or type policy content here..."></textarea>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="upload()" [disabled]="!name || !content || uploading">
        <mat-icon *ngIf="!uploading">upload</mat-icon>
        <mat-spinner *ngIf="uploading" diameter="20"></mat-spinner>
        {{ uploading ? 'Uploading...' : 'Upload' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .upload-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 500px;
      padding: 16px 0;
    }

    .full-width {
      width: 100%;
    }

    mat-dialog-content {
      max-height: 70vh;
      overflow-y: auto;
    }
  `]
})
export class PolicyUploadDialogComponent {
  name = '';
  description = '';
  version = '1.0.0';
  content = '';
  uploading = false;

  constructor(
    public dialogRef: MatDialogRef<PolicyUploadDialogComponent>,
    private policiesService: PoliciesService,
    private snackBar: MatSnackBar
  ) {}

  cancel() {
    this.dialogRef.close();
  }

  async upload() {
    if (!this.name || !this.content) {
      return;
    }

    this.uploading = true;
    try {
      await this.policiesService.createPolicy({
        name: this.name,
        description: this.description || undefined,
        content: this.content,
        version: this.version || '1.0.0',
      }).toPromise();
      
      this.snackBar.open('Policy uploaded successfully', 'Close', { duration: 3000 });
      this.dialogRef.close(true);
    } catch (error: any) {
      console.error('Failed to upload policy:', error);
      this.snackBar.open('Failed to upload policy: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.uploading = false;
    }
  }
}

