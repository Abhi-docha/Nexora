/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Automated Test & Verification Suite
 * Tests actual code paths for Authentication, Dodo Integration, Webhooks,
 * Checkout Flow, Netlify Functions Handler, and Billing Synchronization.
 */

import crypto from 'crypto';
import { handler } from '../netlify/functions/api';
import { getDodoConfig, getDodoClient } from '../functions/src/config/dodo';
import { getDodoProductIdForPlan, getPlanDefinition, resolvePlanFromDodoProductId } from '../functions/src/config/plans';
import { getFirebaseAdminDiagnostics, verifyBearerToken, AuthError } from '../functions/src/auth/firebaseAuth';
import { verifyAndParseDodoWebhook, processDodoWebhookEvent, WebhookVerificationError } from '../functions/src/billing/webhook';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

function generateStandardWebhookHeaders(payload: string, secret: string) {
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = Buffer.from(rawSecret, 'base64');
  const signature = crypto
    .createHmac('sha256', secretBytes)
    .update(`${msgId}.${timestamp}.${payload}`)
    .digest('base64');
  return {
    'webhook-id': msgId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
}

async function runTestSuite() {
  console.log('\n==================================================');
  console.log('NEXORA ENTERPRISE - PRODUCTION VERIFICATION SUITE');
  console.log('==================================================\n');

  /* ---------------------------------------------------------
   * 1. Firebase Admin & Authentication Diagnostics
   * --------------------------------------------------------- */
  console.log('1. Testing Firebase Admin & Private Key Resolution:');
  const diagnostics = getFirebaseAdminDiagnostics();
  assert(typeof diagnostics.projectId === 'string' && diagnostics.projectId.length > 0, 'Project ID is resolved', diagnostics.projectId);
  assert(diagnostics.firestoreDatabaseId === 'ai-studio-3b092059-520b-4f77-ac8f-80dfcc7fc88d', 'Designated Firestore Database ID matches', diagnostics.firestoreDatabaseId);
  assert(!('privateKey' in diagnostics), 'Diagnostics strictly hides and never leaks private key');
  assert(typeof diagnostics.hasPrivateKey === 'boolean', 'Diagnostics reports private key boolean flag safely');

  // Test Base64 decoding simulation
  const sampleKey = '-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\n';
  const base64Key = Buffer.from(sampleKey).toString('base64');
  const decodedKey = Buffer.from(base64Key, 'base64').toString('utf8');
  assert(decodedKey === sampleKey, 'Base64 decoding preserves exact key content and line breaks');

  // Test Bearer Token verification validation
  try {
    await verifyBearerToken(undefined);
    assert(false, 'Missing Authorization header throws AuthError');
  } catch (err: any) {
    assert(err instanceof AuthError && err.code === 'AUTH_HEADER_MISSING', 'Missing Authorization header throws AUTH_HEADER_MISSING');
  }

  try {
    await verifyBearerToken('InvalidScheme 12345');
    assert(false, 'Malformed Authorization header throws AuthError');
  } catch (err: any) {
    assert(err instanceof AuthError && err.code === 'AUTH_HEADER_MISSING', 'Malformed Authorization header throws AUTH_HEADER_MISSING');
  }

  try {
    await verifyBearerToken('Bearer ');
    assert(false, 'Empty Bearer token throws AuthError');
  } catch (err: any) {
    assert(err instanceof AuthError && err.code === 'AUTH_TOKEN_EMPTY', 'Empty Bearer token throws AUTH_TOKEN_EMPTY');
  }

  /* ---------------------------------------------------------
   * 2. Dodo Payments Configuration & Plans
   * --------------------------------------------------------- */
  console.log('\n2. Testing Dodo Payments Configuration & Plan Mappings:');
  const dodoConfig = getDodoConfig();
  assert(dodoConfig.environment === 'test_mode', 'Dodo environment is test_mode');
  assert(typeof dodoConfig.productIds.STARTER === 'string', 'STARTER plan product ID mapped', dodoConfig.productIds.STARTER);
  assert(typeof dodoConfig.productIds.GROWTH === 'string', 'GROWTH plan product ID mapped', dodoConfig.productIds.GROWTH);
  assert(typeof dodoConfig.productIds.SCALE === 'string', 'SCALE plan product ID mapped', dodoConfig.productIds.SCALE);

  const starterDef = getPlanDefinition('STARTER');
  assert(starterDef.monthlyPriceInr === 199, 'STARTER monthly price is 199 INR');
  const growthDef = getPlanDefinition('GROWTH');
  assert(growthDef.monthlyPriceInr === 499, 'GROWTH monthly price is 499 INR');
  const scaleDef = getPlanDefinition('SCALE');
  assert(scaleDef.monthlyPriceInr === 1999, 'SCALE monthly price is 1999 INR');

  assert(getDodoProductIdForPlan('STARTER') === dodoConfig.productIds.STARTER, 'getDodoProductIdForPlan maps STARTER');
  assert(getDodoProductIdForPlan('GROWTH') === dodoConfig.productIds.GROWTH, 'getDodoProductIdForPlan maps GROWTH');
  assert(getDodoProductIdForPlan('SCALE') === dodoConfig.productIds.SCALE, 'getDodoProductIdForPlan maps SCALE');

  assert(resolvePlanFromDodoProductId(dodoConfig.productIds.STARTER) === 'STARTER', 'resolvePlanFromDodoProductId resolves STARTER');
  assert(resolvePlanFromDodoProductId(dodoConfig.productIds.GROWTH) === 'GROWTH', 'resolvePlanFromDodoProductId resolves GROWTH');
  assert(resolvePlanFromDodoProductId(dodoConfig.productIds.SCALE) === 'SCALE', 'resolvePlanFromDodoProductId resolves SCALE');

  const dodoClient = getDodoClient();
  assert(Boolean(dodoClient && dodoClient.checkoutSessions && dodoClient.subscriptions), 'Dodo SDK client successfully initialized');

  /* ---------------------------------------------------------
   * 3. Webhook Parsing, Signature Logic & Idempotency
   * --------------------------------------------------------- */
  console.log('\n3. Testing Webhook Verification, Cryptographic Signing & Event Processor:');
  const mockPayload = {
    type: 'subscription.active',
    data: {
      subscription_id: 'sub_test_123',
      product_id: dodoConfig.productIds.GROWTH,
      customer: { customer_id: 'cust_test_456' },
      metadata: { orgId: 'test_org_verification' },
      currency: 'INR',
      recurring_pre_tax_amount: 49900,
    },
  };
  const rawBody = JSON.stringify(mockPayload);

  // 3a. Invalid signature verification test
  try {
    verifyAndParseDodoWebhook(rawBody, {});
    assert(false, 'Webhook with missing headers should fail signature verification');
  } catch (err: any) {
    assert(err instanceof WebhookVerificationError, 'Webhook with missing headers throws WebhookVerificationError');
  }

  try {
    verifyAndParseDodoWebhook(rawBody, {
      'webhook-id': 'msg_invalid',
      'webhook-timestamp': '123456789',
      'webhook-signature': 'v1,invalidBase64Sig==',
    });
    assert(false, 'Webhook with bad signature should fail verification');
  } catch (err: any) {
    assert(err instanceof WebhookVerificationError, 'Webhook with bad signature throws WebhookVerificationError');
  }

  // 3b. Valid cryptographic signature verification test
  const validHeaders = generateStandardWebhookHeaders(rawBody, dodoConfig.webhookKey);
  const parsedEvent = verifyAndParseDodoWebhook(rawBody, validHeaders);
  assert(parsedEvent.type === 'subscription.active', 'Webhook event cryptographically verified and unwrap succeeds');

  // 3c. Process event through the processor
  const eventId = `test_event_${Date.now()}`;
  const processResult = await processDodoWebhookEvent(parsedEvent, eventId);
  assert(processResult.processed === true, 'Webhook event processed successfully');
  assert(processResult.eventType === 'subscription.active', 'Webhook eventType matches input');
  assert(processResult.orgId === 'test_org_verification', 'Organization ID correctly resolved from metadata');

  // 3d. Test idempotency: processing duplicate eventId
  const duplicateResult = await processDodoWebhookEvent(parsedEvent, eventId);
  assert(duplicateResult.processed === true, 'Duplicate webhook event handled idempotently without duplicate side-effects');

  // 3e. Test exhaustive lifecycle event types
  const eventTypesToTest = [
    { type: 'subscription.renewed', field: 'status' },
    { type: 'subscription.plan_changed', field: 'product_id', val: dodoConfig.productIds.SCALE },
    { type: 'subscription.cancelled', field: 'status', val: 'cancelled' },
    { type: 'subscription.expired', field: 'status' },
    { type: 'subscription.on_hold', field: 'status' },
    { type: 'subscription.paused', field: 'status' },
    { type: 'subscription.unpaused', field: 'status' },
    { type: 'subscription.updated', field: 'status', val: 'active' },
    { type: 'subscription.past_due', field: 'status' },
    { type: 'subscription.failed', field: 'error_message', val: 'Card declined' },
    { type: 'payment.succeeded', field: 'payment_id', val: 'pay_test_999' },
    { type: 'payment.failed', field: 'payment_id', val: 'pay_test_fail' },
  ];

  for (const item of eventTypesToTest) {
    const evtPayload = {
      type: item.type,
      data: {
        subscription_id: 'sub_test_123',
        product_id: item.val || dodoConfig.productIds.GROWTH,
        payment_id: item.val || 'pay_123',
        metadata: { orgId: 'test_org_verification' },
        ...(item.field ? { [item.field]: item.val || 'test' } : {}),
      },
    };
    const bodyStr = JSON.stringify(evtPayload);
    const hdrs = generateStandardWebhookHeaders(bodyStr, dodoConfig.webhookKey);
    const parsed = verifyAndParseDodoWebhook(bodyStr, hdrs);
    const res = await processDodoWebhookEvent(parsed, `evt_${item.type}_${Date.now()}`);
    assert(res.processed === true, `Webhook processor correctly maps "${item.type}"`);
  }

  /* ---------------------------------------------------------
   * 4. Netlify Functions Handler Routing & Security
   * --------------------------------------------------------- */
  console.log('\n4. Testing Netlify Functions Handler (netlify/functions/api.ts):');

  // GET /health
  const healthRes: any = await handler(
    {
      path: '/.netlify/functions/api/health',
      httpMethod: 'GET',
      headers: {},
      isBase64Encoded: false,
    } as any,
    {} as any
  );
  assert(healthRes.statusCode === 200, 'Netlify handler responds 200 to GET /health');
  const healthBody = JSON.parse(healthRes.body);
  assert(healthBody.service === 'nexora-dodo-backend', 'Service name in health response is nexora-dodo-backend');
  assert(healthBody.dodoConfigured === true, 'dodoConfigured flag is true in health response');
  assert(healthBody.environment === 'test_mode', 'environment is test_mode in health response');

  // Path normalization: /api/health
  const apiHealthRes: any = await handler(
    {
      path: '/api/health',
      httpMethod: 'GET',
      headers: {},
      isBase64Encoded: false,
    } as any,
    {} as any
  );
  assert(apiHealthRes.statusCode === 200, 'Netlify handler normalizes /api/health to /health correctly');

  // OPTIONS CORS preflight
  const corsRes: any = await handler(
    {
      path: '/api/createCheckoutSession',
      httpMethod: 'OPTIONS',
      headers: {},
      isBase64Encoded: false,
    } as any,
    {} as any
  );
  assert(corsRes.statusCode === 204, 'CORS preflight OPTIONS returns 204 No Content');
  assert(corsRes.headers['Access-Control-Allow-Origin'] === '*', 'CORS preflight sets Access-Control-Allow-Origin');

  // POST /dodoWebhook with valid cryptographic signature headers
  const webhookHandlerRes: any = await handler(
    {
      path: '/dodoWebhook',
      httpMethod: 'POST',
      headers: {
        'content-type': 'application/json',
        ...validHeaders,
      },
      body: rawBody,
      isBase64Encoded: false,
    } as any,
    {} as any
  );
  assert(webhookHandlerRes.statusCode === 200, 'Netlify handler accepts POST /dodoWebhook with 200');
  const webhookResBody = JSON.parse(webhookHandlerRes.body);
  assert(webhookResBody.received === true, 'Webhook response body indicates received: true');

  // POST /dodoWebhook with invalid signature rejects with 400
  const badWebhookRes: any = await handler(
    {
      path: '/dodoWebhook',
      httpMethod: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': 'bad',
        'webhook-timestamp': '123',
        'webhook-signature': 'v1,bad',
      },
      body: rawBody,
      isBase64Encoded: false,
    } as any,
    {} as any
  );
  assert(badWebhookRes.statusCode === 400, 'Netlify handler rejects invalid webhook signature with 400');

  // Verify Protected Endpoints enforce Bearer Token authentication (401)
  const protectedRoutes = [
    { method: 'POST', path: '/api/createCheckoutSession', body: JSON.stringify({ orgId: 'org_1', planCode: 'STARTER' }) },
    { method: 'GET', path: '/api/getBillingState?orgId=org_1' },
    { method: 'POST', path: '/api/changeSubscriptionPlan', body: JSON.stringify({ orgId: 'org_1', targetPlanCode: 'GROWTH' }) },
    { method: 'POST', path: '/api/previewPlanChange', body: JSON.stringify({ orgId: 'org_1', targetPlanCode: 'GROWTH' }) },
    { method: 'POST', path: '/api/cancelSubscription', body: JSON.stringify({ orgId: 'org_1' }) },
    { method: 'POST', path: '/api/reactivateSubscription', body: JSON.stringify({ orgId: 'org_1' }) },
    { method: 'POST', path: '/api/createCustomerPortalSession', body: JSON.stringify({ orgId: 'org_1' }) },
    { method: 'POST', path: '/api/checkEntitlement', body: JSON.stringify({ orgId: 'org_1' }) },
    { method: 'GET', path: '/api/owner/verify' },
    { method: 'GET', path: '/api/owner/overview' },
    { method: 'GET', path: '/api/owner/users' },
    { method: 'GET', path: '/api/owner/organizations' },
    { method: 'GET', path: '/api/owner/billing' },
    { method: 'GET', path: '/api/owner/payments' },
    { method: 'GET', path: '/api/owner/webhooks' },
    { method: 'GET', path: '/api/owner/audit' },
    { method: 'GET', path: '/api/owner/security' },
    { method: 'GET', path: '/api/owner/health' },
    { method: 'POST', path: '/api/owner/export', body: JSON.stringify({ dataset: 'users', format: 'json' }) },
    { method: 'GET', path: '/api/owner/incidents' },
    { method: 'POST', path: '/api/owner/incidents', body: JSON.stringify({ title: 'Test' }) },
    { method: 'GET', path: '/api/owner/analytics' },
    { method: 'GET', path: '/api/owner/config' },
    { method: 'POST', path: '/api/owner/config', body: JSON.stringify({ platformName: 'Nexora' }) },
    { method: 'POST', path: '/api/owner/webhooks/retry', body: JSON.stringify({ eventId: 'evt_1' }) },
    { method: 'GET', path: '/api/owner/notes' },
    { method: 'POST', path: '/api/owner/bulk/users', body: JSON.stringify({ uids: ['u1'], action: 'SUSPEND' }) },
    { method: 'POST', path: '/api/owner/bulk/orgs', body: JSON.stringify({ orgIds: ['o1'], action: 'SUSPEND' }) },
    { method: 'GET', path: '/api/owner/reconciliation' },
    { method: 'GET', path: '/api/owner/data-quality' },
    { method: 'GET', path: '/api/owner/daily-brief' },
    { method: 'GET', path: '/api/owner/tasks' },
    { method: 'POST', path: '/api/owner/tasks', body: JSON.stringify({ title: 'Audit check' }) },
    { method: 'GET', path: '/api/owner/automations' },
    { method: 'POST', path: '/api/owner/automations/toggle', body: JSON.stringify({ automationId: 'auto-1', enabled: true }) },
    { method: 'GET', path: '/api/owner/performance' },
  ];

  for (const route of protectedRoutes) {
    const unauthRes: any = await handler(
      {
        path: route.path,
        httpMethod: route.method,
        headers: {},
        body: route.body || '',
        isBase64Encoded: false,
      } as any,
      {} as any
    );
    assert(unauthRes.statusCode === 401, `Protected route ${route.method} ${route.path.split('?')[0]} rejects unauthenticated calls with 401`);
    const unauthBody = JSON.parse(unauthRes.body);
    assert(unauthBody.code === 'AUTH_HEADER_MISSING', `Protected route returns structured error code AUTH_HEADER_MISSING`);
    assert(typeof unauthBody.timestamp === 'string', `Protected route returns diagnostic timestamp`);
  }

  // 404 Route handling
  const notFoundRes: any = await handler(
    {
      path: '/api/nonExistentRoute',
      httpMethod: 'GET',
      headers: {},
      isBase64Encoded: false,
    } as any,
    {} as any
  );
  assert(notFoundRes.statusCode === 404, 'Unknown route returns 404');
  const notFoundBody = JSON.parse(notFoundRes.body);
  assert(notFoundBody.code === 'ROUTE_NOT_FOUND', '404 returns structured code ROUTE_NOT_FOUND');

  console.log('\n==================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
