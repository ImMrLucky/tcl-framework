import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { EvidenceService, EvidenceItem } from '../evidence.service';
import { AuthService } from '../auth.service';
import { firstValueFrom } from 'rxjs';

interface DialogData {
  orgId: string;
  scope: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';
  projectId?: string;
  conversationId?: string;
  templateId?: string;
}

@Component({
  selector: 'app-evidence-upload-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatSnackBarModule,
    MatChipsModule,
    MatTabsModule
  ],
  templateUrl: './evidence-upload-dialog.component.html',
  styleUrls: ['./evidence-upload-dialog.component.scss']
})
export class EvidenceUploadDialogComponent {
  // Upload method
  uploadMethod: 'file' | 'link' = 'file';
  selectedTabIndex = 0; // For mat-tab-group selectedIndex binding
  
  // File upload
  selectedFile: File | null = null;
  
  // Link upload
  linkUrl = '';
  snapshotLink = true;
  
  // Common fields
  title = '';
  description = '';
  sourceType: EvidenceItem['sourceType'] = 'POLICY';
  authorityLevel: 'BINDING' | 'INFORMATIONAL' = 'INFORMATIONAL';
  overridePolicy: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE' = 'ALLOW_SUPPLEMENT';
  tags: string[] = [];
  newTag = '';
  regions: string[] = [];
  newRegion = '';
  
  uploading = false;
  canLock = false; // Admin/owner only

