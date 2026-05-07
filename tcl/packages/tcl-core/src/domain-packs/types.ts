/**
 * Domain Pack
 *
 * A domain pack is a self-contained ruleset for a particular business domain
 * (final-expense insurance, AI chat bots, telco, lending, healthcare ...).
 *
 * The orchestrator loads one or more packs per run. A pack contributes:
 *  - High-stakes vocabulary (used by claim classification)
 *  - Compliance rules (regex + severity + saferVersion + tags)
 *  - Required disclosures (a topic that demands a follow-up qualifier)
 *  - Forbidden phrases (auto-critical regardless of context)
 *
 * Adding a new vertical = one new TypeScript file. No engine changes required.
 */

import type { IssueTypeV2, SeverityV2 } from "../types.js";

export interface DomainRule {
  type: IssueTypeV2;
  severity: SeverityV2;
  patterns: RegExp[];
  summary: string;
  detail: string;
  saferVersion: string;
  tags: string[];
  /** If set, rule only runs when claim speaker role matches (e.g. bot-only AI rules) */
  appliesToSpeakerTypes?: Array<"agent" | "customer" | "supervisor" | "bot" | "system">;
  /** Optional contradiction / evidence hooks for future rule engine */
  contradictionLogic?: string;
  requiredEvidence?: string[];
  requiredDisclosureHint?: string;
  id?: string;
  description?: string;
}

export interface RequiredDisclosure {
  /** Trigger pattern - if any agent claim matches this, the disclosure must be present somewhere in the agent transcript */
  trigger: RegExp;
  /** Disclosure pattern - any agent claim matching this satisfies the requirement */
  disclosure: RegExp;
  type: IssueTypeV2;
  severity: SeverityV2;
  summary: string;
  detail: string;
  saferVersion: string;
  tags: string[];
}

export interface ForbiddenPhrase {
  pattern: RegExp;
  type: IssueTypeV2;
  severity: SeverityV2;
  summary: string;
  detail: string;
  saferVersion: string;
  tags: string[];
}

export interface DomainPack {
  id: string;
  /** Human-readable pack name for dashboards */
  name?: string;
  /** Domain slug: protectqa_final_expense, ai_agent, healthcare, etc. */
  domain?: string;
  version: string;
  description: string;
  rules: DomainRule[];
  requiredDisclosures: RequiredDisclosure[];
  forbiddenPhrases: ForbiddenPhrase[];
  /** Optional evidence requirements surfaced in evidence-dependency graph */
  evidenceRequirements?: string[];
  riskyPhrases?: RegExp[];
  saferLanguage?: Record<string, string>;
  severityWeights?: Partial<Record<SeverityV2, number>>;
  /** Speaker role this pack should be evaluated against (default: agent + supervisor) */
  appliesToRoles?: Array<"agent" | "customer" | "supervisor" | "bot" | "system">;
  /** Optional template ids this pack should auto-attach to */
  templates?: string[];
  /** Domain-specific high-stakes vocabulary - merged into claim extractor */
  highStakesVocabulary?: RegExp[];
  /** Topic keywords for cross-turn topic mapping */
  topicVocabulary?: Record<string, RegExp>;
}
