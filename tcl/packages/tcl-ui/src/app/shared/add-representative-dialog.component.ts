import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface AddRepresentativeDialogData {
  displayName: string;
}

@Component({
  selector: 'app-add-representative-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>Add Representative</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="data.displayName" placeholder="e.g., Vanessa Smith" required>
        <mat-hint>Enter the representative's display name</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!data.displayName.trim()">
        Add
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
    }
    mat-dialog-content {
      padding: 20px;
    }
    mat-dialog-actions {
      padding: 10px 20px;
    }
  `]
})
export class AddRepresentativeDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<AddRepresentativeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AddRepresentativeDialogData
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.data.displayName.trim()) {
      this.dialogRef.close(this.data);
    }
  }
}

