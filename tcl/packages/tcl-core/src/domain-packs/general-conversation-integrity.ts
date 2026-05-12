/**
 * Default TCL domain pack — cross-industry conversation integrity.
 * Insurance / final-expense rules live in `protectqa-final-expense` and attach only when that template or pack is selected (or explicitly inferred via template id).
 */
import type { DomainPack } from "./types.js";

export const generalConversationIntegrityPack: DomainPack = {
  id: "general_conversation_integrity",
  name: "General Conversation Integrity",
  domain: "general_conversation_integrity",
  version: "1.0.0",
  description:
    "Baseline truth & consistency: strong factual language, commitments, and completion claims without industry-specific compliance rules.",
  appliesToRoles: ["agent", "supervisor", "bot"],
  templates: ["generic", "general", "default", "conversation_integrity", "general_conversation_integrity"],
  rules: [
    {
      type: "UNVERIFIED_CLAIM",
      severity: "medium",
      patterns: [
        /\b(definitely|certainly|always|never|guaranteed|100%)\b/i,
        /\bI know for a fact\b/i,
        /\babsolutely (?:true|correct|right)\b/i,
      ],
      summary: "Strong factual certainty without cited support",
      detail:
        "High-certainty factual language increases dispute risk if the statement cannot be verified from transcript or attached evidence.",
      saferVersion: "Use qualified language and cite the policy, system record, or transcript basis for the statement.",
      tags: ["general_integrity", "factual_certainty"],
    },
    {
      type: "COMMITMENT_INCONSISTENCY",
      severity: "low",
      patterns: [
        /\b(I promise|we guarantee|I guarantee|will definitely|no matter what)\b/i,
        /\bI assure you (?:that )?everything\b/i,
      ],
      summary: "Unconditional commitment language",
      detail:
        "Absolute commitments are hard to defend if circumstances change. Prefer documented, conditional commitments.",
      saferVersion: "Describe what you can commit to under which conditions, and document next steps in writing.",
      tags: ["general_integrity", "commitment"],
    },
    {
      type: "RISK_SIGNAL",
      severity: "medium",
      patterns: [
        /\b(?:task |case |ticket |request )?(?:is |was )?(?:done|completed|finished|resolved|submitted|filed)\b/i,
        /\bI(?:'ve| have) (?:already )?(?:completed|finished|submitted)\b/i,
      ],
      summary: "Task or completion claim",
      detail:
        "Completion statements should match system state and follow-up turns; false completion is a common integrity failure mode.",
      saferVersion: "Confirm completion against system records before stating the task is done.",
      tags: ["general_integrity", "task_completion"],
    },
  ],
  forbiddenPhrases: [],
  requiredDisclosures: [],
};
