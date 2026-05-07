/**
 * Background Job Worker
 * Processes ingestion jobs asynchronously
 */
/**
 * Enqueue a job for processing
 */
export declare function enqueueJob(jobId: string): Promise<void>;
/**
 * Helper: Run analysis from transcript
 * Extracts claims and runs the full analysis pipeline
 */
export declare function runAnalysis(input: {
    orgId: string;
    projectId: string;
    env: string;
    conversationId: string;
    transcript: string;
    normalizedConversation?: any;
    userId: string;
    verificationLevel: string;
    transcriptAssetId: string;
    jobId: string | null;
    ingestionMode?: string;
    provenance?: any;
    conversationEvidenceIds?: string[];
    includeOrgEvidence?: boolean;
    includeProjectEvidence?: boolean;
    includeTemplateEvidence?: boolean;
    templateId?: string;
    simulationMode?: boolean;
}): Promise<string>;
