/**
 * Verification Diff
 * Compares uploaded transcript vs ASR transcript for mismatches
 */
export interface VerificationReport {
    id: string;
    summary_json: {
        mismatchScore: number;
        entityMismatches: Array<{
            type: 'money' | 'date' | 'percentage' | 'other';
            uploaded: string;
            asr: string;
            context: string;
        }>;
        highRiskDifferences: Array<{
            uploaded: string;
            asr: string;
            context: string;
            risk: 'high' | 'medium' | 'low';
        }>;
        notes: string[];
    };
}
/**
 * Compute verification diff between uploaded and ASR transcripts
 */
export declare function computeVerificationDiff(orgId: string, jobId: string, uploadedTranscriptAssetId: string, asrTranscriptAssetId: string, uploadedText: string, asrText: string): Promise<VerificationReport>;
