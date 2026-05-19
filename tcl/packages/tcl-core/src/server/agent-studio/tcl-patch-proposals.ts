/**
 * Build patch proposals from TCL analysis reports (suggested fixes → reviewable diffs).
 */

import { supabaseAdmin } from '../supabase.js';
import type { StudioTclReport } from '../../studio/types.js';
import type { Suggestion } from '../../types.js';

export type PatchProposalFile = {
  path: string;
  content: string;
  action: 'create' | 'update';
};

function suggestionToMarkdown(s: Suggestion, index: number): string {
  return `## ${index + 1}. ${s.title} (${s.priority})

${s.description}

**Action:** ${s.suggestedAction}
${s.example ? `\n**Example:**\n\`\`\`\n${s.example}\n\`\`\`` : ''}
`;
}

export function buildPatchFilesFromReport(
  report: StudioTclReport,
  analysisId: string
): PatchProposalFile[] {
  const files: PatchProposalFile[] = [];
  const base = `.tcl/fixes/${analysisId}`;

  if (report.summary || report.issues.length) {
    const lines = [
      '# TCL analysis summary',
      '',
      report.summary ? report.summary + '\n' : '',
      `TCL score: ${report.scores.overall ?? '—'} | Issues: ${report.issueCount}`,
      '',
      '## Issues',
      ...report.issues.map(
        (i) =>
          `- **${i.severity}** [${i.category}] ${i.title}\n  - ${i.whyItMatters}\n  - Fix: ${i.recommendedAction}`
      ),
    ];
    files.push({
      path: `${base}/summary.md`,
      content: lines.join('\n'),
      action: 'create',
    });
  }

  (report.suggestions ?? []).forEach((s, idx) => {
    files.push({
      path: `${base}/suggestion-${idx + 1}.md`,
      content: suggestionToMarkdown(s, idx),
      action: 'create',
    });
  });

  return files;
}

export function buildUnifiedDiffFromFiles(files: PatchProposalFile[]): string {
  return files
    .map(
      (f) =>
        `--- /dev/null\n+++ ${f.path}\n@@ -0,0 +1,${f.content.split('\n').length} @@\n` +
        f.content
          .split('\n')
          .map((l) => `+${l}`)
          .join('\n')
    )
    .join('\n\n');
}

export async function createPatchProposalsFromTclReport(params: {
  orgId: string;
  teamId: string;
  analysisId: string;
  report: StudioTclReport;
  teamRunId?: string | null;
  agentRunId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
}): Promise<{ patchIds: string[] } | { error: string }> {
  if (!supabaseAdmin) return { error: 'Database not configured' };

  const files = buildPatchFilesFromReport(params.report, params.analysisId);
  if (!files.length) return { patchIds: [] };

  const patchIds: string[] = [];
  const unified = buildUnifiedDiffFromFiles(files);

  const { data, error } = await supabaseAdmin
    .from('agent_studio_patch_proposals')
    .insert({
      org_id: params.orgId,
      team_id: params.teamId,
      team_run_id: params.teamRunId ?? null,
      agent_run_id: params.agentRunId ?? null,
      agent_id: params.agentId ?? null,
      task_id: params.taskId ?? null,
      tcl_analysis_id: params.analysisId,
      title: `TCL fixes (${params.report.issueCount} issues, ${files.length} files)`,
      summary: params.report.summary ?? `TCL score ${params.report.scores.overall ?? '—'}`,
      files,
      unified_diff: unified,
      status: 'PROPOSED',
    })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('does not exist')) {
      return { error: 'Apply migrations 053 and 055 for patch proposals.' };
    }
    return { error: error.message };
  }
  patchIds.push(data.id);
  return { patchIds };
}
