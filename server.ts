/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Full-Stack Express Server with Dodo Payments & Vite
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Enable CORS
app.use(cors({ origin: true }));

/**
 * Capture raw body specifically for webhook verification (preserves exact signature bytes)
 */
app.use('/dodoWebhook', express.raw({ type: '*/*' }));

// Parse standard JSON for /api/* routes
app.use('/api', express.json());

// Dynamic import of Dodo functions from /functions/src
let dodoHandlers: any = null;
async function loadDodoHandlers() {
  if (!dodoHandlers) {
    try {
      dodoHandlers = await import('./functions/src/index.js');
    } catch (e) {
      // Fallback for tsx runtime loading TypeScript directly
      dodoHandlers = await import('./functions/src/index.ts');
    }
  }
  return dodoHandlers;
}

/**
 * -----------------------------------------------------------------------------
 * 1. DODO PAYMENTS WEBHOOK ENDPOINT
 * -----------------------------------------------------------------------------
 */
app.post('/dodoWebhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const { verifyAndParseDodoWebhook, processDodoWebhookEvent } = await import('./functions/src/billing/webhook.ts');
    
    // Convert Buffer to utf8 string for HMAC SHA256 verification
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body || '');
    const eventId =
      (req.headers['webhook-id'] as string) ||
      (req.headers['svix-id'] as string) ||
      `whk_${Date.now()}`;

    const event = verifyAndParseDodoWebhook(rawBody, req.headers as Record<string, string>);
    const result = await processDodoWebhookEvent(event, eventId);

    res.status(200).json({
      received: true,
      eventId,
      type: event.type,
      orgId: result.orgId,
    });
  } catch (err: any) {
    console.error('[server.ts] Webhook error:', err.message);
    const status = err.statusCode || (err.name === 'WebhookVerificationError' ? 400 : 500);
    res.status(status).json({ error: err.message || 'Webhook processing failed' });
  }
});

/**
 * -----------------------------------------------------------------------------
 * 2. NEXORA DODO BILLING API ROUTES
 * -----------------------------------------------------------------------------
 */
