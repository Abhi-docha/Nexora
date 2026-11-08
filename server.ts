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

function getPort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 3000;
}

const PORT = getPort();
const app = express();
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
 * 2B. NEXORA BUSINESS & FINANCIAL AI COPILOT (OPENROUTER API)
 * Strict Domain Limits, Bearer Token Auth, Tenant Scoping & Honest Metrics
 * -----------------------------------------------------------------------------
 */

app.post('/api/ai/copilot', async (req: Request, res: Response): Promise<void> => {
  try {
    const { handleAiCopilotRequest } = await import('./functions/src/ai/copilotService.ts');
    const result = await handleAiCopilotRequest(req.headers.authorization, req.body);
    res.json(result);
    return;
  } catch (err: any) {
    const statusCode = err.statusCode || (err.name === 'AuthError' ? 401 : 500);
    res.status(statusCode).json({
      error: err.message || 'Failed to process AI copilot query',
      code: err.code || 'COPILOT_ERROR',
      retryAfter: err.retryAfter,
      timestamp: new Date().toISOString(),
    });
    return;
  }
});

app.get(['/api/ai/status', '/api/ai/health'], async (_req: Request, res: Response): Promise<void> => {
  try {
    const { handleAiStatus } = await import('./functions/src/ai/copilotService.ts');
    const status = await handleAiStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({
      error: err.message || 'Failed to check AI status',
      service: 'nexora-openrouter-ai',
      provider: 'openrouter',
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
