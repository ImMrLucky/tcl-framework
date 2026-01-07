/**
 * Webhook Delivery Service
 * Handles async delivery of webhooks with HMAC signing
 */
export interface AnalysisCompletedPayload {
    event: 'analysis.completed';
    mode: 'SANDBOX' | 'PROD';
    orgId: string;
    analysisId: string;
    createdAt: string;
    summary: {
        totalIssues: number;
        bySeverity: {
            low: number;
            medium: number;
            high: number;
            critical: number;
        };
        byType: Record<string, number>;
        byCategory: Record<string, number>;
    };
    spectral?: {
        energy?: number;
        gap?: number;
        cycleMass?: number;
    };
}
/**
 * Deliver webhook for analysis.completed event
 * Only delivers to PROD endpoints if org has WEBHOOKS_PROD capability
 * Sandbox endpoints are test-only (no auto-delivery)
 */
export declare function deliverAnalysisCompletedWebhook(orgId: string, analysisId: string, summary: AnalysisCompletedPayload['summary'], spectral?: AnalysisCompletedPayload['spectral']): Promise<void>;