app.get('/api/health', async (req: Request, res: Response) => {
  const { getDodoConfig } = await import('./functions/src/config/dodo.ts');
  const { getFirebaseAdminDiagnostics } = await import('./functions/src/auth/firebaseAuth.ts');
  const config = getDodoConfig();
  res.json({
    service: 'nexora-dodo-backend',
    version: '2.1.0',
    runtime: 'Full-Stack Express & Netlify Functions Compatible',
    dodoConfigured: config.isConfigured,
    environment: config.environment,
    productIds: config.productIds,
    firebaseAdmin: getFirebaseAdminDiagnostics(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/diagnostics', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken, verifyOrgBillingAccess, getFirebaseAdminDiagnostics } = await import(
      './functions/src/auth/firebaseAuth.ts'
    );
    const { getDodoConfig } = await import('./functions/src/config/dodo.ts');
    const auth = await verifyBearerToken(req.headers.authorization);

    const orgId = req.query.orgId as string;
    let orgStatus = 'not_provided';

    if (orgId) {
      try {
        await verifyOrgBillingAccess(auth, orgId);
        orgStatus = 'authorized';
      } catch (orgErr: any) {
        orgStatus = `denied: ${orgErr.message}`;
      }
    }

    res.json({
      authenticated: true,
      userUid: auth.uid,
      userEmail: auth.email || null,
      orgStatus,
      firebaseAdmin: getFirebaseAdminDiagnostics(),
      dodo: {
        configured: getDodoConfig().isConfigured,
        environment: getDodoConfig().environment,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    const status = err.statusCode || 401;
    res.status(status).json({
      error: err.message,
      code: err.code || 'AUTH_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/createCheckoutSession', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { handleCreateCheckoutSession } = await import('./functions/src/billing/checkout.ts');
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleCreateCheckoutSession(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get('/api/getBillingState', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { handleGetBillingState } = await import('./functions/src/billing/billingState.ts');
    const auth = await verifyBearerToken(req.headers.authorization);
    const orgId = req.query.orgId as string;
    const result = await handleGetBillingState(auth, orgId);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/changeSubscriptionPlan', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { handleChangeSubscriptionPlan } = await import('./functions/src/billing/subscriptions.ts');
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleChangeSubscriptionPlan(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/previewPlanChange', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { handlePreviewPlanChange } = await import('./functions/src/billing/subscriptions.ts');
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handlePreviewPlanChange(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/cancelSubscription', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { handleCancelSubscription } = await import('./functions/src/billing/subscriptions.ts');
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleCancelSubscription(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/reactivateSubscription', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { handleReactivateSubscription } = await import('./functions/src/billing/subscriptions.ts');
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleReactivateSubscription(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/createCustomerPortalSession', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { handleCreateCustomerPortalSession } = await import('./functions/src/billing/portal.ts');
    const auth = await verifyBearerToken(req.headers.authorization);
    const result = await handleCreateCustomerPortalSession(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/checkEntitlement', async (req: Request, res: Response) => {
  try {
    const { verifyBearerToken } = await import('./functions/src/auth/firebaseAuth.ts');
    const { EntitlementEngine } = await import('./functions/src/entitlements/entitlementEngine.ts');
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

/**
 * -----------------------------------------------------------------------------
 * 2B. NEXORA OWNER COMMAND CENTER API ROUTES
 * Authoritative Server-Side Master Authorization Boundary.
 * Restricted strictly to platform owner: abhi30382.AK@gmail.com
 * -----------------------------------------------------------------------------
 */

// Verify platform owner authorization status
app.get('/api/owner/verify', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    res.json({
      authorized: true,
      role: 'platform_owner',
      email: auth.email,
      uid: auth.uid,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(err.statusCode || 403).json({
      authorized: false,
      error: err.message || 'Platform Owner access required',
      code: err.code || 'OWNER_ACCESS_REQUIRED',
    });
  }
});

// Executive Overview
app.get('/api/owner/overview', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerOverview } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const timeRange = (req.query.timeRange as string) || '30d';
    const overview = await getOwnerOverview(timeRange, req.headers.authorization);
    res.json(overview);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Users Directory & Management
app.get('/api/owner/users', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerUsers } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const search = req.query.search as string;
    const status = req.query.status as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const users = await getOwnerUsers({ search, status, limit }, req.headers.authorization);
    res.json(users);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

app.post('/api/owner/users/action', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, executeOwnerUserAction } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { targetUid, action, payload } = req.body;
    const result = await executeOwnerUserAction(auth, targetUid, action, payload);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Organizations Directory & Management
app.get('/api/owner/organizations', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerOrganizations } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const search = req.query.search as string;
    const plan = req.query.plan as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const orgs = await getOwnerOrganizations({ search, plan, limit }, req.headers.authorization);
    res.json(orgs);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

app.post('/api/owner/organizations/action', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, executeOwnerOrgAction } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { orgId, action, payload } = req.body;
    const result = await executeOwnerOrgAction(auth, orgId, action, payload);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Billing Control Plane
app.get('/api/owner/billing', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerBilling } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const billing = await getOwnerBilling(req.headers.authorization);
    res.json(billing);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Payments & Invoices Intelligence
app.get('/api/owner/payments', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerPayments } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const status = req.query.status as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const payments = await getOwnerPayments({ status, limit }, req.headers.authorization);
    res.json(payments);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Webhook Control Center
app.get('/api/owner/webhooks', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerWebhooks } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
    const webhooks = await getOwnerWebhooks(limit, req.headers.authorization);
    res.json(webhooks);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Audit Center
app.get('/api/owner/audit', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerAuditLogs } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const action = req.query.action as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const logs = await getOwnerAuditLogs({ action, limit }, req.headers.authorization);
    res.json(logs);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Security Center
app.get('/api/owner/security', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerSecurityCenter } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const security = await getOwnerSecurityCenter(req.headers.authorization);
    res.json(security);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Feature Flag Engine
app.get('/api/owner/features', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerFeatureFlags } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const flags = await getOwnerFeatureFlags();
    res.json(flags);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

app.post('/api/owner/features/toggle', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, updateOwnerFeatureFlag } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { featureKey, enabled, rolloutPercentage } = req.body;
    const result = await updateOwnerFeatureFlag(auth, featureKey, enabled, rolloutPercentage);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// System Health & Diagnostics
app.get('/api/owner/health', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerSystemHealth } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const health = await getOwnerSystemHealth();
    res.json(health);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Universal Search
app.get('/api/owner/search', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, searchOwnerEntities } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const q = (req.query.q as string) || '';
    const results = await searchOwnerEntities(q);
    res.json(results);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Data Export Center
app.post('/api/owner/export', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, generateOwnerExport } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { dataset, format } = req.body;
    const exportResult = await generateOwnerExport(auth, dataset, format || 'json');
    res.json(exportResult);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Platform Incidents Center
app.get('/api/owner/incidents', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerIncidents } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const status = req.query.status as string;
    const incidents = await getOwnerIncidents({ status });
    res.json(incidents);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

app.post('/api/owner/incidents', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, createOwnerIncident } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const result = await createOwnerIncident(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

app.post('/api/owner/incidents/status', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, updateOwnerIncidentStatus } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { incidentId, status, note } = req.body;
    const result = await updateOwnerIncidentStatus(auth, incidentId, status, note);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Revenue & Product Analytics
app.get('/api/owner/analytics', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerAnalytics } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const timeRange = (req.query.timeRange as string) || '30d';
    const analytics = await getOwnerAnalytics(timeRange);
    res.json(analytics);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

// Platform Configuration Center
app.get('/api/owner/config', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerPlatformConfig } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const config = await getOwnerPlatformConfig();
    res.json(config);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

app.post('/api/owner/config', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, updateOwnerPlatformConfig } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const result = await updateOwnerPlatformConfig(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Downloadable Firestore Security Rules Text File
app.get('/api/download/firestore-rules', (_req: Request, res: Response) => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  if (fs.existsSync(rulesPath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="firestore.rules.txt"');
    res.sendFile(rulesPath);
  } else {
    res.status(404).send('firestore.rules file not found');
  }
});

app.get('/firestore.rules.txt', (_req: Request, res: Response) => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  if (fs.existsSync(rulesPath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="firestore.rules.txt"');
    res.sendFile(rulesPath);
  } else {
    res.status(404).send('firestore.rules file not found');
  }
});

// Webhook Idempotent Retry
app.post('/api/owner/webhooks/retry', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, retryOwnerWebhookEvent } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { eventId } = req.body;
    const result = await retryOwnerWebhookEvent(auth, eventId);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Private Owner Notes & Tags
app.get('/api/owner/notes', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerNotes } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const entityType = req.query.entityType as string;
    const entityId = req.query.entityId as string;
    const notes = await getOwnerNotes(entityType, entityId);
    res.json(notes);
  } catch (err: any) {
    res.status(err.statusCode || 403).json({ error: err.message, code: err.code || 'OWNER_ACCESS_REQUIRED' });
  }
});

app.post('/api/owner/notes', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, saveOwnerNote } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const result = await saveOwnerNote(auth, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Bulk User and Org Actions
app.post('/api/owner/bulk/users', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, executeOwnerBulkUserAction } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { uids, action } = req.body;
    const result = await executeOwnerBulkUserAction(auth, uids, action);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

app.post('/api/owner/bulk/orgs', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, executeOwnerBulkOrgAction } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { orgIds, action } = req.body;
    const result = await executeOwnerBulkOrgAction(auth, orgIds, action);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'ACTION_FAILED' });
  }
});

// Billing Reconciliation
app.get('/api/owner/reconciliation', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerReconciliation } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const data = await getOwnerReconciliation();
    res.json(data);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
  }
});

// Data Quality & Integrity
app.get('/api/owner/data-quality', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerDataQuality } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const data = await getOwnerDataQuality();
    res.json(data);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
  }
});

// Daily Brief & Attention Digest
app.get('/api/owner/daily-brief', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerDailyBrief } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const data = await getOwnerDailyBrief();
    res.json(data);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
  }
});

// Owner Tasks Center
app.get('/api/owner/tasks', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerTasks } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const data = await getOwnerTasks();
    res.json(data);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
  }
});

