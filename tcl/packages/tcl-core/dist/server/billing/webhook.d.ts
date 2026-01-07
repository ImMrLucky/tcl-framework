/**
 * Stripe Webhook Handler
 * Processes subscription events and updates organization plans
 */
import express from 'express';
/**
 * Handle Stripe webhook events
 */
export declare function handleStripeWebhook(req: express.Request, res: express.Response): Promise<void>;
