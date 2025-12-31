import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from './auth.service';
import { ReauthDialogComponent } from './reauth-dialog/reauth-dialog.component';
import { firstValueFrom } from 'rxjs';

export type SensitiveAction = 
  | 'delete_evaluation'
  | 'export_audit_packet'
  | 'change_org_settings'
  | 'manage_api_keys'
  | 'modify_integrations'
  | 'delete_organization'
  | 'transfer_ownership';

const ACTION_DESCRIPTIONS: Record<SensitiveAction, string> = {
  'delete_evaluation': 'You are about to permanently delete an evaluation. This action cannot be undone.',
  'export_audit_packet': 'You are about to export sensitive audit data. This will create a downloadable file.',
  'change_org_settings': 'You are about to modify organization settings. This may affect all team members.',
  'manage_api_keys': 'You are about to manage API keys. Changes here can affect system integrations.',
  'modify_integrations': 'You are about to modify integrations. This may affect data flow to external systems.',
  'delete_organization': 'You are about to delete the organization. This action is permanent and cannot be undone.',
  'transfer_ownership': 'You are about to transfer organization ownership. This is a significant action.'
};

@Injectable({
  providedIn: 'root'
})
export class SensitiveActionService {
  constructor(
    private dialog: MatDialog,
    private authService: AuthService
  ) {}

  /**
   * Verify user identity before performing a sensitive action
   * Returns true if the action is authorized, false otherwise
   */
  async verifyForAction(action: SensitiveAction): Promise<boolean> {
    // Check if user has recently re-authenticated
    if (this.authService.hasRecentReauth()) {
      return true;
    }

    // Open re-auth dialog
    const dialogRef = this.dialog.open(ReauthDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        action,
        actionDescription: ACTION_DESCRIPTIONS[action] || 'This is a sensitive action.'
      }
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    return result === true;
  }

  /**
   * Execute a sensitive action with re-authentication if needed
   */
  async executeWithReauth<T>(
    action: SensitiveAction,
    callback: () => Promise<T>
  ): Promise<{ success: boolean; result?: T; cancelled?: boolean; error?: string }> {
    try {
      const authorized = await this.verifyForAction(action);
      
      if (!authorized) {
        return { success: false, cancelled: true };
      }

      const result = await callback();
      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message || 'Action failed' };
    }
  }
}

