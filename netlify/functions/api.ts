import type { Handler, HandlerEvent } from '@netlify/functions';

// Protect process against uncaught background terminations in serverless environment
if (typeof process !== 'undefined' && process.on) {
  process.on('unhandledRejection', (reason) => {
    console.error('[LAMBDA REJECTION GUARD]', reason instanceof Error ? reason.message : reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[LAMBDA EXCEPTION GUARD]', err?.message || err);
  });
}

function getRoute(event: HandlerEvent): string {
  let path = event.path || '/';

  path = path.replace(
    /^\/\.netlify\/functions\/api/,
    ''
  );

  // Strip query string and hash if present in path
  path = path.split('?')[0].split('#')[0];

  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  // Netlify redirects /api/* to this function.
  // Normalize /api/health -> /health.
  if (path === '/api') {
    path = '/';
  } else if (path.startsWith('/api/')) {
    path = path.substring(4);
  }

  // Remove trailing slash if length > 1
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

function getBody(event: HandlerEvent): any {
  if (!event.body) {
    return {};
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getRawBody(event: HandlerEvent): string {
  if (!event.body) {
    return '';
  }

  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function getHeader(
  event: HandlerEvent,
  name: string
): string | undefined {
  const headers = event.headers || {};

  const exact = headers[name];

  if (exact) {
    return exact;
  }

  const lowerName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

function json(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(err: any, route?: string) {
  let status =
    Number(err?.statusCode) ||
    Number(err?.status) ||
    500;

  if (err?.name === 'WebhookVerificationError' || /signature|webhook/i.test(err?.message || '')) {
    status = 400;
  } else if (err?.name === 'AuthError') {
    status = err.statusCode || 401;
  } else if (err?.name === 'EntitlementError') {
    status = err.statusCode || 403;
  }

  // Map upstream payment provider network errors to 502 (only if not a signature or client error)
  if (err?.message && /dodopayments|dodo api/i.test(err.message) && status === 500 && !/webhook|signature/i.test(err.message)) {
    status = 502;
  }

  const code =
    err?.code ||
    (status === 401
      ? 'UNAUTHORIZED'
      : status === 403
      ? 'FORBIDDEN'
      : status === 404
      ? 'NOT_FOUND'
      : status === 422
      ? 'UNPROCESSABLE_ENTITY'
      : status === 502
      ? 'UPSTREAM_PAYMENT_ERROR'
      : status === 400
      ? 'BAD_REQUEST'
      : 'INTERNAL_ERROR');

  const safeMessage = err?.message || 'Request failed';

  return json(status, {
    error: safeMessage,
    code,
    route: route || undefined,
    timestamp: new Date().toISOString(),
  });
}

export const handler: Handler = async (event: HandlerEvent, context: any) => {
  // Prevent AWS Lambda from hanging on active Firestore/gRPC connection pools
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  let route = '/';
  let method = 'GET';

  try {
    route = getRoute(event);
    method = event?.httpMethod || 'GET';

    // Handle CORS preflight options
    if (method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
        body: '',
      };
    }

    /*
     * ------------------------------------------------------------
     * DODO WEBHOOK
     * ------------------------------------------------------------
     */
    if (route === '/dodoWebhook') {
      if (method !== 'POST') {
        return json(405, {
          error: 'Method Not Allowed',
          code: 'METHOD_NOT_ALLOWED',
        });
      }

      console.log('[NETLIFY][WEBHOOK] Incoming Dodo webhook received');

      const rawBody = getRawBody(event);

      // 1. Enforce non-empty string body
      if (!rawBody || typeof rawBody !== 'string' || !rawBody.trim()) {
        return json(400, {
          error: 'Malformed webhook request: body cannot be empty',
          code: 'EMPTY_WEBHOOK_BODY',
          route,
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Validate JSON syntax safely before SDK processing
      let parsedPayload: any;
      try {
        parsedPayload = JSON.parse(rawBody);
      } catch {
        return json(400, {
          error: 'Malformed webhook request: invalid JSON format',
          code: 'MALFORMED_JSON_PAYLOAD',
          route,
          timestamp: new Date().toISOString(),
        });
      }

      if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
        return json(400, {
          error: 'Malformed webhook request: payload must be a JSON object',
          code: 'INVALID_PAYLOAD_OBJECT',
          route,
          timestamp: new Date().toISOString(),
        });
      }

      // Normalize headers
      const eventHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(event.headers || {})) {
        if (value !== undefined) {
          eventHeaders[key.toLowerCase()] = Array.isArray(value) ? value[0] : String(value);
        }
      }

      const msgId = eventHeaders['webhook-id'] || eventHeaders['svix-id'];
      const msgSignature = eventHeaders['webhook-signature'] || eventHeaders['svix-signature'];
      const msgTimestamp = eventHeaders['webhook-timestamp'] || eventHeaders['svix-timestamp'];

      // 3. Validate signature presence before invoking SDK unwrap
      if (!msgSignature || !msgId || !msgTimestamp) {
        return json(400, {
          error: 'Missing required webhook signature headers (webhook-id, webhook-signature, webhook-timestamp)',
          code: 'WEBHOOK_SIGNATURE_MISSING',
          route,
          timestamp: new Date().toISOString(),
        });
      }

      const {
        verifyAndParseDodoWebhook,
        processDodoWebhookEvent,
      } = await import(
        '../../functions/src/billing/webhook'
      );

      const eventId = msgId || `whk_${Date.now()}`;

      let webhookEvent: any;
      try {
        webhookEvent = verifyAndParseDodoWebhook(
          rawBody,
          eventHeaders
        );
      } catch (verifyErr: any) {
        return json(400, {
          error: verifyErr?.message || 'Invalid webhook signature',
          code: verifyErr?.code || 'WEBHOOK_SIGNATURE_INVALID',
          route,
          timestamp: new Date().toISOString(),
        });
      }

      let result: any;
      try {
        result = await processDodoWebhookEvent(
          webhookEvent,
          eventId
        );
      } catch (procErr: any) {
        console.error('[NETLIFY][WEBHOOK] Webhook event processing error:', procErr?.message || procErr);
        return json(500, {
          error: 'Failed to process webhook event: ' + (procErr?.message || 'Internal error'),
          code: 'WEBHOOK_PROCESSING_FAILED',
          route,
          timestamp: new Date().toISOString(),
        });
      }

      return json(200, {
        received: true,
        eventId,
        type: webhookEvent.type,
        orgId: result?.orgId || null,
      });
    }

    /*
     * ------------------------------------------------------------
     * API ROUTES
     * ------------------------------------------------------------
     */

    if (route === '/health' && method === 'GET') {
      const { getDodoConfig } = await import(
        '../../functions/src/config/dodo'
      );
      const { getFirebaseAdminDiagnostics } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const config = getDodoConfig();
      const firebaseDiag = getFirebaseAdminDiagnostics();

      return json(200, {
        service: 'nexora-dodo-backend',
        version: '2.1.0',
        runtime: 'Netlify Functions',
        dodoConfigured: config.isConfigured,
        environment: config.environment,
        productIds: config.productIds,
        firebaseAdmin: firebaseDiag,
        timestamp: new Date().toISOString(),
      });
    }

    if (route === '/diagnostics' && method === 'GET') {
      const { verifyBearerToken, verifyOrgBillingAccess, getFirebaseAdminDiagnostics } = await import(
        '../../functions/src/auth/firebaseAuth'
      );
      const { getDodoConfig } = await import(
        '../../functions/src/config/dodo'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const orgId = event.queryStringParameters?.orgId;
      let orgStatus = 'not_provided';

      if (orgId) {
        try {
          await verifyOrgBillingAccess(auth, orgId);
          orgStatus = 'authorized';
        } catch (orgErr: any) {
          orgStatus = `denied: ${orgErr.message}`;
        }
      }

      return json(200, {
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
    }

    if (route === '/createCheckoutSession' && method === 'POST') {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        handleCreateCheckoutSession,
      } = await import(
        '../../functions/src/billing/checkout'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const result =
        await handleCreateCheckoutSession(
          auth,
          getBody(event)
        );

      return json(200, result);
    }

    if (
      route === '/getBillingState' &&
      method === 'GET'
    ) {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        handleGetBillingState,
      } = await import(
        '../../functions/src/billing/billingState'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const orgId =
        event.queryStringParameters?.orgId || '';

      const result =
        await handleGetBillingState(
          auth,
          orgId
        );

      return json(200, result);
    }

    if (
      route === '/changeSubscriptionPlan' &&
      method === 'POST'
    ) {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        handleChangeSubscriptionPlan,
      } = await import(
        '../../functions/src/billing/subscriptions'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const result =
        await handleChangeSubscriptionPlan(
          auth,
          getBody(event)
        );

      return json(200, result);
    }

    if (
      route === '/previewPlanChange' &&
      method === 'POST'
    ) {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        handlePreviewPlanChange,
      } = await import(
        '../../functions/src/billing/subscriptions'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const result =
        await handlePreviewPlanChange(
          auth,
          getBody(event)
        );

      return json(200, result);
    }

    if (
      route === '/cancelSubscription' &&
      method === 'POST'
    ) {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        handleCancelSubscription,
      } = await import(
        '../../functions/src/billing/subscriptions'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const result =
        await handleCancelSubscription(
          auth,
          getBody(event)
        );

      return json(200, result);
    }

    if (
      route === '/reactivateSubscription' &&
      method === 'POST'
    ) {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        handleReactivateSubscription,
      } = await import(
        '../../functions/src/billing/subscriptions'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const result =
        await handleReactivateSubscription(
          auth,
          getBody(event)
        );

      return json(200, result);
    }

    if (
      route === '/createCustomerPortalSession' &&
      method === 'POST'
    ) {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        handleCreateCustomerPortalSession,
      } = await import(
        '../../functions/src/billing/portal'
      );

      const auth = await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const result =
        await handleCreateCustomerPortalSession(
          auth,
          getBody(event)
        );

      return json(200, result);
    }

    if (
      route === '/checkEntitlement' &&
      method === 'POST'
    ) {
      const { verifyBearerToken } = await import(
        '../../functions/src/auth/firebaseAuth'
      );

      const {
        EntitlementEngine,
      } = await import(
        '../../functions/src/entitlements/entitlementEngine'
      );

      await verifyBearerToken(
        getHeader(event, 'authorization')
      );

      const body = getBody(event);

      const {
        orgId,
        feature,
        limitKey,
        delta,
      } = body;

      if (!orgId) {
        throw new Error('Missing orgId');
      }

      if (feature) {
        const result =
          await EntitlementEngine.checkFeature(
            orgId,
            feature
          );

        return json(200, result);
      }

      if (limitKey) {
        const result =
          await EntitlementEngine.checkLimit(
            orgId,
            limitKey,
            delta || 1
          );

        return json(200, result);
      }

      const entitlements =
        await EntitlementEngine.getOrgEntitlements(
          orgId
        );

      return json(200, {
        allowed: true,
        ...entitlements,
      });
    }

    /*
     * ------------------------------------------------------------
     * OWNER COMMAND CENTER API ROUTES
     * Enforces authoritative server-side master authorization.
     * ------------------------------------------------------------
     */
    if (route.startsWith('/owner/')) {
      const {
        verifyPlatformOwner,
        getOwnerOverview,
        getOwnerUsers,
        executeOwnerUserAction,
        getOwnerOrganizations,
        executeOwnerOrgAction,
        getOwnerBilling,
        getOwnerPayments,
        getOwnerWebhooks,
        getOwnerAuditLogs,
        getOwnerSecurityCenter,
        getOwnerFeatureFlags,
        updateOwnerFeatureFlag,
        getOwnerSystemHealth,
        searchOwnerEntities,
        generateOwnerExport,
        getOwnerIncidents,
        createOwnerIncident,
        updateOwnerIncidentStatus,
        getOwnerAnalytics,
        getOwnerPlatformConfig,
        updateOwnerPlatformConfig,
        retryOwnerWebhookEvent,
        getOwnerNotes,
        saveOwnerNote,
        executeOwnerBulkUserAction,
        executeOwnerBulkOrgAction,
        getOwnerReconciliation,
        getOwnerDataQuality,
        getOwnerDailyBrief,
        getOwnerTasks,
        createOwnerTask,
        updateOwnerTaskStatus,
        getOwnerAutomations,
        toggleOwnerAutomation,
        getOwnerPerformanceMetrics,
      } = await import('../../functions/src/owner/ownerService');

      const authHeader = getHeader(event, 'authorization');

      if (route === '/owner/verify' && method === 'GET') {
        const auth = await verifyPlatformOwner(authHeader);
        return json(200, {
          authorized: true,
          role: 'platform_owner',
          email: auth.email,
          uid: auth.uid,
          timestamp: new Date().toISOString(),
        });
      }

      if (route === '/owner/overview' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const timeRange = event.queryStringParameters?.timeRange || '30d';
        const overview = await getOwnerOverview(timeRange);
        return json(200, overview);
      }

      if (route === '/owner/users' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const search = event.queryStringParameters?.search;
        const status = event.queryStringParameters?.status;
        const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit, 10) : 50;
        const users = await getOwnerUsers({ search, status, limit });
        return json(200, users);
      }

      if (route === '/owner/users/action' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { targetUid, action, payload } = getBody(event);
        const result = await executeOwnerUserAction(auth, targetUid, action, payload);
        return json(200, result);
      }

      if (route === '/owner/organizations' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const search = event.queryStringParameters?.search;
        const plan = event.queryStringParameters?.plan;
        const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit, 10) : 50;
        const orgs = await getOwnerOrganizations({ search, plan, limit });
        return json(200, orgs);
      }

      if (route === '/owner/organizations/action' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { orgId, action, payload } = getBody(event);
        const result = await executeOwnerOrgAction(auth, orgId, action, payload);
        return json(200, result);
      }

      if (route === '/owner/billing' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const billing = await getOwnerBilling();
        return json(200, billing);
      }

      if (route === '/owner/payments' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const status = event.queryStringParameters?.status;
        const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit, 10) : 50;
        const payments = await getOwnerPayments({ status, limit });
        return json(200, payments);
      }

      if (route === '/owner/webhooks' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit, 10) : 30;
        const webhooks = await getOwnerWebhooks(limit);
        return json(200, webhooks);
      }

      if (route === '/owner/audit' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const action = event.queryStringParameters?.action;
        const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit, 10) : 50;
        const logs = await getOwnerAuditLogs({ action, limit });
        return json(200, logs);
      }

      if (route === '/owner/security' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const security = await getOwnerSecurityCenter();
        return json(200, security);
      }

      if (route === '/owner/features' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const flags = await getOwnerFeatureFlags();
        return json(200, flags);
      }

      if (route === '/owner/features/toggle' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { featureKey, enabled, rolloutPercentage } = getBody(event);
        const result = await updateOwnerFeatureFlag(auth, featureKey, enabled, rolloutPercentage);
        return json(200, result);
      }

      if (route === '/owner/health' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const health = await getOwnerSystemHealth();
        return json(200, health);
      }

      if (route === '/owner/search' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const q = event.queryStringParameters?.q || '';
        const results = await searchOwnerEntities(q);
        return json(200, results);
      }

      if (route === '/owner/export' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { dataset, format } = getBody(event);
        const exportResult = await generateOwnerExport(auth, dataset, format || 'json');
        return json(200, exportResult);
      }

      if (route === '/owner/incidents' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const status = event.queryStringParameters?.status;
        const incidents = await getOwnerIncidents({ status });
        return json(200, incidents);
      }

      if (route === '/owner/incidents' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const result = await createOwnerIncident(auth, getBody(event));
        return json(200, result);
      }

      if (route === '/owner/incidents/status' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { incidentId, status, note } = getBody(event);
        const result = await updateOwnerIncidentStatus(auth, incidentId, status, note);
        return json(200, result);
      }

      if (route === '/owner/analytics' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const timeRange = event.queryStringParameters?.timeRange || '30d';
        const analytics = await getOwnerAnalytics(timeRange);
        return json(200, analytics);
      }

      if (route === '/owner/config' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const config = await getOwnerPlatformConfig();
        return json(200, config);
      }

      if (route === '/owner/config' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const result = await updateOwnerPlatformConfig(auth, getBody(event));
        return json(200, result);
      }

      if (route === '/owner/webhooks/retry' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { eventId } = getBody(event);
        const result = await retryOwnerWebhookEvent(auth, eventId);
        return json(200, result);
      }

      if (route === '/owner/notes' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const entityType = event.queryStringParameters?.entityType || '';
        const entityId = event.queryStringParameters?.entityId || '';
        const notes = await getOwnerNotes(entityType, entityId);
        return json(200, notes);
      }

      if (route === '/owner/notes' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const result = await saveOwnerNote(auth, getBody(event));
        return json(200, result);
      }

      if (route === '/owner/bulk/users' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { uids, action } = getBody(event);
        const result = await executeOwnerBulkUserAction(auth, uids, action);
        return json(200, result);
      }

      if (route === '/owner/bulk/orgs' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { orgIds, action } = getBody(event);
        const result = await executeOwnerBulkOrgAction(auth, orgIds, action);
        return json(200, result);
      }

      if (route === '/owner/reconciliation' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const result = await getOwnerReconciliation();
        return json(200, result);
      }

      if (route === '/owner/data-quality' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const result = await getOwnerDataQuality();
        return json(200, result);
      }

      if (route === '/owner/daily-brief' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const result = await getOwnerDailyBrief();
        return json(200, result);
      }

      if (route === '/owner/tasks' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const result = await getOwnerTasks();
        return json(200, result);
      }

      if (route === '/owner/tasks' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { title, priority, entityType, entityId, notes } = getBody(event);
        const result = await createOwnerTask(auth, title, priority, entityType, entityId, notes);
        return json(200, result);
      }

      if (route === '/owner/tasks/status' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { taskId, status } = getBody(event);
        const result = await updateOwnerTaskStatus(auth, taskId, status);
        return json(200, result);
      }

      if (route === '/owner/automations' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const result = await getOwnerAutomations();
        return json(200, result);
      }

      if (route === '/owner/automations/toggle' && method === 'POST') {
        const auth = await verifyPlatformOwner(authHeader);
        const { automationId, enabled } = getBody(event);
        const result = await toggleOwnerAutomation(auth, automationId, enabled);
        return json(200, result);
      }

      if (route === '/owner/performance' && method === 'GET') {
        await verifyPlatformOwner(authHeader);
        const result = await getOwnerPerformanceMetrics();
        return json(200, result);
      }
    }

    /*
     * ------------------------------------------------------------
     * AI COPILOT & STATUS / HEALTH
     * ------------------------------------------------------------
     */
    if (route === '/ai/copilot') {
      if (method !== 'POST') {
        return json(405, {
          error: 'Method Not Allowed',
          code: 'METHOD_NOT_ALLOWED',
        });
      }
      const { handleAiCopilotRequest } = await import('../../functions/src/ai/copilotService');
      const authHeader = getHeader(event, 'authorization');
      const body = getBody(event);
      const result = await handleAiCopilotRequest(authHeader, body);
      return json(200, result);
    }

    if (route === '/ai/status' || route === '/ai/health') {
      if (method !== 'GET') {
        return json(405, {
          error: 'Method Not Allowed',
          code: 'METHOD_NOT_ALLOWED',
        });
      }
      const { handleAiStatus } = await import('../../functions/src/ai/copilotService');
      const result = await handleAiStatus();
      return json(200, result);
    }

    return json(404, {
      error: `Route not found: ${method} ${route}`,
      code: 'ROUTE_NOT_FOUND',
      route,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error(
      '[NEXORA NETLIFY FUNCTION ERROR]',
      err?.message || err
    );

    return errorResponse(err, route);
  }
};
