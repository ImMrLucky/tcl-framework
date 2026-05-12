/**
 * Structured logs without transcript text, PII, PHI, policy bodies, or secrets.
 */

export type ValidateRequestShape = {
  questionLen: number;
  answerLen: number;
  sourcesCount: number;
  hasOptions: boolean;
};

export function summarizeValidateBody(body: unknown): ValidateRequestShape {
  if (!body || typeof body !== "object") {
    return { questionLen: 0, answerLen: 0, sourcesCount: 0, hasOptions: false };
  }
  const b = body as Record<string, unknown>;
  const q = b["question"];
  const a = b["answer"];
  const src = b["sources"];
  const opt = b["options"];
  return {
    questionLen: typeof q === "string" ? q.length : 0,
    answerLen: typeof a === "string" ? a.length : 0,
    sourcesCount: Array.isArray(src) ? src.length : 0,
    hasOptions: opt !== undefined && opt !== null,
  };
}

export function logJson(event: string, fields: Record<string, string | number | boolean | null | undefined>): void {
  console.log(JSON.stringify({ event, ...fields, ts: new Date().toISOString() }));
}
