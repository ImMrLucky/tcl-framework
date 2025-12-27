import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ClaimWithMetadata } from '../types';

@Component({
  selector: 'app-claim-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatTooltipModule
  ],
  template: `
    <mat-card class="claim-table-card">
      <mat-card-header>
        <mat-card-title>Claim Table</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <div *ngIf="loading" class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>

        <div *ngIf="!loading && claims.length === 0" class="empty-state">
          <mat-icon>table_chart</mat-icon>
          <p>No claims to display</p>
        </div>

        <div *ngIf="!loading && claims.length > 0" class="table-container">
          <table mat-table [dataSource]="claims" class="claims-table">
            <ng-container matColumnDef="claim">
              <th mat-header-cell *matHeaderCellDef>Claim</th>
              <td mat-cell *matCellDef="let claim" class="claim-text">{{ claim.text }}</td>
            </ng-container>

            <ng-container matColumnDef="grounded">
              <th mat-header-cell *matHeaderCellDef>Grounded</th>
              <td mat-cell *matCellDef="let claim">
                <mat-icon [class]="claim.grounded ? 'icon-success' : 'icon-error'">
                  {{ claim.grounded ? 'check_circle' : 'cancel' }}
                </mat-icon>
              </td>
            </ng-container>

            <ng-container matColumnDef="support">
              <th mat-header-cell *matHeaderCellDef>Support</th>
              <td mat-cell *matCellDef="let claim">
                <span [class]="claim.supportCount > 0 ? 'count-badge support' : 'count-badge'">
                  {{ claim.supportCount }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="contradiction">
              <th mat-header-cell *matHeaderCellDef>Contradiction</th>
              <td mat-cell *matCellDef="let claim">
                <span [class]="claim.contradictionCount > 0 ? 'count-badge contradiction' : 'count-badge'">
                  {{ claim.contradictionCount }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="inCycles">
              <th mat-header-cell *matHeaderCellDef>In Cycles</th>
              <td mat-cell *matCellDef="let claim">
                <mat-icon
                  [class]="claim.inCycles ? 'icon-warning' : 'icon-neutral'"
                  [matTooltip]="claim.inCycles ? 'This claim is part of a circular reasoning pattern' : 'No cycles detected'"
                >
                  {{ claim.inCycles ? 'refresh' : 'check' }}
                </mat-icon>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
          </table>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .claim-table-card {
      min-height: 400px;
    }

    .loading-container {
      display: flex;
      justify-content: center;
      padding: 40px;
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

    .table-container {
      overflow-x: auto;
    }

    .claims-table {
      width: 100%;
    }

    .claim-text {
      max-width: 400px;
      word-wrap: break-word;
      line-height: 1.5;
    }

    .count-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 12px;
      background: #e0e0e0;
      color: #666;
      font-size: 0.875rem;
      font-weight: 500;
      min-width: 32px;
      text-align: center;
    }

    .count-badge.support {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .count-badge.contradiction {
      background: #ffebee;
      color: #c62828;
    }

    .icon-success {
      color: #4caf50;
    }

    .icon-error {
      color: #f44336;
    }

    .icon-warning {
      color: #ff9800;
    }

    .icon-neutral {
      color: #9e9e9e;
    }

    th {
      font-weight: 500;
      color: #666;
    }

    td, th {
      padding: 12px 16px;
    }
  `]
})
export class ClaimTableComponent {
  @Input() claims: ClaimWithMetadata[] = [];
  @Input() loading = false;

  displayedColumns: string[] = ['claim', 'grounded', 'support', 'contradiction', 'inCycles'];
}

