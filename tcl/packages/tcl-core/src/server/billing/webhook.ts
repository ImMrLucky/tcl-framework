/**
 * Stripe Webhook Handler
 * Processes subscription events and updates organization plans
 */

import express from 'express';
import Stripe from 'stripe';
import { supabaseAdmin, logAudit } from '../supabase.js';

let stripe: Stripe | null = null;
try {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-12-15.clover',
    });
  }
} catch (error) {
  console.warn('Stripe not configured:', error);
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(
  req: express.Request,
  res: express.Response
): Promise<void> {
  if (!stripe) {
    res.status(503).json({ error: 'Stripe not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
    return;
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.paid':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Handle checkout.session.completed
 * Upgrade organization to TEAM tier
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (!supabaseAdmin) return;

  const orgId = session.metadata?.orgId;
  if (!orgId) {
    console.error('Missing orgId in checkout session metadata');
    return;
  }

  const subscriptionId = session.subscription as string;
  if (!subscriptionId) {
    console.error('Missing subscription ID in checkout session');
    return;
  }

  // Update organization to TEAM tier
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      plan_tier: 'TEAM',
      plan_status: 'ACTIVE',
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: subscriptionId,
      plan_changed_at: new Date().toISOString(),
    })
    .eq('id', orgId);

  if (error) {
    console.error('Failed to update organization plan:', error);
    throw error;
  }

  // Log audit
  await logAudit({
    orgId,
    action: 'billing.subscription.activated',
    targetType: 'subscription',
    targetId: subscriptionId,
    meta: { tier: 'TEAM', sessionId: session.id }
  });

  console.log(`Organization ${orgId} upgraded to TEAM tier`);
}

/**
 * Handle subscription.created and subscription.updated
 * Update organization plan status
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  if (!supabaseAdmin) return;

  const orgId = subscription.metadata?.orgId;
  if (!orgId) {
    console.error('Missing orgId in subscription metadata');
    return;
  }

  // Determine plan status from subscription status
  let planStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' = 'ACTIVE';
  
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    planStatus = 'ACTIVE';
  } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    planStatus = 'PAST_DUE';
  } else if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    planStatus = 'CANCELED';
  }

  // Update organization
  const updateData: any = {
    plan_status: planStatus,
    stripe_subscription_id: subscription.id,
    plan_changed_at: new Date().toISOString(),
  };

  // If subscription is canceled but not yet ended, schedule downgrade
  if (subscription.status === 'canceled' && subscription.cancel_at_period_end) {
    // Store the period end timestamp for the downgrade job
    const periodEnd = (subscription as any).current_period_end;
    if (periodEnd) {
      updateData.plan_downgrade_at = new Date(periodEnd * 1000).toISOString();
    }
  } else {
    // Clear downgrade date if subscription is reactivated
    updateData.plan_downgrade_at = null;
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update(updateData)
    .eq('id', orgId);

  if (error) {
    console.error('Failed to update subscription status:', error);
    throw error;
  }

  // Log audit
  await logAudit({
    orgId,
    action: 'billing.subscription.updated',
    targetType: 'subscription',
    targetId: subscription.id,
    meta: { status: subscription.status, planStatus }
  });

  console.log(`Subscription ${subscription.id} updated for org ${orgId}: ${planStatus}`);
}

/**
 * Handle subscription.deleted
 * Schedule downgrade to SANDBOX
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  if (!supabaseAdmin) return;

  const orgId = subscription.metadata?.orgId;
  if (!orgId) {
    console.error('Missing orgId in subscription metadata');
    return;
  }

  // Mark for downgrade (will be applied by daily job)
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      plan_status: 'CANCELED',
      plan_downgrade_at: new Date().toISOString(), // Downgrade immediately
    })
    .eq('id', orgId);

  if (error) {
    console.error('Failed to mark organization for downgrade:', error);
    throw error;
  }

  // Log audit
  await logAudit({
    orgId,
    action: 'billing.subscription.deleted',
    targetType: 'subscription',
    targetId: subscription.id,
    meta: { tier: 'TEAM', downgradeScheduled: true }
  });

  console.log(`Subscription ${subscription.id} deleted for org ${orgId}, downgrade scheduled`);
}

/**
 * Handle invoice.payment_failed
 * Update organization to PAST_DUE status
 */
async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!supabaseAdmin) return;

  // Invoice.subscription can be a string ID or a Subscription object
  const invoiceAny = invoice as any;
  const subscriptionRef = invoiceAny.subscription as string | Stripe.Subscription | null;
  const subscriptionId = typeof subscriptionRef === 'string' 
    ? subscriptionRef 
    : subscriptionRef?.id;
  if (!subscriptionId || typeof subscriptionId !== 'string') return;

  // Get subscription to find orgId
  if (!stripe) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const orgId = subscription.metadata?.orgId;
  if (!orgId) return;

  // Update organization to PAST_DUE
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      plan_status: 'PAST_DUE',
      plan_changed_at: new Date().toISOString(),
    })
    .eq('id', orgId);

  if (error) {
    console.error('Failed to update organization to PAST_DUE:', error);
    throw error;
  }

  // Log audit
  await logAudit({
    orgId,
    action: 'billing.payment.failed',
    targetType: 'invoice',
    targetId: invoice.id,
    meta: { subscriptionId, amount: invoice.amount_due }
  });

  console.log(`Payment failed for org ${orgId}, subscription ${subscriptionId}`);
}

/**
 * Handle invoice.paid
 * Reactivate organization if it was PAST_DUE
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  if (!supabaseAdmin) return;

  // Invoice.subscription can be a string ID or a Subscription object
  const invoiceAny = invoice as any;
  const subscriptionRef = invoiceAny.subscription as string | Stripe.Subscription | null;
  const subscriptionId = typeof subscriptionRef === 'string' 
    ? subscriptionRef 
    : subscriptionRef?.id;
  if (!subscriptionId || typeof subscriptionId !== 'string') return;

  // Get subscription to find orgId
  if (!stripe) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const orgId = subscription.metadata?.orgId;
  if (!orgId) return;

  // Update organization to ACTIVE if it was PAST_DUE
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan_status')
    .eq('id', orgId)
    .single();

  if (org && org.plan_status === 'PAST_DUE') {
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({
        plan_status: 'ACTIVE',
        plan_changed_at: new Date().toISOString(),
      })
      .eq('id', orgId);

    if (error) {
      console.error('Failed to reactivate organization:', error);
      throw error;
    }

    // Log audit
    await logAudit({
      orgId,
      action: 'billing.payment.succeeded',
      targetType: 'invoice',
      targetId: invoice.id,
      meta: { subscriptionId, reactivated: true }
    });

    console.log(`Payment succeeded for org ${orgId}, reactivated from PAST_DUE`);
  }
}

