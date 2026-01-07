/**
 * Stripe Billing Routes
 * Handles checkout sessions and billing portal access
 */
import Stripe from 'stripe';
import { supabaseAdmin, logAudit } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { planService } from '../plans/plan-service.js';
// Initialize Stripe (will be null if keys not configured)
let stripe = null;
try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey) {
        stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2025-12-15.clover',
        });
    }
}
catch (error) {
    console.warn('Stripe not configured:', error);
}
// Stripe Price IDs from environment
const STRIPE_PRICE_IDS = {
    TEAM_MONTHLY: process.env.STRIPE_PRICE_ID_TEAM_MONTHLY || '',
    TEAM_YEARLY: process.env.STRIPE_PRICE_ID_TEAM_YEARLY || '',
};
// Base URL for redirects
const getBaseUrl = (req) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers.host || 'protectqa.com';
    return `${protocol}://${host}`;
};
export function setupBillingRoutes(app) {
    // ============================================================================
    // POST /api/billing/checkout - Create Stripe Checkout Session
    // ============================================================================
    app.post('/api/billing/checkout', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!stripe) {
                return res.status(503).json({ error: 'Billing not configured' });
            }
            const { priceId, successUrl, cancelUrl } = req.body;
            // Determine price ID (default to monthly if not provided or invalid)
            let finalPriceId = priceId;
            if (!finalPriceId || (finalPriceId !== STRIPE_PRICE_IDS.TEAM_MONTHLY && finalPriceId !== STRIPE_PRICE_IDS.TEAM_YEARLY)) {
                // Default to monthly if not specified or invalid
                finalPriceId = STRIPE_PRICE_IDS.TEAM_MONTHLY || STRIPE_PRICE_IDS.TEAM_YEARLY;
            }
            if (!finalPriceId) {
                return res.status(503).json({ error: 'Stripe price IDs not configured' });
            }
            // Get current plan context
            const planContext = await planService.getOrgPlanContext(context.orgId);
            // Only allow checkout from SANDBOX tier
            if (planContext.tier !== 'SANDBOX') {
                return res.status(400).json({
                    error: 'Checkout only available for Sandbox plans',
                    currentTier: planContext.tier
                });
            }
            // Get organization details
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            const { data: org, error: orgError } = await supabaseAdmin
                .from('organizations')
                .select('id, name, slug')
                .eq('id', context.orgId)
                .single();
            if (orgError || !org) {
                return res.status(404).json({ error: 'Organization not found' });
            }
            // Build URLs
            const baseUrl = getBaseUrl(req);
            const defaultSuccessUrl = `${baseUrl}/account?checkout=success`;
            const defaultCancelUrl = `${baseUrl}/account?checkout=canceled`;
            // Create Stripe Checkout Session
            const session = await stripe.checkout.sessions.create({
                mode: 'subscription',
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: finalPriceId,
                        quantity: 1,
                    },
                ],
                customer_email: context.userId ? undefined : undefined, // Will be collected in checkout
                metadata: {
                    orgId: context.orgId,
                    orgName: org.name,
                    tier: 'TEAM',
                },
                subscription_data: {
                    metadata: {
                        orgId: context.orgId,
                        tier: 'TEAM',
                    },
                },
                success_url: successUrl || defaultSuccessUrl,
                cancel_url: cancelUrl || defaultCancelUrl,
                allow_promotion_codes: true,
            });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'billing.checkout.started',
                targetType: 'subscription',
                targetId: session.id,
                meta: { priceId: finalPriceId, tier: 'TEAM' }
            });
            res.json({
                sessionId: session.id,
                url: session.url,
            });
        }
        catch (e) {
            console.error('Create checkout session error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/billing/portal - Get Stripe Billing Portal link
    // ============================================================================
    app.post('/api/billing/portal', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!stripe) {
                return res.status(503).json({ error: 'Billing not configured' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            // Get organization with Stripe customer ID
            const { data: org, error: orgError } = await supabaseAdmin
                .from('organizations')
                .select('id, name, stripe_customer_id')
                .eq('id', context.orgId)
                .single();
            if (orgError || !org) {
                return res.status(404).json({ error: 'Organization not found' });
            }
            // Get plan context
            const planContext = await planService.getOrgPlanContext(context.orgId);
            // Only allow portal access for TEAM tier
            if (planContext.tier !== 'TEAM') {
                return res.status(400).json({
                    error: 'Billing portal only available for Team plans',
                    currentTier: planContext.tier
                });
            }
            // Get or create Stripe customer
            let customerId = org.stripe_customer_id;
            if (!customerId) {
                // Create Stripe customer
                const customer = await stripe.customers.create({
                    metadata: {
                        orgId: context.orgId,
                    },
                });
                customerId = customer.id;
                // Update organization with customer ID
                await supabaseAdmin
                    .from('organizations')
                    .update({ stripe_customer_id: customerId })
                    .eq('id', context.orgId);
            }
            // Build return URL
            const baseUrl = getBaseUrl(req);
            const returnUrl = `${baseUrl}/account`;
            // Create billing portal session
            const session = await stripe.billingPortal.sessions.create({
                customer: customerId,
                return_url: returnUrl,
            });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'billing.portal.accessed',
                targetType: 'subscription',
                targetId: customerId,
                meta: { tier: 'TEAM' }
            });
            res.json({
                url: session.url,
            });
        }
        catch (e) {
            console.error('Create billing portal session error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
