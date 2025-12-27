import { LLMAdapter, ExtractArtifactsInput, ExtractArtifactsOutput, RepairInput, RepairOutput } from "./llm_adapter.js";
import { Claim, Source } from "../types.js";

type OpenAIAdapterConfig = { apiKey: string; model: string; baseUrl?: string };

function sourcesToPack(sources?: Source[]) {
  if (!sources?.length) return "";
  return sources.map((s) => `SOURCE ${s.id}:\n${s.text}\n`).join("\n---\n");
}

async function postJson(url: string, apiKey: string, body: any) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

function safeJsonParse<T>(text: string): T {
  try { return JSON.parse(text) as T; } catch {
    const s = text.indexOf("{"); const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1)) as T;
    throw new Error("Model did not return valid JSON.");
  }
}

type ClaimsJson = { answer: string; claims: Array<{ id: string; text: string; confidence: number; evidence: Array<{ source_id: string; quote: string }> }> };
type RepairJson = { repairedAnswer: string; notes: string[] };

export class OpenAIAdapter implements LLMAdapter {
  name = "openai";
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  constructor(cfg: OpenAIAdapterConfig) { this.apiKey = cfg.apiKey; this.model = cfg.model; this.baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1"; }

  async extractArtifacts(input: ExtractArtifactsInput): Promise<ExtractArtifactsOutput> {
    const prompt = `
Return JSON only:
{ "answer": string, "claims":[{"id":"c1","text":"...","confidence":0.0,"evidence":[{"source_id":"s1","quote":"..."}]}] }
Rules: atomic claims; if sources exist, quotes must come from sources; no invented quotes.
QUESTION: ${input.question}
ANSWER: ${input.answer}
SOURCES:
${input.sources?.length ? sourcesToPack(input.sources) : "NONE"}
`.trim();

    const data = await postJson(`${this.baseUrl}/responses`, this.apiKey, { model: this.model, input: prompt, temperature: 0.2, max_output_tokens: 1200 });
    const text = data?.output_text ?? "";
    const parsed = safeJsonParse<ClaimsJson>(text);
    const claims: Claim[] = (parsed.claims ?? []).map((c) => ({ id: c.id, text: c.text, confidence: Math.max(0, Math.min(1, c.confidence)), evidence: (c.evidence ?? []).map((e) => ({ source_id: e.source_id, quote: e.quote })) }));
    return { answer: parsed.answer || input.answer, claims };
  }

  async repairOnePass(input: RepairInput): Promise<RepairOutput> {
    const prompt = `
Return JSON only: { "repairedAnswer": string, "notes": string[] }
Rules: remove/correct failing claims, cite sources with [s1], no new unsupported facts.
QUESTION: ${input.question}
ORIGINAL: ${input.originalAnswer}
FAILING: ${input.failingClaimIds.join(", ")}
CLAIMS:
${input.claims.map(c => `- ${c.id}: ${c.text}`).join("\n")}
SOURCES:
${input.sources?.length ? sourcesToPack(input.sources) : "NONE"}
`.trim();

    const data = await postJson(`${this.baseUrl}/responses`, this.apiKey, { model: this.model, input: prompt, temperature: 0.2, max_output_tokens: 1200 });
    const text = data?.output_text ?? "";
    const parsed = safeJsonParse<RepairJson>(text);
    return { repairedAnswer: (parsed.repairedAnswer ?? "").slice(0, input.policy?.maxAnswerChars ?? 2000), notes: parsed.notes ?? [] };
  }
}
