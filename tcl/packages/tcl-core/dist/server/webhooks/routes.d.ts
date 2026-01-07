/**
 * Webhook Management Routes
 * Handles creation, listing, testing, and deletion of webhook endpoints
 */
import express from 'express';
export interface WebhookEndpoint {
    id: string;
    orgId: string;
    url: string;
    enabled: boolean;
    mode: 'SANDBOX' | 'PROD';
    events: string[];
    createdAt: string;
    updatedAt: string;
    lastDeliveredAt?: string;
    lastErrorAt?: string;
    lastErrorMessage?: string;
    deliveryCount: number;
    failureCount: number;
    secret?: string;
}
export interface WebhookTestPayload {
    event: 'webhook.test';
    mode: 'SANDBOX' | 'PROD';
    orgId: string;
    timestamp: string;
    test: {
        message: string;
        endpointId: string;
    };
}
export declare function hashWebhookSecret(secret: string): string;
export declare function generateWebhookSecret(): {
    secret: string;
    hash: string;
};
export declare function setupWebhookRoutes(app: express.Application): void;
