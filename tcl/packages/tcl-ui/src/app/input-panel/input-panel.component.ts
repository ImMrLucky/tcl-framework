import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-input-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatIconModule
  ],
  template: `
    <mat-card class="input-panel">
      <mat-card-header>
        <mat-card-title>Input</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <form (ngSubmit)="onSubmit()">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Question</mat-label>
            <textarea
              matInput
              [(ngModel)]="question"
              name="question"
              rows="3"
              placeholder="Enter your question here..."
            ></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Model Answer</mat-label>
            <textarea
              matInput
              [(ngModel)]="answer"
              name="answer"
              rows="6"
              placeholder="Enter the model's answer here..."
            ></textarea>
          </mat-form-field>

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>
                <mat-icon>description</mat-icon>
                Sources (Optional)
              </mat-panel-title>
            </mat-expansion-panel-header>
            <div class="sources-section">
              <div *ngFor="let source of sources; let i = index" class="source-item">
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Source {{ i + 1 }}</mat-label>
                  <textarea
                    matInput
                    [(ngModel)]="source.text"
                    [name]="'source-' + i"
                    rows="3"
                    placeholder="Source text..."
                  ></textarea>
                </mat-form-field>
                <button
                  mat-icon-button
                  color="warn"
                  (click)="removeSource(i)"
                  *ngIf="sources.length > 1"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
              <button mat-stroked-button type="button" (click)="addSource()">
                <mat-icon>add</mat-icon>
                Add Source
              </button>
            </div>
          </mat-expansion-panel>

          <div class="validation-options">
            <h3>Validation Options</h3>
            <div class="options-grid">
              <mat-checkbox [(ngModel)]="options.spectral" name="spectral">
                Spectral
              </mat-checkbox>
              <mat-checkbox [(ngModel)]="options.ann" name="ann">
                ANN
              </mat-checkbox>
              <mat-checkbox [(ngModel)]="options.cache" name="cache">
                Cache
              </mat-checkbox>
            </div>
          </div>

          <button
            mat-raised-button
            color="primary"
            type="submit"
            class="submit-button"
            [disabled]="loading || !question || !answer"
          >
            <mat-icon>play_arrow</mat-icon>
            Validate
          </button>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .input-panel {
      margin-bottom: 20px;
    }

    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    .sources-section {
      padding: 16px 0;
    }

    .source-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 16px;
    }

    .source-item mat-form-field {
      flex: 1;
    }

    .validation-options {
      margin: 24px 0;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 4px;
    }

    .validation-options h3 {
      margin-bottom: 16px;
      font-size: 1rem;
      font-weight: 500;
    }

    .options-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .submit-button {
      width: 100%;
      margin-top: 16px;
      height: 48px;
    }

    mat-expansion-panel {
      margin-bottom: 16px;
    }
  `]
})
export class InputPanelComponent {
  @Output() validate = new EventEmitter<{
    question: string;
    answer: string;
    sources?: { id: string; text: string }[];
    options: { spectral: boolean; ann: boolean; cache: boolean };
  }>();
  @Input() loading = false;

  question = '';
  answer = '';
  sources: { id: string; text: string }[] = [{ id: 's1', text: '' }];
  options = {
    spectral: true, // Enable Spectral analysis (requires TCL_SPECTRAL_URL to be configured)
    ann: true,
    cache: true,
  };

  addSource() {
    this.sources.push({ id: `s${this.sources.length + 1}`, text: '' });
  }

  removeSource(index: number) {
    this.sources.splice(index, 1);
  }

  onSubmit() {
    const validSources = this.sources.filter(s => s.text.trim().length > 0);
    this.validate.emit({
      question: this.question,
      answer: this.answer,
      sources: validSources.length > 0 ? validSources : undefined,
      options: this.options,
    });
  }
}

