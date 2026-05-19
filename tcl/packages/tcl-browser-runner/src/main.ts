type TclAnalysisRow = {
  id: string;
  team_id: string;
  trigger?: string;
  status: string;
  report?: {
    scores?: { truth?: number | null; overall?: number | null };
    summary?: string;
    issueCount?: number;
    suggestions?: Array<{ title: string; priority: string; suggestedAction: string }>;
    issues?: Array<{ title: string; severity: string; recommendedAction: string }>;
  };
  error?: string | null;
  created_at?: string;
};

const qs = new URLSearchParams(location.search);
const apiBaseEl = document.getElementById('apiBase') as HTMLInputElement;
const teamIdEl = document.getElementById('teamId') as HTMLInputElement;
const tokenEl = document.getElementById('authToken') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const feedEl = document.getElementById('feed') as HTMLElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;

apiBaseEl.value = qs.get('api') ?? localStorage.getItem('tcl.api') ?? 'http://localhost:3000';
teamIdEl.value = qs.get('teamId') ?? localStorage.getItem('tcl.teamId') ?? '';
tokenEl.value = qs.get('token') ?? localStorage.getItem('tcl.token') ?? '';

let abortStream: AbortController | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function upsertCard(row: TclAnalysisRow): void {
  const existing = feedEl.querySelector(`[data-id="${row.id}"]`);
  if (existing) existing.remove();
  const html = renderCard({
    ...row,
    created_at: row.created_at ?? new Date().toISOString(),
    trigger: row.trigger ?? '—',
  });
  feedEl.insertAdjacentHTML('afterbegin', html);
}

function renderCard(row: TclAnalysisRow): string {
  const r = row.report;
  const score = r?.scores?.overall ?? r?.scores?.truth;
  const suggestions = (r?.suggestions ?? []).slice(0, 3);
  const issues = (r?.issues ?? []).slice(0, 4);

  return `
    <article class="card" data-id="${row.id}">
      <header>
        <span class="pill ${row.status.toLowerCase()}">${row.status}</span>
        <span class="trigger">${escapeHtml(row.trigger ?? '')}</span>
        <time>${new Date(row.created_at!).toLocaleString()}</time>
      </header>
      ${score != null ? `<p class="score">TCL score: <strong>${Math.round(score)}</strong></p>` : ''}
      ${r?.summary ? `<p class="summary">${escapeHtml(r.summary)}</p>` : ''}
      ${row.error ? `<p class="err">${escapeHtml(row.error)}</p>` : ''}
      ${
        issues.length
          ? `<ul class="issues">${issues
              .map(
                (i) =>
                  `<li><strong>${escapeHtml(i.severity)}</strong> ${escapeHtml(i.title)} — ${escapeHtml(i.recommendedAction)}</li>`
              )
              .join('')}</ul>`
          : ''
      }
      ${
        suggestions.length
          ? `<div class="fixes"><h4>Suggested fixes</h4><ul>${suggestions
              .map(
                (s) =>
                  `<li><span class="prio ${s.priority}">${s.priority}</span> ${escapeHtml(s.title)}: ${escapeHtml(s.suggestedAction)}</li>`
              )
              .join('')}</ul></div>`
          : ''
      }
    </article>
  `;
}

async function fetchFeed(): Promise<void> {
  const apiBase = apiBaseEl.value.replace(/\/$/, '');
  const teamId = teamIdEl.value.trim();
  const token = tokenEl.value.trim();
  if (!apiBase || !token) {
    setStatus('need api + token');
    return;
  }

  localStorage.setItem('tcl.api', apiBase);
  localStorage.setItem('tcl.teamId', teamId);
  localStorage.setItem('tcl.token', token);

  const url = new URL(`${apiBase}/api/agent-studio/tcl/live-feed`);
  if (teamId) url.searchParams.set('teamId', teamId);
  url.searchParams.set('limit', '30');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    setStatus(`poll error ${res.status}`);
    return;
  }

  const body = (await res.json()) as { analyses: TclAnalysisRow[]; migrationRequired?: string };
  if (body.migrationRequired) {
    setStatus(`migration: ${body.migrationRequired}`);
    return;
  }
  for (const row of body.analyses ?? []) upsertCard(row);
  setStatus(`poll · ${body.analyses?.length ?? 0} · ${new Date().toLocaleTimeString()}`);
}

async function connectSse(): Promise<void> {
  const apiBase = apiBaseEl.value.replace(/\/$/, '');
  const teamId = teamIdEl.value.trim();
  const token = tokenEl.value.trim();
  if (!apiBase || !token) {
    setStatus('need api + token');
    return;
  }

  localStorage.setItem('tcl.api', apiBase);
  localStorage.setItem('tcl.teamId', teamId);
  localStorage.setItem('tcl.token', token);

  const params = new URLSearchParams();
  if (teamId) params.set('teamId', teamId);
  const url = `${apiBase}/api/agent-studio/tcl/stream?${params}`;

  abortStream?.abort();
  abortStream = new AbortController();

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: abortStream.signal,
  });

  if (!res.ok || !res.body) {
    setStatus(`SSE failed ${res.status} — falling back to poll`);
    pollTimer = setInterval(() => void fetchFeed(), 4000);
    return;
  }

  setStatus('SSE connected');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() ?? '';
    for (const block of blocks) {
      if (!block.includes('event: analysis')) continue;
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const row = JSON.parse(line.slice(6)) as TclAnalysisRow;
        upsertCard(row);
        setStatus(`live · ${row.status} · ${new Date().toLocaleTimeString()}`);
      } catch {
        /* skip */
      }
    }
  }
}

connectBtn.addEventListener('click', () => {
  if (pollTimer) clearInterval(pollTimer);
  abortStream?.abort();
  feedEl.innerHTML = '';
  void fetchFeed().then(() => void connectSse());
});