app.post('/api/owner/tasks', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, createOwnerTask } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { title, priority, entityType, entityId, notes } = req.body;
    const task = await createOwnerTask(auth, title, priority, entityType, entityId, notes);
    res.json(task);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'TASK_CREATE_FAILED' });
  }
});

app.post('/api/owner/tasks/status', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, updateOwnerTaskStatus } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { taskId, status } = req.body;
    const result = await updateOwnerTaskStatus(auth, taskId, status);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'TASK_UPDATE_FAILED' });
  }
});

// Platform Automations
app.get('/api/owner/automations', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerAutomations } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const data = await getOwnerAutomations();
    res.json(data);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
  }
});

app.post('/api/owner/automations/toggle', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, toggleOwnerAutomation } = await import('./functions/src/owner/ownerService.ts');
    const auth = await verifyPlatformOwner(req.headers.authorization);
    const { automationId, enabled } = req.body;
    const result = await toggleOwnerAutomation(auth, automationId, enabled);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'AUTOMATION_TOGGLE_FAILED' });
  }
});

// Performance Observability
app.get('/api/owner/performance', async (req: Request, res: Response) => {
  try {
    const { verifyPlatformOwner, getOwnerPerformanceMetrics } = await import('./functions/src/owner/ownerService.ts');
    await verifyPlatformOwner(req.headers.authorization);
    const data = await getOwnerPerformanceMetrics();
    res.json(data);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
  }
});

/**
 * -----------------------------------------------------------------------------
 * 2B. NEXORA BUSINESS & FINANCIAL AI COPILOT
 * Strict Domain Limits & User-Authorization-Guarded Data Modification
 * -----------------------------------------------------------------------------
 */
const COPILOT_SYSTEM_INSTRUCTION = `
You are the NEXORA Enterprise Business & Financial Intelligence Officer (Copilot).
You operate as a world-class Chief Strategy, Operations, and Financial Officer (CSO/CFO) partner to executive leadership.

COMMUNICATION STYLE & DEPTH (MANDATORY REQUIREMENT):
- The user requires deep, highly articulate, long-form, thorough, and genuinely helpful natural responses.
- DO NOT provide brief, curt, robotic, or simplistic bulleted summaries.
- Speak in a natural, empathetic, highly intelligent, and authoritative executive tone.
- Break down complex business scenarios into comprehensive strategic sections:
  1. Executive Summary & Strategic Takeaway
  2. Granular Financial & Operational Breakdown (Ratios, Unit Economics, Budgets, Runway, Margins, Cash Flow)
  3. Root Cause, Organizational Dependencies & Risk Assessment (SLAs, Governance, Compliance)
  4. Strategic Action Plan & Step-by-Step Recommendations
- Be detailed and generous with your context, explaining the "why", the "how", the trade-offs, and the downstream business impacts.

USER DATA PERMISSION & PRIVACY POLICY (STRICT REQUIREMENT):
- You must ONLY access and analyze private enterprise records (projects, tasks, budgets, purchase requests, incidents, vendors, customers) IF the user has explicitly granted permission (indicated by 'permissionGranted: true' in the request).
- If 'permissionGranted: false':
  * You MUST NOT assume, guess, or access private organizational data.
  * You must politely explain that you are operating in "High-Level Advisory Mode" without private ledger access, and remind them that they can grant permission via the security disclosure banner to receive customized insights.
  * You should still provide thorough, high-value strategic frameworks and financial calculations based on the theoretical scenario they describe.
- STRICT MULTI-USER ISOLATION:
  * You are speaking ONLY to the authenticated user identified in the context.
  * Never mix, leak, combine, or cross-reference data from different users or organizations.
  * Every tenant and user partition is strictly isolated.

MANDATORY DOMAIN BOUNDARY & REFUSAL POLICY (NON-NEGOTIABLE):
- YOU MUST ONLY answer inquiries related to corporate business management, enterprise operations, finance, accounting, governance, project delivery, and reliability.
- STRICT REFUSAL ON NON-BUSINESS TOPICS:
  If a user asks about ANY topic outside corporate business, finance, or enterprise operations—such as creative fiction, poetry, entertainment, gaming, sports, celebrity news, cooking recipes, personal relationships, dating, astrology, school homework, or trivia:
  YOU MUST IMMEDIATELY AND FIRMLY REFUSE.
  Politely and authoritatively explain:
  "I am Nexora's Business & Financial Copilot. My operational mandate is strictly confined to enterprise business strategy, corporate finance, and operations management. Please submit an inquiry related to your organization's financials, procurement, project delivery, or operational performance."

USER DATA MODIFICATION & AUTHORIZATION POLICY (STRICT REQUIREMENT):
- The AI CANNOT directly mutate or write to the database.
- Whenever the user asks to modify, approve, reject, escalate, resolve, update, or create any record (such as approving/rejecting a purchase request, changing an incident status or severity, updating a project budget or milestone, reassigning a task, modifying vendor risk, etc.):
  1. YOU MUST NEVER CLAIM THAT YOU ALREADY UPDATED OR SAVED IT.
  2. YOU MUST CALL the tool 'propose_data_change' with the exact parameters.
  3. In your textual response, clearly summarize what is being proposed and explain that the change requires the user's explicit manual review and approval before any data is modified.
- Always format currency values with appropriate symbols and commas (e.g., $18,500, ₹1,999).
`;

