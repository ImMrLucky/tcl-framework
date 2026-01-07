/**
 * API Key Management Routes
 * Handles creation, listing, and revocation of API keys
 */
import express from 'express';
export interface ApiKeyResponse {
    id: string;
    name: string;
    prefix: string;
    mode: 'SANDBOX' | 'PROD';
    createdAt: string;
    lastUsedAt?: string;
    key?: string;
}
export declare function setupApiKeyRoutes(app: express.Application): void;
