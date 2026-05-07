import type { Claim, IssueV2 } from "../types.js";
import type { DomainPack } from "./types.js";
/** ProtectQA-first default — no configuration required */
export declare const DEFAULT_DOMAIN_PACK_IDS: readonly ["protectqa_final_expense"];
export declare function registerDomainPack(pack: DomainPack): void;
export declare function getDomainPack(id: string): DomainPack | undefined;
export declare function getAllDomainPacks(): DomainPack[];
export declare function selectDomainPacks(options: {
    templateId?: string;
    packIds?: string[];
}): DomainPack[];
interface RunContext {
    runId: string;
    conversationId: string;
    evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL";
}
export interface DomainPackRunResult {
    packId: string;
    issues: IssueV2[];
}
export declare function runDomainPack(pack: DomainPack, claims: Claim[], context: RunContext): DomainPackRunResult;
export declare function runDomainPacks(packs: DomainPack[], claims: Claim[], context: RunContext): IssueV2[];
export {};
