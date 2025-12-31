import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../auth.service';

export interface ReauthDialogData {
  action: string;
  actionDescription: string;
}

@Component({
  selector: 'app-reauth-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="reauth-dialog">
      <div class="dialog-header">
        <mat-icon class="lock-icon">lock</mat-icon>
        <h2>Confirm Your Identity</h2>
      </div>
      
      <mat-dialog-content>
        <p class="action-description">
          <mat-icon class="action-icon">security</mat-icon>
          <span>{{ data.actionDescription }}</span>
        </p>
        
        <p class="prompt-text">
          Please confirm your password to continue.
        </p>
        
        <mat-form-field appearance="outline" class="password-field">
          <mat-label>Password</mat-label>
          <input matInput 
                 [type]="hidePassword ? 'password' : 'text'"
                 [(ngModel)]="password"
                 (keydown.enter)="confirm()"
                 [disabled]="isVerifying"
                 autocomplete="current-password">
          <button mat-icon-button 
                  matSuffix 
                  (click)="hidePassword = !hidePassword"
                  type="button"
                  [disabled]="isVerifying">
            <mat-icon>{{ hidePassword ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
          <mat-error *ngIf="errorMessage">{{ errorMessage }}</mat-error>
        </mat-form-field>
      </mat-dialog-content>
      
      <mat-dialog-actions align="end">
        <button mat-button 
                mat-dialog-close 
                [disabled]="isVerifying">
          Cancel
        </button>
        <button mat-raised-button 
                color="primary" 
                (click)="confirm()"
                [disabled]="!password || isVerifying">
          <mat-spinner *ngIf="isVerifying" diameter="20"></mat-spinner>
          <span *ngIf="!isVerifying">Confirm</span>
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .reauth-dialog {
      min-width: 360px;
    }
    
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    
    .dialog-header h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
    }
    
    .lock-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: #1976d2;
    }
    
    .action-description {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: #fff3e0;
      border-radius: 8px;
      margin-bottom: 16px;
      color: #e65100;
    }
    
    .action-icon {
      flex-shrink: 0;
    }
    
    .prompt-text {
      margin-bottom: 16px;
      color: #666;
    }
    
    .password-field {
      width: 100%;
    }
    
    mat-dialog-actions {
      padding-top: 16px;
    }
    
    mat-dialog-actions button {
      min-width: 100px;
    }
    
    mat-dialog-actions mat-spinner {
      margin: 0 auto;
    }
  `]
})
export class ReauthDialogComponent {
  password = '';
  hidePassword = true;
  isVerifying = false;
  errorMessage = '';

  constructor(
    public dialogRef: MatDialogRef<ReauthDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ReauthDialogData,
    private authService: AuthService
  ) {}

  async confirm() {
    if (!this.password) {
      this.errorMessage = 'Password is required';
      return;
    }

    this.isVerifying = true;
    this.errorMessage = '';

    try {
      const result = await this.authService.reAuthenticate(this.password);
      
      if (result.success) {
        this.dialogRef.close(true);
      } else {
        this.errorMessage = result.error || 'Invalid password';
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'Verification failed';
    } finally {
      this.isVerifying = false;
    }
  }
}