  constructor(
    public dialogRef: MatDialogRef<EvidenceUploadDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData,
    private evidenceService: EvidenceService,
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {
    // Validate data immediately - close dialog if critical data is missing
    if (!data || !data.orgId) {
      console.error('EvidenceUploadDialogComponent: Missing required data', data);
      // Close dialog after a short delay to allow error to be logged
      setTimeout(() => {
        this.dialogRef.close(false);
      }, 100);
      return;
    }

    // Initialize with safe defaults
    try {
      // Check if user can lock (admin/owner)
      const user = this.authService.getCurrentUser();
      // TODO: Check user role - for now, allow if ORG scope
      this.canLock = data.scope === 'ORG';
    } catch (userError) {
      console.error('Error getting current user:', userError);
      this.canLock = false;
    }
    
    // Set default override policy based on authority level
    if (this.authorityLevel === 'BINDING') {
      this.overridePolicy = 'LOCKED';
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      if (!this.title) {
        this.title = file.name;
      }
    }
  }

  addTag() {
    if (this.newTag.trim() && !this.tags.includes(this.newTag.trim())) {
      this.tags.push(this.newTag.trim());
      this.newTag = '';
    }
  }

  removeTag(tag: string) {
    this.tags = this.tags.filter(t => t !== tag);
  }

  addRegion() {
    if (this.newRegion.trim() && !this.regions.includes(this.newRegion.trim())) {
      this.regions.push(this.newRegion.trim());
      this.newRegion = '';
    }
  }

  removeRegion(region: string) {
    this.regions = this.regions.filter(r => r !== region);
  }

  onAuthorityLevelChange() {
    // Auto-set override policy for BINDING
    if (this.authorityLevel === 'BINDING' && this.data.scope === 'ORG') {
      this.overridePolicy = 'LOCKED';
    } else if (this.authorityLevel === 'INFORMATIONAL' && this.overridePolicy === 'LOCKED') {
      this.overridePolicy = 'ALLOW_SUPPLEMENT';
    }
  }

  cancel() {
    this.dialogRef.close();
  }

  async upload() {
    // Validate data exists
    if (!this.data || !this.data.orgId) {
      this.snackBar.open('Error: Missing organization data', 'Close', { duration: 3000 });
      return;
    }

    if (this.uploadMethod === 'file' && !this.selectedFile) {
      this.snackBar.open('Please select a file', 'Close', { duration: 3000 });
      return;
    }
    
    if (this.uploadMethod === 'link' && !this.linkUrl.trim()) {
      this.snackBar.open('Please enter a URL', 'Close', { duration: 3000 });
      return;
    }
    
    if (!this.title.trim()) {
      this.snackBar.open('Title is required', 'Close', { duration: 3000 });
      return;
    }

    this.uploading = true;
    let uploadCompleted = false;
    
    try {
      let result: EvidenceItem | undefined;
      
      // Add timeout to prevent hanging requests
      const timeoutMs = 60000; // 60 seconds
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Upload request timed out after 60 seconds')), timeoutMs);
      });
      
      if (this.uploadMethod === 'file' && this.selectedFile) {
        const uploadObservable = this.evidenceService.uploadEvidenceFile(
          this.selectedFile,
          this.data.orgId,
          this.sourceType,
          this.title,
          {
            projectId: this.data.projectId,
            conversationId: this.data.conversationId,
            templateId: this.data.templateId,
            scope: this.data.scope,
            description: this.description || undefined,
            tags: this.tags.length > 0 ? this.tags : undefined,
            regions: this.regions.length > 0 ? this.regions : undefined,
          }
        );
        
        result = await Promise.race([
          firstValueFrom(uploadObservable),
          timeoutPromise
        ]);
      } else if (this.uploadMethod === 'link') {
        const linkObservable = this.evidenceService.addEvidenceLink(
          this.linkUrl,
          this.data.orgId,
          this.sourceType,
          this.title,
          {
            projectId: this.data.projectId,
            conversationId: this.data.conversationId,
            templateId: this.data.templateId,
            scope: this.data.scope,
            description: this.description || undefined,
            tags: this.tags.length > 0 ? this.tags : undefined,
            regions: this.regions.length > 0 ? this.regions : undefined,
            snapshotLink: this.snapshotLink,
          }
        );
        
        result = await Promise.race([
          firstValueFrom(linkObservable),
          timeoutPromise
        ]);
      } else {
        throw new Error('Invalid upload method');
      }
      
      if (!result) {
        this.snackBar.open('Failed to upload evidence: No response from server', 'Close', { duration: 5000 });
        return;
      }
      
      uploadCompleted = true;
      
      // Update with authority level and override policy if ORG scope
      if (this.data.scope === 'ORG' && result) {
        try {
          await Promise.race([
            firstValueFrom(
              this.evidenceService.updateEvidenceItem(result.id, {
                authorityLevel: this.authorityLevel,
                overridePolicy: this.overridePolicy,
              })
            ),
            timeoutPromise
          ]);
        } catch (updateError: any) {
          // Log but don't fail the upload if the update fails
          console.warn('Failed to update authority level/override policy:', updateError);
          this.snackBar.open('Evidence uploaded but failed to update settings: ' + (updateError.error?.error || updateError.message), 'Close', {
            duration: 5000
          });
        }
      }
      
      this.snackBar.open('Evidence uploaded successfully', 'Close', { duration: 3000 });
      this.dialogRef.close(true);
    } catch (error: any) {
      console.error('Failed to upload evidence:', error);
      const errorMessage = error.error?.error || error.message || 'Unknown error';
      this.snackBar.open('Failed to upload evidence: ' + errorMessage, 'Close', {
        duration: 5000
      });
    } finally {
      // Always reset uploading state, even if there was an error
      this.uploading = false;
    }
  }

  getSourceTypeOptions(): Array<{ value: EvidenceItem['sourceType']; label: string }> {
    return [
      { value: 'POLICY', label: 'Policy' },
      { value: 'RULESET', label: 'Ruleset' },
      { value: 'KNOWLEDGE', label: 'Knowledge' },
      { value: 'ACCOUNT_FACTS', label: 'Account Facts' },
      { value: 'LEGAL', label: 'Legal' },
      { value: 'URL_LINK', label: 'URL Link' },
      { value: 'SYSTEM_EXPORT', label: 'System Export' }
    ];
  }
}