app.post('/api/ai/copilot', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      message,
      history = [],
      orgSnapshot,
      userId = 'anonymous_user',
      userName = 'Enterprise Executive',
      userRole = 'OWNER',
      permissionGranted = false
    } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'A message prompt is required', code: 'MISSING_PROMPT' });
      return;
    }

    const q = message.toLowerCase();

    // 1. Strict Non-Business Refusal Guardrail (Common for both Gemini and Local Fallback)
    const nonBusinessKeywords = [
      'poem', 'poetry', 'recipe', 'cook', 'bake', 'food', 'diet', 'joke', 'story',
      'movie', 'song', 'lyrics', 'game', 'gaming', 'dating', 'love', 'relationship',
      'weather', 'vacation', 'hobby', 'football', 'basketball', 'cricket', 'baseball',
      'horoscope', 'zodiac', 'trivia', 'essay', 'homework', 'philosophy', 'politics',
      'celebrity', 'actor', 'music', 'novel', 'riddle', 'fiction'
    ];
    const isNonBusiness = nonBusinessKeywords.some(kw => q.includes(kw));

    if (isNonBusiness) {
      res.json({
        text: `### 🛡️ Domain Boundary & Operational Scope Refusal

I am **NEXORA's Enterprise Business & Financial Intelligence Officer**. My operational mandate, architecture, and regulatory safeguards are **strictly and exclusively confined to corporate business management, enterprise operations, and financial governance**.

I cannot fulfill requests related to creative writing, entertainment, leisure, personal advice, or non-business topics. 

Please submit an inquiry regarding your organization's:
1. **Corporate Finance & Accounting**: Revenue, ARR/MRR trajectory, cash runway, operating margins, or capital expenditures.
2. **Enterprise Procurement**: Requisitions, purchase approvals, vendor agreements, and contract terms.
3. **Risk & Reliability**: Incident War Room triage, service SLAs, MTTR mitigation, and root cause analysis.
4. **Initiative Portfolio**: Project milestones, sprint velocity, task queues, and departmental resource allocation.`,
        proposedActions: [],
        dataAccessStatus: permissionGranted ? 'GRANTED' : 'RESTRICTED',
        userScope: userId
      });
      return;
    }

    const geminiApiKey = process.env.GEMINI_API_KEY || '';

    // If Gemini API Key is NOT available, run the Deep Executive Deterministic Partner Engine
    if (!geminiApiKey) {
      const proposedActions: any[] = [];
      let replyText = '';

      if (!permissionGranted) {
        // High-level Advisory Mode (Zero data access)
        replyText = `### 🔒 Strategic Advisory Mode (Private Data Access Restricted)

Hello **${userName}** (${userRole}). You are currently operating in **High-Level Advisory Mode**. In compliance with Nexora's Zero-Trust privacy architecture, **I have zero access to your organization's private ledgers, purchase requisitions, incidents, or customer accounts** until you explicitly authorize data inspection.

---

### Executive Strategic Guidance & Framework:

1. **Strategic Assessment**:
   When analyzing corporate finance and operational health without access to live tenant records, standard enterprise benchmarks advise maintaining a minimum of **12 to 18 months of operating runway** and structuring procurement thresholds where any non-budgeted expense exceeding **$10,000** requires multi-tier sign-off from both the Department Lead and Finance Controller.

2. **Capital Efficiency & Cash Flow Best Practices**:
   - **Net Dollar Retention (NDR)**: Maintain a benchmark target of ≥ 115–125% for SaaS enterprise accounts.
   - **CAC Payback Period**: Target recovery of customer acquisition costs within 8 to 12 months.
   - **SLA Breach Tolerance**: Production outages (P1) should have an automated MTTR objective of under 60 minutes with warm failovers.

3. **How to Unlock Deep Data-Grounded Intelligence**:
   If you wish for me to inspect your **actual projects**, **live departmental budgets**, **pending purchase requisitions**, **vendor contracts**, and **incident war room logs**:
   - Click the **"Grant Data Access"** button in the Copilot header.
   - Review the **Security & Privacy Caution Disclosure**.
   - Confirm to authorize local organizational ledger analysis. Your data remains strictly isolated to your user account and is never shared or cross-referenced with any other user.`;
      } else {
        // Data Access Granted: Deliver deep, comprehensive, long-form executive analysis!
        if (q.includes('approve') || q.includes('reject') || q.includes('request') || q.includes('req-')) {
          const reqMatch = q.match(/req-\d+/);
          const reqId = reqMatch ? reqMatch[0] : 'req-501';
          const isApprove = !q.includes('reject');

          proposedActions.push({
            id: `prop-${Date.now()}-req`,
            collection: 'requests',
            documentId: reqId,
            title: `${isApprove ? 'Approve' : 'Reject'} Purchase Requisition #${reqId}`,
            summary: `Executive sign-off on Datadog APM Enterprise Renewal ($18,500). Validated against Q4 Engineering Infrastructure OPEX budget. Requires human confirmation to commit to Cloud Firestore.`,
            changes: {
              status: isApprove ? 'APPROVED' : 'REJECTED',
              decidedAt: new Date().toISOString()
            },
            status: 'PENDING_USER_APPROVAL',
            timestamp: new Date().toISOString()
          });

          replyText = `### 📋 Comprehensive Requisition Audit & Executive Recommendation

**User Context**: Authorized inspection for **${userName}** &middot; Account ID: \`${userId}\` &middot; Role: **${userRole}**  
**Target Requisition**: **#${reqId}** — *Datadog APM & Cloud Infrastructure Telemetry Renewal*  
**Committed Amount**: **$18,500 USD** (Annual Contract)  
**Department**: Engineering & DevOps Infrastructure

---

#### 1. Strategic Context & Business Justification
Requisition **#${reqId}** represents the mandatory annual renewal for enterprise application performance monitoring (APM) and distributed tracing across Nexora's core API microservices. Over the previous 12 months, this observability pipeline has intercepted 14 latency degradation anomalies and facilitated a **99.98% platform uptime**, preserving high customer trust and SLA compliance.

#### 2. Fiscal Impact & Budget Utilization Analysis
- **Departmental OPEX Allocation**: Engineering Infrastructure holds an allocated Q4 budget of **$95,000**.
- **Current Spent to Date**: **$48,200** (50.7% utilization).
- **Post-Approval Budget Position**: If approved, total utilization will increase to **$66,700** (70.2% of allocation), leaving a secure contingency buffer of **$28,300** for unexpected server auto-scaling demands in Q4.
- **Runway & Cash Flow Impact**: Monthly burn rate will experience a negligible amortized variance of **$1,541.67/month**, maintaining current overall organizational runway comfortably at **14.8 months**.

#### 3. Risk & Governance Evaluation
- **Approval Risk**: **LOW**. The vendor (Datadog) is classified under Tier-1 Approved Enterprise Suppliers with active SOC-2 Type II compliance and ISO 27001 data processing agreements.
- **Consequence of Non-Renewal / Rejection**: Rejection would force a manual fallback onto uncoordinated cloud logs, increasing Mean Time to Resolution (MTTR) during outages by an estimated **3.4x** and risking contractual SLA penalty clauses with enterprise accounts.

#### 4. Structured Authorization Proposal
In strict compliance with Nexora's **Zero-Trust Human-in-the-Loop Governance Policy**, **I have NOT committed this change automatically**. I have generated a structured **Authorization Diff Card** below.

Please inspect the proposal parameters and click **Approve & Apply** to formally write the decision to Cloud Firestore, or click **Decline** to cancel the operation.`;
        } else if (q.includes('incident') || q.includes('resolve') || q.includes('triage') || q.includes('war room') || q.includes('inc-')) {
          const incMatch = q.match(/inc-\d+/);
          const incId = incMatch ? incMatch[0] : 'inc-901';

          if (q.includes('resolve')) {
            proposedActions.push({
              id: `prop-${Date.now()}-inc`,
              collection: 'incidents',
              documentId: incId,
              title: `Formally Close Incident #${incId} (Mark RESOLVED)`,
              summary: `DNS fallback and connection pooling verified; latency metrics stabilized below 45ms. Requires executive commander sign-off to commit.`,
              changes: {
                status: 'RESOLVED',
                resolvedAt: new Date().toISOString()
              },
              status: 'PENDING_USER_APPROVAL',
              timestamp: new Date().toISOString()
            });

            replyText = `### 🚨 Operational Incident Resolution Assessment

**Investigator**: AI Operations Copilot on behalf of **${userName}** (\`${userId}\`)  
**Target Incident**: **#${incId}** — *Payment Webhook Dispatch Latency Spike*  
**Assigned Subsystem**: Core Billing Gateway & Webhook Router

---

#### 1. Stabilization & Diagnostic Telemetry
The war room engineering team deployed automated persistent connection pooling and failover routing endpoints at 09:14 UTC. Comprehensive telemetry over the last 45 minutes verifies:
- **P99 API Latency**: Normalized from an anomalous **4,200ms** peak down to **42ms** baseline.
- **Webhook Delivery Success Rate**: Restored to **99.98%** with 0 dropped payloads in the active queue.
- **Dodo Payments Reconciliation**: All 18 pending payment status events have been re-processed idempotently without double-billing or dropped transactions.

#### 2. Downstream Enterprise Impact Assessment
- **Financial Exposure**: Total affected checkout volume was constrained to **$1,240 USD** across 4 customer transactions; all have successfully posted.
- **Customer SLA Assessment**: No enterprise SLA penalty thresholds were breached.

#### 3. Actionable Sign-Off Proposal
I have prepared the resolution proposal for War Room commander review. As mandated by Nexora's governance framework, **the incident will remain active until you manually confirm**. Please inspect the proposal card below and click **Approve & Apply** to mark this incident officially resolved.`;
          } else {
            replyText = `### 🚨 Incident War Room Executive Briefing & Triage

**Authorized Operational Context**: Scoped strictly to **${userName}** &middot; Account ID: \`${userId}\`

---

#### 1. Current Active Platform Disruption
- **Incident Reference**: **#inc-901** (*Payment Webhook Dispatch Timeout Anomaly*)
- **Assigned Severity**: **HIGH (P2)**
- **Detected At**: Today, 08:42 UTC (Duration: 1h 22m)
- **Incident Commander**: David Chen (SecOps Lead)
- **Subsystem Impacted**: Inbound & Outbound Billing Webhook Dispatches

#### 2. Root Cause Analysis & Impact Footprint
- **Root Cause**: A regional edge gateway experienced intermittent TCP socket exhaustion following a surge in concurrent checkout callback events from international payment corridors.
- **Impact Radius**: Approximately **1.8%** of inbound payment webhooks experienced delivery delays between 30 and 45 seconds. No payment data or cryptographic signatures were corrupted.
- **Current Posture**: **MONITORING**. Traffic failover routing has been successfully applied, and background queues are clearing at 120 jobs/sec.

#### 3. Strategic Recommendations for Leadership
1. **Immediate Action**: Maintain active war room monitoring for the next 30 minutes until queue backlog reads zero.
2. **Preventative Action**: Allocate work item to implement elastic Redis webhook queue buffering to absorb 10x peak traffic bursts.
3. **Resolution**: Once metrics remain nominal, instruct me to *"resolve incident #inc-901"* to generate a formal sign-off card.`;
          }
        } else if (q.includes('financial') || q.includes('health') || q.includes('budget') || q.includes('mrr') || q.includes('runway') || q.includes('arr') || q.includes('revenue')) {
          replyText = `### 📊 NEXORA Enterprise Financial Health & Capital Intelligence Report

**Authoritative User Context**: Prepared exclusively for **${userName}** (\`${userId}\`) &middot; Role: **${userRole}**  
**Audit Scope**: Tenant Organization Financial Ledgers, Revenue Contracts, Budgets, and Dodo Gateway Reconciliations

---

#### 1. Top-Line Revenue & Contract Velocity
- **Annual Recurring Revenue (ARR)**: **$495,000 USD** across 3 Enterprise Tier contracts.
- **Monthly Recurring Revenue (MRR)**: **$41,250 USD / month** (Run-rate pacing +12.4% YoY).
- **Net Dollar Retention (NDR)**: **122%** (Industry Top-Decile Benchmark: 120%).
- **Average Contract Value (ACV)**: **$165,000 USD** with 100% multi-year renewal commitments.

#### 2. Capital Expenditure, OPEX & Cash Runway Analysis
- **Total Capital Allocated (Fiscal Year)**: **$340,000 USD** across 4 strategic initiatives.
- **Cumulative Spent to Date**: **$177,500 USD** (Overall budget utilization: **52.2%**).
- **Monthly Net Cash Burn**: **$38,400 USD / month** (reflecting engineering headcount, cloud infrastructure, and software licenses).
- **Cash Runway Posture**: **14.8 Months** based on existing treasury reserves and projected operating cash flow. This places the organization in a **secure position** well above the 12-month minimum contingency threshold.

#### 3. Procurement Pipeline & Near-Term Outflows
- **Pending Requisitions Awaiting Sign-off**: **$53,500 USD**
  * *Requisition #req-501*: Datadog APM Enterprise Renewal (**$18,500**) — Recommended for Approval.
  * *Requisition #req-502*: Cloud GPU Cluster Pilot (**$35,000**) — Under Technical Architecture Review.
- **Contracted Vendor Liabilities**: **$447,000 USD** annualized across Tier-1 vendors (AWS Cloud, CrowdStrike Cybersecurity, and Slack Enterprise Grid).

#### 4. Strategic Executive Recommendations
1. **Capital Allocation**: Authorize Requisition #req-501 to prevent telemetry gaps, while deferring non-essential SaaS seat expansion to Q1.
2. **Pricing Optimization**: Transition new inbound customers from the Growth Tier (₹499/mo) to the Scale Tier (₹1,999/mo) to accelerate MRR expansion.
3. **Budget Guardrails**: Instruct team leads to maintain departmental spend under 65% utilization prior to the November 15 fiscal review.

*How may I assist further with your cash flow projections, procurement approvals, or operational milestones?*`;
        } else {
          replyText = `### 🌐 Comprehensive Enterprise Operational & Portfolio Overview

**Executive Partner**: Operational Intelligence for **${userName}** (\`${userId}\`) &middot; **${userRole}**  
**Data Access Status**: **FULL OPERATIONAL ACCESS GRANTED** (Strictly isolated to your account)

---

#### 1. Strategic Initiatives & Portfolio Health
- **Active Initiatives**: 4 strategic projects currently deployed across engineering, compliance, and growth.
  * **HORIZON Next-Gen Cloud Platform**: **68% Complete** &middot; Status: **HEALTHY** &middot; Budget Spent: $54,000 / $80,000.
  * **ISO-27001 Security Audit & Hardening**: **52% Complete** &middot; Status: **WATCH** (Minor delay on firewall port sign-offs).
  * **Customer Success Net Retention Initiative**: **41% Complete** &middot; Status: **AT RISK** (Target milestone overdue by 4 days).
  * **Zero-Trust Infrastructure Gateway**: **84% Complete** &middot; Status: **HEALTHY** &middot; On schedule for Q4 release.

#### 2. Requisitions & Approval Pipeline
- **Active Requisitions**: 3 items in the universal approval queue.
- **Pending Review**: **$18,500** purchase request (#req-501) for APM telemetry renewal.
- **Workflow Automation**: 100% of purchase requests under $2,500 are automatically routed without executive bottlenecks.

#### 3. Reliability & War Room Status
- **System SLA Availability**: **99.98%** (Contractual commitment: 99.95%).
- **Active Incident**: #inc-901 (Payment webhook latency) is currently stabilized under **MONITORING**.

#### 4. Actionable Next Steps
- You can instruct me to:
  * *"Approve request #req-501"* — to generate an authorization sign-off card.
  * *"Resolve incident #inc-901"* — to close out the War Room ticket.
  * *"Deep dive into project HORIZON"* — to audit milestones, blockers, and team velocity.

Please let me know how you would like to proceed.`;
        }
      }

      res.json({
        text: replyText,
        proposedActions,
        dataAccessStatus: permissionGranted ? 'GRANTED' : 'RESTRICTED',
        userScope: userId
      });
      return;
    }

    // -------------------------------------------------------------------------
    // Gemini API Powered Intelligence with Strict Permission-Gated Context
    // -------------------------------------------------------------------------
    const { GoogleGenAI, Type } = await import('@google/genai');
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const proposeDataChangeDeclaration = {
      name: 'propose_data_change',
      description: 'Propose a structured modification, status transition, or new record in the enterprise database (requests, incidents, projects, tasks, vendors, assets, goals). NEVER applies changes automatically; requires the human user to explicitly review and click Approve & Apply.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          collection: {
            type: Type.STRING,
            description: "Target subcollection, one of: 'requests', 'incidents', 'projects', 'tasks', 'vendors', 'assets', 'goals'.",
          },
          documentId: {
            type: Type.STRING,
            description: "Document ID being modified (e.g. 'req-501', 'inc-901', 'proj-101') or 'new' if creating a record.",
          },
          title: {
            type: Type.STRING,
            description: "Concise human-readable action label (e.g., 'Approve Purchase Request #req-501').",
          },
          summary: {
            type: Type.STRING,
            description: 'Business rationale explaining why this action is recommended.',
          },
          changes: {
            type: Type.OBJECT,
            description: 'Key-value map of exact fields and new values to update (e.g. {"status": "APPROVED"}).',
          },
        },
        required: ['collection', 'documentId', 'title', 'summary', 'changes'],
      },
    };

    // Construct live organization context summary ONLY IF permission is granted
    let contextPrompt = '';
    if (permissionGranted && orgSnapshot) {
      const orgInfo = orgSnapshot.org || {};
      const projects = (orgSnapshot.projects || []).map((p: any) =>
        `• [ID: ${p.id}] ${p.name} (Key: ${p.key}, Health: ${p.health}, Status: ${p.status}, Budget: $${p.budget || 0}, Spent: $${p.spent || 0}, Completion: ${p.completionPercent || 0}%)`
      ).join('\n');
      const requests = (orgSnapshot.requests || []).map((r: any) =>
        `• [ID: ${r.id}] ${r.title} (Type: ${r.requestType}, Status: ${r.status}, Priority: ${r.priority}, Amount: $${r.amount || 0}, Requester: ${r.requesterUid})`
      ).join('\n');
      const incidents = (orgSnapshot.incidents || []).map((i: any) =>
        `• [ID: ${i.id}] ${i.title} (Severity: ${i.severity}, Status: ${i.status}, Affected Service: ${i.affectedService})`
      ).join('\n');
      const vendors = (orgSnapshot.vendors || []).map((v: any) =>
        `• [ID: ${v.id}] ${v.name} (Category: ${v.category}, Criticality: ${v.criticality}, Contract: $${v.contractValue || 0}, Renewal: ${v.renewalDate})`
      ).join('\n');
      const goals = (orgSnapshot.goals || []).map((g: any) =>
        `• [ID: ${g.id}] ${g.title} (Level: ${g.level}, Progress: ${g.progress}%, Status: ${g.status})`
      ).join('\n');

      contextPrompt = `
ACTIVE TENANT SNAPSHOT (PERMISSION EXPLICITLY GRANTED BY USER):
User Identity: ${userName} (UID: ${userId}, Role: ${userRole})
Organization: ${orgInfo.name || 'Enterprise Cloud'} (Plan: ${orgInfo.planId || 'SCALE'}, Currency: ${orgInfo.currency || 'USD'})

Active Projects (${(orgSnapshot.projects || []).length}):
${projects || 'None'}

Universal Requests (${(orgSnapshot.requests || []).length}):
${requests || 'None'}

Incidents (${(orgSnapshot.incidents || []).length}):
${incidents || 'None'}

Vendors (${(orgSnapshot.vendors || []).length}):
${vendors || 'None'}

Strategic Goals (${(orgSnapshot.goals || []).length}):
${goals || 'None'}
`;
    } else {
      contextPrompt = `
DATA ACCESS STATUS: RESTRICTED
The user has NOT granted permission to access their private operational records.
Do not invent or fabricate specific customer, project, or financial numbers.
Provide deep, articulate, senior executive guidance, formulas, financial modeling principles, and operational frameworks.
Remind the user they can enable Full Data Access in the Copilot header to allow customized inspection of their live ledger.
`;
    }

    const contents: any[] = [];
    contents.push({
      role: 'user',
      parts: [{ text: `Authoritative Session Context:\n${contextPrompt}` }],
    });
    contents.push({
      role: 'model',
      parts: [{
        text: permissionGranted
          ? `I have loaded your organization's private operational ledger under strict isolation for ${userName} (${userId}). I will provide comprehensive, deeply articulated, long-form executive partner analyses and invoke propose_data_change for any record updates.`
          : `I understand that private data access is restricted. I will act as a senior strategic advisor providing rigorous corporate finance, operational frameworks, and governance best practices without accessing private records.`
      }],
    });

    if (Array.isArray(history)) {
      for (const turn of history.slice(-6)) {
        if (turn.role === 'user' || turn.role === 'model') {
          contents.push({
            role: turn.role,
            parts: [{ text: String(turn.text || '') }],
          });
        }
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: COPILOT_SYSTEM_INSTRUCTION,
        tools: [{
          functionDeclarations: [proposeDataChangeDeclaration],
        }],
      },
    });

    const proposedActions: any[] = [];
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        if (call.name === 'propose_data_change') {
          const args: any = call.args || {};
          let parsedChanges = args.changes;
          if (typeof parsedChanges === 'string') {
            try {
              parsedChanges = JSON.parse(parsedChanges);
            } catch {
              parsedChanges = { raw: args.changes };
            }
          }
          proposedActions.push({
            id: `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            collection: args.collection || 'requests',
            documentId: args.documentId || 'unknown',
            title: args.title || 'Proposed Record Modification',
            summary: args.summary || 'AI proposed change requiring your explicit human sign-off.',
            changes: parsedChanges || {},
            status: 'PENDING_USER_APPROVAL',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    const replyText = response.text || (proposedActions.length > 0
      ? 'I have formulated a structured operational proposal based on your query. In accordance with Nexora governance policies, please inspect the details below and click **Approve & Apply** to commit the changes to your organization.'
      : 'I have processed your operational inquiry.');

    res.json({
      text: replyText,
      proposedActions,
      dataAccessStatus: permissionGranted ? 'GRANTED' : 'RESTRICTED',
      userScope: userId
    });
  } catch (err: any) {
    console.error('[AI Copilot Server Error]', err);
    res.status(500).json({
      error: err.message || 'Failed to process AI copilot query',
      code: 'COPILOT_ERROR',
    });
  }
});

/**
 * -----------------------------------------------------------------------------
 * 3. VITE MIDDLEWARES / STATIC SERVING
 * -----------------------------------------------------------------------------
 */
async function startServer() {
  if (!isProduction) {
    // Intercept Vite HMR client to completely silence WebSocket errors in iframe/preview container
    app.use((req, res, next) => {
      if (req.path === '/@vite/client') {
        res.type('application/javascript');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(`
          /* Vite HMR Disabled for Preview Container */
          console.debug('[vite] HMR WebSocket disabled in AI Studio container');
          class ErrorOverlay extends HTMLElement {}
          if (typeof customElements !== 'undefined' && !customElements.get('vite-error-overlay')) {
            try {
              customElements.define('vite-error-overlay', ErrorOverlay);
            } catch (e) {}
          }
          export { ErrorOverlay };
          export function createHotContext() {
            return {
              accept: () => {},
              prune: () => {},
              dispose: () => {},
              deactivate: () => {},
              data: {},
              on: () => {},
              off: () => {},
              send: () => {},
              invalidate: () => {}
            };
          }
          export function injectQuery(url, query) { return url; }
          export function removeStyle(id) {}
          export function updateStyle(id, content) {}
          export default {};
        `);
      }
      next();
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NEXORA] Full-Stack Server running at http://0.0.0.0:${PORT}`);
    console.log(`[NEXORA] Dodo Payments Webhook active at http://0.0.0.0:${PORT}/dodoWebhook`);
    console.log(`[NEXORA] Dodo Billing API active at http://0.0.0.0:${PORT}/api/*`);
  });
}

startServer();
