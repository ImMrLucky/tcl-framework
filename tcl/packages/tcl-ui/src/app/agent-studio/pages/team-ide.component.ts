import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { Agent, TeamEventLogEntry } from '../agent-studio.types';
import {
  loadMonacoFromCdn,
  type MonacoEditor,
  type MonacoGlobal,
  type MonacoMarkerData,
  type MonacoTextModel,
} from '../monaco-environment';
import { AgentStudioService } from '../agent-studio.service';

interface OpenTab {
  path: string;
  dirty: boolean;
}

/** In-memory workspace persisted to sessionStorage per team. */
const DEFAULT_FILES: Record<string, string> = {
  'README.md': `# Team workspace

Use the file tree to switch files. Monaco provides syntax highlighting, folding, and find/replace (Ctrl+F / Cmd+F).

## Agent Studio

- **Output** tab: model responses and tool logs appear here after dispatch.
- **Terminal**: quick commands (dispatch test) for this team.
`,
  'src/index.ts': `/**
 * Entry — replace with generated agent code.
 */
export function main(): void {
  console.log('Agent Studio IDE');
}

main();
`,
  'src/config.json': `{
  "team": "example",
  "reviewGates": ["SPEC_REVIEW", "CODE_REVIEW"]
}
`,
};

@Component({
  selector: 'app-team-ide',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatTabsModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatSelectModule,
  ],
  template: `
    <section class="ide-wrap">
      <header class="ide-toolbar">
        <mat-form-field appearance="outline" class="tb-field">
          <mat-label>Agent</mat-label>
          <mat-select [(ngModel)]="selectedAgentId">
            <mat-option *ngFor="let a of agents" [value]="a.id">{{ a.name }}</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="tb-field narrow">
          <mat-label>Use case</mat-label>
          <mat-select [(ngModel)]="useCase">
            <mat-option value="chat">chat</mat-option>
            <mat-option value="code">code</mat-option>
            <mat-option value="review">review</mat-option>
            <mat-option value="orchestrate">orchestrate</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="tb-field narrow">
          <mat-label>Task id (optional)</mat-label>
          <input matInput [(ngModel)]="taskId" />
        </mat-form-field>
        <button mat-flat-button color="primary" (click)="runSelectedAgent()">Run agent</button>
        <button mat-stroked-button (click)="askJarvis()">Ask Jarvis</button>
        <button mat-stroked-button (click)="loadJsonl()">JSONL</button>
        <a mat-button [routerLink]="['/agent-studio', 'teams', teamId, 'jarvis']">Jarvis</a>
      </header>
    <section class="ide">
      <aside class="file-tree">
        <header class="tree-head">
          <mat-icon>folder_open</mat-icon>
          <span>Workspace</span>
        </header>
        <button mat-stroked-button class="new-file-btn" (click)="promptNewFile()">
          <mat-icon>note_add</mat-icon>
          New file
        </button>
        <ul>
          <li
            *ngFor="let path of filePaths"
            [class.active]="path === activePath"
            (click)="selectFile(path)"
          >
            <mat-icon>{{ path.includes('/') ? 'description' : 'article' }}</mat-icon>
            <span class="path-label">{{ path }}</span>
          </li>
        </ul>
        <p class="muted small">
          Files are stored in session for this browser (per team). Git sync is a later phase.
        </p>
      </aside>

      <main class="editor-area">
        <div class="tab-strip">
          <button
            type="button"
            class="tab"
            *ngFor="let t of tabs"
            [class.active]="t.path === activePath"
            (click)="selectFile(t.path)"
          >
            {{ fileBasename(t.path) }}
            <span class="dirty" *ngIf="t.dirty">●</span>
            <mat-icon class="close" *ngIf="tabs.length > 1" (click)="closeTab($event, t.path)">close</mat-icon>
          </button>
        </div>

        <div #editorContainer class="monaco-host"></div>

        <div class="bottom-panel">
          <mat-tab-group animationDuration="0ms" [(selectedIndex)]="bottomTabIndex">
            <mat-tab label="Terminal">
              <div class="terminal" tabindex="0">
                <div class="terminal-log" #terminalLog>
                  <div *ngFor="let line of terminalLines" class="term-line">{{ line }}</div>
                  <div class="prompt-row">
                    <span class="prompt">studio$</span>
                    <input
                      class="term-input"
                      [(ngModel)]="terminalInput"
                      (keydown.enter)="runTerminalCommand()"
                      placeholder="help | dispatch &lt;prompt&gt; | clear"
                    />
                  </div>
                </div>
              </div>
            </mat-tab>
            <mat-tab label="Output">
              <pre class="output">{{ outputText || emptyOutputHint }}</pre>
            </mat-tab>
            <mat-tab label="JSONL">
              <pre class="output">{{ jsonlText || 'Load JSONL to see recent team events.' }}</pre>
            </mat-tab>
            <mat-tab label="Problems">
              <ul class="problems" *ngIf="problems.length; else noProblems">
                <li *ngFor="let p of problems" [class]="'sev-' + (p.severity || 'info').toLowerCase()">
                  <strong>L{{ p.startLineNumber }}</strong>: {{ p.message }}
                </li>
              </ul>
              <ng-template #noProblems>
                <p class="muted pad">No problems in the active file.</p>
              </ng-template>
            </mat-tab>
          </mat-tab-group>
        </div>
      </main>
    </section>
    </section>
  `,
  styles: [
    `
      .ide-wrap { display: flex; flex-direction: column; gap: 8px; }
      .ide-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        padding: 8px 12px;
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
      }
      .tb-field { min-width: 160px; margin: 0; }
      .tb-field.narrow { max-width: 140px; }
      .ide {
        display: grid;
        grid-template-columns: 260px 1fr;
        gap: 0;
        height: calc(100vh - 180px);
        min-height: 480px;
        background: #1e1e1e;
        color: #ddd;
        border-radius: 12px;
        overflow: hidden;
      }
      .file-tree {
        background: #252526;
        padding: 12px;
        border-right: 1px solid #333;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .new-file-btn {
        width: 100%;
        color: #ccc;
        border-color: #444;
      }
      .tree-head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        color: #aaa;
        text-transform: uppercase;
        font-size: 12px;
        letter-spacing: 0.5px;
      }
      .file-tree ul {
        list-style: none;
        padding: 0;
        margin: 0;
        flex: 1;
      }
      .file-tree li {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 13px;
      }
      .file-tree li:hover {
        background: rgba(255, 255, 255, 0.06);
      }
      .file-tree li.active {
        background: rgba(30, 144, 255, 0.15);
        color: #fff;
      }
      .path-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-tree mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .file-tree .small {
        font-size: 11px;
      }
      .editor-area {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .tab-strip {
        display: flex;
        flex-wrap: wrap;
        background: #2d2d30;
        border-bottom: 1px solid #1e1e1e;
      }
      .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: #2d2d30;
        border: none;
        border-right: 1px solid #1e1e1e;
        color: #ccc;
        cursor: pointer;
        font-size: 13px;
      }
      .tab.active {
        background: #1e1e1e;
        color: #fff;
      }
      .tab .dirty {
        color: #569cd6;
        font-size: 10px;
      }
      .tab .close {
        font-size: 16px;
        width: 16px;
        height: 16px;
        margin-left: 4px;
        opacity: 0.6;
      }
      .tab .close:hover {
        opacity: 1;
      }
      .monaco-host {
        flex: 1;
        min-height: 200px;
      }
      .bottom-panel {
        border-top: 1px solid #333;
        min-height: 200px;
        max-height: 42%;
        overflow: hidden;
      }
      ::ng-deep .bottom-panel .mat-mdc-tab-header {
        background: #252526;
      }
      ::ng-deep .bottom-panel .mdc-tab__text-label {
        color: #aaa;
      }
      .terminal {
        background: #0c0c0c;
        padding: 12px;
        min-height: 180px;
        font-family: 'Menlo', 'Monaco', monospace;
        font-size: 13px;
      }
      .terminal-log {
        max-height: 220px;
        overflow-y: auto;
      }
      .term-line {
        color: #ccc;
        margin-bottom: 2px;
        white-space: pre-wrap;
      }
      .prompt-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
      }
      .prompt {
        color: #6cc24a;
        flex-shrink: 0;
      }
      .term-input {
        flex: 1;
        background: transparent;
        border: none;
        color: #fff;
        outline: none;
        font: inherit;
      }
      .output {
        background: #0c0c0c;
        padding: 16px;
        color: #aaa;
        font-family: 'Menlo', monospace;
        font-size: 13px;
        min-height: 180px;
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .problems {
        list-style: none;
        margin: 0;
        padding: 8px 16px;
        max-height: 220px;
        overflow-y: auto;
      }
      .problems li {
        padding: 6px 0;
        border-bottom: 1px solid #2a2a2a;
        font-size: 13px;
      }
      .sev-error {
        color: #f48771;
      }
      .sev-warning {
        color: #cca700;
      }
      .sev-info,
      .sev-hint {
        color: #75beff;
      }
      .muted {
        color: #888;
      }
      .pad {
        padding: 16px;
      }
    `,
  ],
})
export class TeamIdeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorContainer', { static: true }) editorHost!: ElementRef<HTMLDivElement>;
  @ViewChild('terminalLog', { static: false }) terminalLog?: ElementRef<HTMLDivElement>;

  teamId = '';
  agents: Agent[] = [];
  selectedAgentId = '';
  useCase = 'chat';
  taskId = '';
  jsonlText = '';
  workspace: Record<string, string> = {};
  filePaths: string[] = [];
  tabs: OpenTab[] = [];
  activePath = 'README.md';
  terminalLines: string[] = ['Agent Studio IDE — type help for commands.'];
  terminalInput = '';
  outputText = '';
  readonly emptyOutputHint =
    'No output yet. Run dispatch with a prompt in the Terminal after configuring model routing and BYOK keys.';
  problems: Array<{
    message: string;
    severity?: string;
    startLineNumber: number;
  }> = [];
  bottomTabIndex = 0;

  private monaco: MonacoGlobal | null = null;
  private editor: MonacoEditor | null = null;
  private contentListener: { dispose: () => void } | null = null;

  constructor(
    private route: ActivatedRoute,
    private studio: AgentStudioService,
    private snack: MatSnackBar
  ) {}

  ngAfterViewInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId') || '';
    this.loadWorkspace();
    this.studio.listAgents(this.teamId).subscribe({
      next: (r) => {
        this.agents = r.agents ?? [];
        const orch = this.agents.find((a) => a.is_orchestrator);
        this.selectedAgentId = orch?.id ?? this.agents[0]?.id ?? '';
      },
    });
    void this.initMonaco();
  }

  ngOnDestroy(): void {
    this.contentListener?.dispose();
    this.editor?.dispose();
    this.editor = null;
    this.monaco = null;
  }

  private storageKey(): string {
    return `agent-studio-ide-workspace:${this.teamId}`;
  }

  private loadWorkspace(): void {
    try {
      const raw = sessionStorage.getItem(this.storageKey());
      this.workspace = raw ? { ...DEFAULT_FILES, ...JSON.parse(raw) } : { ...DEFAULT_FILES };
    } catch {
      this.workspace = { ...DEFAULT_FILES };
    }
    this.filePaths = Object.keys(this.workspace).sort();
    this.tabs = this.filePaths.map((path) => ({ path, dirty: false }));
    if (!this.workspace[this.activePath]) {
      this.activePath = this.filePaths[0] || 'README.md';
    }
  }

  private persistWorkspace(): void {
    try {
      sessionStorage.setItem(this.storageKey(), JSON.stringify(this.workspace));
    } catch {
      /* ignore quota */
    }
  }

  private async initMonaco(): Promise<void> {
    try {
      this.monaco = await loadMonacoFromCdn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.snack.open(`Monaco failed to load: ${msg}`, 'OK', { duration: 8000 });
      return;
    }
    const monaco = this.monaco;
    const el = this.editorHost.nativeElement;
    const uri = monaco.Uri.parse(`inmemory://studio/${this.teamId}/${this.activePath}`);
    const model =
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(this.workspace[this.activePath] ?? '', this.languageForPath(this.activePath), uri);

    this.editor = monaco.editor.create(el, {
      model,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 13,
      wordWrap: 'on',
    });

    this.contentListener = model.onDidChangeContent(() => {
      this.workspace[this.activePath] = model.getValue();
      this.persistWorkspace();
      const tab = this.tabs.find((t) => t.path === this.activePath);
      if (tab) tab.dirty = true;
      this.refreshProblems(monaco, model);
    });

    this.refreshProblems(monaco, model);
  }

  private languageForPath(path: string): string {
    if (path.endsWith('.ts')) return 'typescript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.md')) return 'markdown';
    if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.scss')) return 'scss';
    return 'plaintext';
  }

  fileBasename(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
  }

  selectFile(path: string): void {
    if (path === this.activePath) return;
    this.saveCurrentToWorkspace();
    this.activePath = path;
    if (!this.tabs.find((t) => t.path === path)) {
      this.tabs.push({ path, dirty: false });
    }
    if (!this.editor || !this.monaco) return;
    const monaco = this.monaco;
    const uri = monaco.Uri.parse(`inmemory://studio/${this.teamId}/${path}`);
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(
        this.workspace[path] ?? '',
        this.languageForPath(path),
        uri
      );
    }
    this.editor.setModel(model);
    this.refreshProblems(monaco, model);
  }

  closeTab(ev: Event, path: string): void {
    ev.stopPropagation();
    if (this.tabs.length <= 1) return;
    this.tabs = this.tabs.filter((t) => t.path !== path);
    if (path === this.activePath) {
      this.selectFile(this.tabs[0].path);
    }
  }

  private saveCurrentToWorkspace(): void {
    const m = this.editor?.getModel();
    if (m) {
      this.workspace[this.activePath] = m.getValue();
      this.persistWorkspace();
    }
  }

  promptNewFile(): void {
    const name = window.prompt('New file path (e.g. src/agent.yaml)', 'notes.txt');
    if (!name?.trim()) return;
    const path = name.trim();
    if (this.workspace[path]) {
      this.snack.open('File already exists', 'OK', { duration: 3000 });
      return;
    }
    this.workspace[path] = '';
    this.filePaths = Object.keys(this.workspace).sort();
    this.tabs.push({ path, dirty: true });
    this.persistWorkspace();
    this.selectFile(path);
  }

  private refreshProblems(monaco: MonacoGlobal, model: MonacoTextModel): void {
    const markers: MonacoMarkerData[] = [];
    if (model.getLanguageId() === 'json') {
      try {
        JSON.parse(model.getValue());
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: msg,
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: model.getLineCount(),
          endColumn: model.getLineMaxColumn(model.getLineCount()),
        });
      }
    }
    monaco.editor.setModelMarkers(model, 'studio-json', markers);
    const sevLabel = (n: number): string => {
      const M = monaco.MarkerSeverity;
      if (n === M.Error) return 'Error';
      if (n === M.Warning) return 'Warning';
      if (n === M.Hint) return 'Hint';
      return 'Info';
    };
    this.problems = monaco.editor.getModelMarkers({ resource: model.uri }).map((m) => ({
      message: m.message,
      severity: sevLabel(m.severity),
      startLineNumber: m.startLineNumber,
    }));
  }

  runTerminalCommand(): void {
    const line = this.terminalInput.trim();
    this.terminalInput = '';
    if (!line) return;
    this.terminalLines.push(`studio$ ${line}`);

    const lower = line.toLowerCase();
    if (lower === 'help') {
      this.terminalLines.push(
        'Commands: help | clear | dispatch <prompt> — runs /api/agent-studio/dispatch for first agent on this team.'
      );
      this.scrollTerminal();
      return;
    }
    if (lower === 'clear') {
      this.terminalLines = [];
      this.scrollTerminal();
      return;
    }
    if (lower.startsWith('dispatch ')) {
      const prompt = line.slice('dispatch '.length).trim();
      void this.runDispatch(prompt);
      return;
    }
    this.terminalLines.push(`Unknown command: ${line} (type help)`);
    this.scrollTerminal();
  }

  private scrollTerminal(): void {
    setTimeout(() => {
      const el = this.terminalLog?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  runSelectedAgent(): void {
    const prompt = window.prompt('Prompt for selected agent:');
    if (prompt?.trim()) void this.runDispatch(prompt.trim());
  }

  askJarvis(): void {
    const jarvis = this.agents.find((a) => a.is_orchestrator);
    if (!jarvis) {
      this.snack.open('No Jarvis orchestrator on this team.', 'OK', { duration: 3000 });
      return;
    }
    this.selectedAgentId = jarvis.id;
    this.useCase = 'orchestrate';
    const msg = window.prompt('Ask Jarvis:');
    if (msg?.trim()) {
      this.studio
        .appendTeamEvent(this.teamId, {
          eventType: 'ide.jarvis',
          summary: msg.trim(),
          actorType: 'USER',
          actorName: 'ide',
          jsonl: { priority: 'high' },
        })
        .subscribe({ next: () => this.loadJsonl() });
    }
  }

  loadJsonl(): void {
    this.studio.listTeamEvents(this.teamId, undefined, 50).subscribe({
      next: (r) => {
        const lines = (r.events ?? []).map((e: TeamEventLogEntry) =>
          JSON.stringify({
            seq: e.sequence,
            at: e.created_at,
            actor: e.actor_type,
            type: e.event_type,
            summary: e.summary,
          })
        );
        this.jsonlText = lines.join('\n');
        this.bottomTabIndex = 3;
      },
    });
  }

  private dispatchPayload(prompt: string) {
    const editor = this.editor as { getSelection?: () => { isEmpty: () => boolean } } | null;
    const model = this.editor?.getModel() as { getValueInRange?: (r: unknown) => string } | null;
    const selection = editor?.getSelection?.();
    let selectedText: string | undefined;
    if (model?.getValueInRange && selection && !selection.isEmpty()) {
      selectedText = model.getValueInRange(selection);
    }
    return {
      teamId: this.teamId,
      agentId: this.selectedAgentId,
      prompt,
      useCase: this.useCase,
      taskId: this.taskId.trim() || undefined,
      activeFilePath: this.activePath,
      activeFileContent: this.editor?.getModel()?.getValue(),
      selectedText,
    };
  }

  private async runDispatch(prompt: string): Promise<void> {
    if (!prompt) {
      this.terminalLines.push('Usage: dispatch <your prompt>');
      this.scrollTerminal();
      return;
    }
    const agent = this.agents.find((a) => a.id === this.selectedAgentId) ?? this.agents[0];
    if (!agent) {
      this.terminalLines.push('No agents on this team — create one first.');
      this.scrollTerminal();
      return;
    }
    this.selectedAgentId = agent.id;
    this.terminalLines.push(`Dispatching as ${agent.name} (${this.useCase})…`);
    this.scrollTerminal();
    this.studio.dispatch(this.dispatchPayload(prompt)).subscribe({
      next: (res) => {
        this.outputText = res.text ?? '';
        this.bottomTabIndex = 1;
        this.terminalLines.push(`Done (${res.provider} / ${res.model}).`);
        this.scrollTerminal();
      },
      error: (err) => {
        const msg = err?.error?.message || err?.error?.error || err?.message || 'Dispatch failed';
        this.terminalLines.push(`Error: ${msg}`);
        this.snack.open(String(msg), 'OK', { duration: 6000 });
        this.scrollTerminal();
      },
    });
  }
}
