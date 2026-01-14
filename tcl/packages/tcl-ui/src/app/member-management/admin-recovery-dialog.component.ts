import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth.service';

export interface AdminRecoveryDialogData {
  orgId: string;
}

@Component({
  selector: 'app-admin-recovery-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon color="warn" style="vertical-align: middle; margin-right: 8px;">warning</mat-icon>
      Admin Recovery Request
    </h2>
    <mat-dialog-content>
      <div class="recovery-content">
        <p class="warning-text">
          <strong>Break Glass Emergency Access</strong>
        </p>
        <p>
          Your organization has no administrators. This is a security-critical situation.
          Submit a recovery request to restore administrative access.
        </p>
        <p class="info-text">
          A support team member will review your request and restore admin access.
          This process may take 24-48 hours.
        </p>
        
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Reason for Recovery Request</mat-label>
          <textarea 
            matInput 
            [(ngModel)]="reason" 
            rows="4" 
            placeholder="Please explain why you need admin recovery (e.g., previous admin left, account locked, etc.)"
            required></textarea>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()" [disabled]="submitting">Cancel</button>
      <button 
        mat-raised-button 
        color="warn" 
        (click)="submit()" 
        [disabled]="!reason || submitting">
        <mat-icon *ngIf="!submitting">send</mat-icon>
        <span *ngIf="submitting">Submitting...</span>
        <span *ngIf="!submitting">Submit Request</span>
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .recovery-content {
      min-width: 400px;
      max-width: 600px;
    }

    .warning-text {
      color: #d32f2f;
      font-size: 1.1rem;
      margin-bottom: 16px;
    }

    .info-text {
      color: #666;
      font-size: 0.9rem;
      margin-bottom: 24px;
    }

    .full-width {
      width: 100%;
    }

    mat-dialog-actions {
      padding: 16px 24px;
    }
  `]
})
export class AdminRecoveryDialogComponent {
  reason = '';
  submitting = false;

  constructor(
    public dialogRef: MatDialogRef<AdminRecoveryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AdminRecoveryDialogData,
    private http: HttpClient,
    private authService: AuthService
  ) {}

  cancel() {
    this.dialogRef.close(false);
  }

  async submit() {
    if (!this.reason.trim()) {
      return;
    }

    this.submitting = true;
    try {
      const apiBase = this.authService.getApiBaseUrl();
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; message?: string; error?: string; requestId?: string }>(
          `${apiBase}/orgs/${this.data.orgId}/admin-recovery`,
          { reason: this.reason.trim() }
        )
      );

      if (response.success) {
        this.dialogRef.close({
          success: true,
          message: response.message || 'Recovery request submitted successfully',
          requestId: response.requestId
        });
      } else {
        alert(response.error || 'Failed to submit recovery request');
        this.submitting = false;
      }
    } catch (error: any) {
      console.error('Failed to submit recovery request:', error);
      alert('Failed to submit recovery request: ' + (error.error?.error || error.message || 'Unknown error'));
      this.submitting = false;
    }
  }
}

