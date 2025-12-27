import { Component, EventEmitter, Input, Output, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { ValidationOptions, Source } from '../types';

@Component({
  selector: 'app-original-input-panel',
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
    MatIconModule,
    MatSliderModule
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
              rows="4"
              placeholder="Enter your question here..."
            ></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Model Answer</mat-label>
            <textarea
              matInput
              [(ngModel)]="answer"
              name="answer"
              rows="8"
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
            <h3>Engine Settings</h3>
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

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>
                <mat-icon>tune</mat-icon>
                Graph Thresholds
              </mat-panel-title>
            </mat-expansion-panel-header>
            <div class="thresholds-section">
              <div class="threshold-item">
                <label>Support Threshold</label>
                <div class="threshold-control">
                  <mat-slider
                    [min]="0"
                    [max]="1"
                    [step]="0.01"
                    [displayWith]="formatLabel"
                  >
                    <input matSliderThumb [(ngModel)]="options.supportThreshold" name="supportThreshold">
                  </mat-slider>
                  <input
                    type="number"
                    [(ngModel)]="options.supportThreshold"
                    (ngModelChange)="onThresholdInputChange('supportThreshold', $event)"
                    [min]="0"
                    [max]="1"
                    [step]="0.01"
                    name="supportThresholdInput"
                    class="threshold-input"
                  >
                </div>
              </div>

              <div class="threshold-item">
                <label>Contradiction Threshold</label>
                <div class="threshold-control">
                  <mat-slider
                    [min]="0"
                    [max]="1"
                    [step]="0.01"
                    [displayWith]="formatLabel"
                  >
                    <input matSliderThumb [(ngModel)]="options.contradictionThreshold" name="contradictionThreshold">
                  </mat-slider>
                  <input
                    type="number"
                    [(ngModel)]="options.contradictionThreshold"
                    (ngModelChange)="onThresholdInputChange('contradictionThreshold', $event)"
                    [min]="0"
                    [max]="1"
                    [step]="0.01"
                    name="contradictionThresholdInput"
                    class="threshold-input"
                  >
                </div>
              </div>

              <div class="threshold-item">
                <label>Grounding Threshold</label>
                <div class="threshold-control">
                  <mat-slider
                    [min]="0"
                    [max]="1"
                    [step]="0.01"
                    [displayWith]="formatLabel"
                  >
                    <input matSliderThumb [(ngModel)]="options.groundingThreshold" name="groundingThreshold">
                  </mat-slider>
                  <input
                    type="number"
                    [(ngModel)]="options.groundingThreshold"
                    (ngModelChange)="onThresholdInputChange('groundingThreshold', $event)"
                    [min]="0"
                    [max]="1"
                    [step]="0.01"
                    name="groundingThresholdInput"
                    class="threshold-input"
                  >
                </div>
              </div>
            </div>
          </mat-expansion-panel>

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>
                <mat-icon>settings</mat-icon>
                Advanced Options
              </mat-panel-title>
            </mat-expansion-panel-header>
            <div class="advanced-section">
              <div class="threshold-item">
                <label>Max Pairwise Edges</label>
                <div class="threshold-control">
                  <mat-slider
                    [min]="0"
                    [max]="10000"
                    [step]="10"
                    [displayWith]="formatInteger"
                  >
                    <input matSliderThumb [(ngModel)]="options.maxPairwiseEdges" name="maxPairwiseEdges">
                  </mat-slider>
                  <input
                    type="number"
                    [(ngModel)]="options.maxPairwiseEdges"
                    (ngModelChange)="onThresholdInputChange('maxPairwiseEdges', $event)"
                    [min]="0"
                    [max]="10000"
                    [step]="10"
                    name="maxPairwiseEdgesInput"
                    class="threshold-input"
                  >
                </div>
              </div>

              <div class="threshold-item">
                <label>Neighbor K</label>
                <div class="threshold-control">
                  <mat-slider
                    [min]="1"
                    [max]="50"
                    [step]="1"
                    [displayWith]="formatInteger"
                  >
                    <input matSliderThumb [(ngModel)]="options.neighborK" name="neighborK">
                  </mat-slider>
                  <input
                    type="number"
                    [(ngModel)]="options.neighborK"
                    (ngModelChange)="onThresholdInputChange('neighborK', $event)"
                    [min]="1"
                    [max]="50"
                    [step]="1"
                    name="neighborKInput"
                    class="threshold-input"
                  >
                </div>
              </div>
            </div>
          </mat-expansion-panel>

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

    .thresholds-section,
    .advanced-section {
      padding: 16px 0;
    }

    .threshold-item {
      margin-bottom: 24px;
    }

    .threshold-item label {
      display: block;
      margin-bottom: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      color: #666;
    }

    .threshold-control {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .threshold-control mat-slider {
      flex: 1;
    }

    .threshold-input {
      width: 80px;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 0.875rem;
    }

    .threshold-input:focus {
      outline: none;
      border-color: #1976d2;
    }
  `]
})
export class OriginalInputPanelComponent implements OnInit, OnChanges {
  @Output() validate = new EventEmitter<{
    question: string;
    answer: string;
    sources?: Source[];
    options: ValidationOptions;
  }>();
  @Input() loading = false;
  @Input() initialQuestion = '';
  @Input() initialAnswer = '';
  @Input() initialSources: Source[] | undefined = undefined;
  @Input() initialOptions: any = {};

  question = '';
  answer = '';
  sources: Source[] = [{ id: 's1', text: '' }];
  options: ValidationOptions = {
    spectral: false,
    ann: true,
    cache: true,
    supportThreshold: 0.58,
    contradictionThreshold: 0.70,
    groundingThreshold: 0.60,
    maxPairwiseEdges: 200,
    neighborK: 12,
  };

  ngOnInit() {
    if (this.initialQuestion) {
      this.question = this.initialQuestion;
    }
    if (this.initialAnswer) {
      this.answer = this.initialAnswer;
    }
    if (this.initialSources && this.initialSources.length > 0) {
      this.sources = this.initialSources.map(s => ({ ...s }));
    }
    if (this.initialOptions && Object.keys(this.initialOptions).length > 0) {
      this.options = {
        ...this.options,
        ...this.initialOptions,
        supportThreshold: this.initialOptions.supportThreshold ?? this.options.supportThreshold,
        contradictionThreshold: this.initialOptions.contradictionThreshold ?? this.options.contradictionThreshold,
        groundingThreshold: this.initialOptions.groundingThreshold ?? this.options.groundingThreshold,
        maxPairwiseEdges: this.initialOptions.maxPairwiseEdges ?? this.options.maxPairwiseEdges,
        neighborK: this.initialOptions.neighborK ?? this.options.neighborK,
      };
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['initialQuestion'] && this.initialQuestion) {
      this.question = this.initialQuestion;
    }
    if (changes['initialAnswer'] && this.initialAnswer) {
      this.answer = this.initialAnswer;
    }
    if (changes['initialSources'] && this.initialSources && this.initialSources.length > 0) {
      this.sources = this.initialSources.map(s => ({ ...s }));
    }
    if (changes['initialOptions'] && this.initialOptions && Object.keys(this.initialOptions).length > 0) {
      this.options = {
        ...this.options,
        ...this.initialOptions,
        supportThreshold: this.initialOptions.supportThreshold ?? this.options.supportThreshold,
        contradictionThreshold: this.initialOptions.contradictionThreshold ?? this.options.contradictionThreshold,
        groundingThreshold: this.initialOptions.groundingThreshold ?? this.options.groundingThreshold,
        maxPairwiseEdges: this.initialOptions.maxPairwiseEdges ?? this.options.maxPairwiseEdges,
        neighborK: this.initialOptions.neighborK ?? this.options.neighborK,
      };
    }
  }

  addSource() {
    this.sources.push({ id: `s${this.sources.length + 1}`, text: '' });
  }

  removeSource(index: number) {
    this.sources.splice(index, 1);
  }

  formatLabel(value: number): string {
    return value.toFixed(2);
  }

  formatInteger(value: number): string {
    return Math.round(value).toString();
  }

  onThresholdInputChange(key: string, value: number) {
    if (key === 'supportThreshold' || key === 'contradictionThreshold' || key === 'groundingThreshold') {
      value = Math.max(0, Math.min(1, value));
    } else if (key === 'maxPairwiseEdges') {
      value = Math.max(0, Math.min(10000, value));
    } else if (key === 'neighborK') {
      value = Math.max(1, Math.min(50, Math.round(value)));
    }
    (this.options as any)[key] = value;
  }

  onSubmit() {
    // Validate that both question and answer are provided and not empty
    const trimmedQuestion = this.question?.trim() || '';
    const trimmedAnswer = this.answer?.trim() || '';
    
    if (!trimmedQuestion || !trimmedAnswer) {
      alert('Please provide both a question and an answer before validating.');
      return;
    }
    
    const validSources = this.sources.filter(s => s.text.trim().length > 0);
    this.validate.emit({
      question: trimmedQuestion,
      answer: trimmedAnswer,
      sources: validSources.length > 0 ? validSources : undefined,
      options: this.options,
    });
  }
}

