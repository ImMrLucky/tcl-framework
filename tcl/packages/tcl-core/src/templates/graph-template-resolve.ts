import { getAvailableTemplates } from "../graph/template-config.js";
import type { IndustryTemplateDefinition } from "./template-types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isKnownGraphTemplate(id: string): boolean {
  return getAvailableTemplates().includes(id);
}

/**
 * Resolve graph `templateId` for `setTemplateConfig`.
 * - Honors explicit graph template when it is a registered id.
 * - Ignores UUID-looking DB template ids (those are org templates, not graph configs).
 * - Falls back to industry.graphTemplateId, then content `detectTemplate`.
 */
export function resolveGraphTemplateId(args: {
  industry: IndustryTemplateDefinition;
  rawTemplateOption?: string;
  detectFromTranscript: () => string;
}): string {
  const raw = args.rawTemplateOption?.trim();
  if (raw && !UUID_RE.test(raw) && isKnownGraphTemplate(raw)) {
    return raw;
  }
  const g = args.industry.graphTemplateId;
  if (g && isKnownGraphTemplate(g)) return g;
  return args.detectFromTranscript();
}
