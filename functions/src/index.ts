/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Backend Services Entry Point
 * Authoritative Dodo Payments Integration & Entitlement Engine
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { verifyBearerToken } from './auth/firebaseAuth';
import { handleCreateCheckoutSession } from './billing/checkout';
import { handleGetBillingState } from './billing/billingState';
import {
  handleCancelSubscription,
  handleChangeSubscriptionPlan,
  handlePreviewPlanChange,
  handleReactivateSubscription,
} from './billing/subscriptions';
import { handleCreateCustomerPortalSession } from './billing/portal';
import { processDodoWebhookEvent, verifyAndParseDodoWebhook } from './billing/webhook';
import { EntitlementEngine } from './entitlements/entitlementEngine';
import { getDodoConfig } from './config/dodo';

/**
 * -----------------------------------------------------------------------------
 * 1. AUTHORITATIVE DODO PAYMENTS WEBHOOK HANDLER
 * -----------------------------------------------------------------------------
 * Verifies Standard Webhooks HMAC signature, enforces event idempotency,
 * and updates Firestore state authoritatively.
 */
export const dodoWebhook = async (req: Request, res: Response): Promise<void> => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Retrieve raw body for signature verification
  const rawBody = (req as any).rawBody
    ? (req as any).rawBody.toString('utf8')
    : typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body);

  const eventId =
    (req.headers['webhook-id'] as string) ||
    (req.headers['svix-id'] as string) ||
    `whk_event_${Date.now()}`;

  try {
    // Cryptographically verify webhook signature via DodoPayments SDK unwrap
    const event = verifyAndParseDodoWebhook(rawBody, req.headers as Record<string, string>);

    // Process event idempotently
    const result = await processDodoWebhookEvent(event, eventId);

    res.status(200).json({
      received: true,
      eventId,
      type: event.type,
      orgId: result.orgId,
    });
  } catch (err: any) {
    console.error('[dodoWebhook] Webhook processing failed:', err.message);
    const status = err.statusCode || (err.name === 'WebhookVerificationError' ? 400 : 500);
    res.status(status).json({
      error: err.message || 'Webhook verification failed',
    });
  }
};

/**
 * -----------------------------------------------------------------------------
 * 2. NEXORA BILLING & ENTITLEMENT API (Express Router)
 * -----------------------------------------------------------------------------
 */
const apiApp = express();
apiApp.use(cors({ origin: true }));
apiApp.use(express.json());

// Public Health Check
apiApp.get('/health', (req: Request, res: Response) => {
  const config = getDodoConfig();
  res.json({
    service: 'nexora-dodo-backend',
    version: '2.1.0',
    runtime: 'Netlify Functions / Full-Stack Express',
    dodoConfigured: config.isConfigured,
    environment: config.environment,
    productIds: config.productIds,
  });
});

// Create Checkout Session
apiApp.post('/createCheckoutSession', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleCreateCheckoutSession(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Get Billing State
apiApp.get('/getBillingState', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const orgId = req.query.orgId as string;
    const result = await handleGetBillingState(auth, orgId);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Change Subscription Plan
apiApp.post('/changeSubscriptionPlan', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleChangeSubscriptionPlan(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Preview Plan Change Proration
apiApp.post('/previewPlanChange', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handlePreviewPlanChange(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Cancel Subscription
apiApp.post('/cancelSubscription', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleCancelSubscription(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Reactivate Subscription
apiApp.post('/reactivateSubscription', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleReactivateSubscription(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Create Customer Portal Session
apiApp.post('/createCustomerPortalSession', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleCreateCustomerPortalSession(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Entitlement Verification & Feature Enforcement
apiApp.post('/checkEntitlement', async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await verifyBearerToken(req.headers.authorization);
    const { orgId, feature, limitKey, delta } = req.body;
    if (!orgId) throw new Error('Missing orgId');

    if (feature) {
      const result = await EntitlementEngine.checkFeature(orgId, feature);
      res.json(result);
      return;
    }

    if (limitKey) {
      const result = await EntitlementEngine.checkLimit(orgId, limitKey, delta || 1);
      res.json(result);
      return;
    }

    const entitlements = await EntitlementEngine.getOrgEntitlements(orgId);
    res.json({ allowed: true, ...entitlements });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

export const api = apiApp;

// Export Owner Command Center service
export * from './owner/ownerService';
