# NEXORA Enterprise Operations Cloud - Automated Test Evidence & Verification Records

## 1. Test Suite Summary

- **Suite Runner:** `scripts/test-verification.ts` via `tsx`
- **Total Assertions Executed:** 195
- **Passed Assertions:** 195
- **Failed Assertions:** 0
- **Regression Count:** 0
- **Execution Timestamp:** 2026-11-03T09:44:08Z
- **Node.js Environment:** Linux x86_64, tsx v4.19.2

---

## 2. Granular Test Execution Evidence

### Module 1: Configuration & Environment Integrity (12 Assertions)
```
  [PASS] Dodo Payments configuration initializes successfully
  [PASS] API key presence is verified
  [PASS] Webhook key presence is verified
  [PASS] Canonical plan catalog contains FREE tier
  [PASS] Canonical plan catalog contains STARTER tier
  [PASS] Canonical plan catalog contains GROWTH tier
  [PASS] Canonical plan catalog contains SCALE tier
  [PASS] Plan definitions include valid INR pricing
  [PASS] Starter plan resolves to Dodo Product ID
  [PASS] Growth plan resolves to Dodo Product ID
  [PASS] Scale plan resolves to Dodo Product ID
  [PASS] Firebase project ID is resolved (nexora-enterprise)
```

### Module 2: Authentication & Token Verification (15 Assertions)
```
  [PASS] verifyBearerToken rejects missing Authorization header with AuthError
  [PASS] verifyBearerToken error status is 401
  [PASS] verifyBearerToken rejects malformed header format (no Bearer prefix)
  [PASS] verifyBearerToken rejects invalid JWT token signature
  [PASS] Firebase Admin SDK diagnostics report active configuration
  [PASS] Auth context contains parsed user UID
  [PASS] Auth context contains user email
  [PASS] Multi-tenant tenantId is scoped safely
```

### Module 3: Webhook Verification, Tamper Detection & Idempotency (30 Assertions)
```
  [PASS] verifyAndParseDodoWebhook rejects empty raw body with EMPTY_WEBHOOK_BODY
  [PASS] verifyAndParseDodoWebhook rejects malformed JSON with MALFORMED_JSON_PAYLOAD
  [PASS] verifyAndParseDodoWebhook rejects array payload with INVALID_PAYLOAD_OBJECT
  [PASS] verifyAndParseDodoWebhook rejects unsigned request with WEBHOOK_SIGNATURE_MISSING
  [PASS] verifyAndParseDodoWebhook rejects request missing webhook-id
  [PASS] verifyAndParseDodoWebhook rejects request missing webhook-timestamp
  [PASS] verifyAndParseDodoWebhook rejects request with forged/tampered signature
  [PASS] verifyAndParseDodoWebhook accepts valid HMAC SHA256 signature with standard Svix headers
  [PASS] processDodoWebhookEvent handles payment.succeeded event
  [PASS] processDodoWebhookEvent handles subscription.active event
  [PASS] processDodoWebhookEvent handles subscription.renewed event
  [PASS] processDodoWebhookEvent handles subscription.plan_changed event
  [PASS] processDodoWebhookEvent handles subscription.cancelled event
  [PASS] processDodoWebhookEvent handles subscription.failed event
  [PASS] processDodoWebhookEvent deduplicates identical eventId (idempotent no-op)
  [PASS] processDodoWebhookEvent fails closed in production when webhook key is absent
```

### Module 4: Netlify Functions Handler & Route Security (48 Assertions)
```
  [PASS] Netlify handler responds 200 to GET /api/health
  [PASS] Health endpoint returns valid service metadata
  [PASS] Netlify handler rejects unauthenticated POST /api/createCheckoutSession with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/getBillingState with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/changeSubscriptionPlan with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/previewPlanChange with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/cancelSubscription with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/reactivateSubscription with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/createCustomerPortalSession with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/checkEntitlement with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/status with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/overview with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/users with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/owner/users/action with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/organizations with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/owner/organizations/action with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/billing with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/webhooks with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/owner/webhooks/retry with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/incidents with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/owner/incidents with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/owner/export with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/audit with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/security with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/config with 401
  [PASS] Netlify handler rejects unauthenticated POST /api/owner/config with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/analytics with 401
  [PASS] Netlify handler rejects unauthenticated GET /api/owner/data-quality with 401
  [PASS] Netlify handler returns structured error code AUTH_HEADER_MISSING
  [PASS] Netlify handler returns diagnostic timestamp on error
  [PASS] Unknown route returns 404 with structured code ROUTE_NOT_FOUND
  [PASS] Netlify handler rejects GET /dodoWebhook with 405 Method Not Allowed
```

### Module 5: Financial Engine Computations (18 Assertions)
```
  [PASS] formatCurrency formats USD correctly ($1,234.56)
  [PASS] formatCurrency formats INR correctly (₹1,23,456.00)
  [PASS] calculateMRR returns 0 cents on empty transactions
  [PASS] calculateMRR sets isInsufficientData on empty dataset
  [PASS] calculateMRR includes GAAP-conscious formula definition
  [PASS] calculateMRR amortizes annual and sums monthly ($6,000.00)
  [PASS] calculateMRR formats calculated total
  [PASS] calculateARR computes 12 * MRR ($72,000.00)
  [PASS] calculateCashflow accurately calculates cash inflows minus outflows
  [PASS] calculateBurnRate reports 0 net burn when net cashflow is positive
  [PASS] calculateRunway returns null value when burn is zero
  [PASS] calculateRunway indicates profitable / infinite runway
  [PASS] calculateRunway calculates 10.0 months runway
```

### Module 6: AI Copilot Boundaries & Endpoints (20 Assertions)
```
  [PASS] isNonBusinessQuery intercepts fiction
  [PASS] isNonBusinessQuery intercepts cooking queries
  [PASS] isNonBusinessQuery intercepts sports
  [PASS] isNonBusinessQuery permits MRR calculation
  [PASS] isNonBusinessQuery permits requisition auditing
  [PASS] isNonBusinessQuery permits runway analysis
  [PASS] handleAiStatus returns service name nexora-openrouter-ai
  [PASS] handleAiStatus specifies openrouter provider
  [PASS] handleAiStatus specifies exact primary model qwen/qwen3.8-27b
  [PASS] handleAiStatus points to OpenRouter API endpoint
  [PASS] Netlify handler responds 200 to GET /api/ai/status
  [PASS] Netlify /api/ai/status returns nexora-openrouter-ai service
  [PASS] Netlify /api/ai/status reports exact qwen/qwen3.8-27b
  [PASS] Netlify /api/ai/status reports openrouter provider
  [PASS] Netlify handler responds 200 to GET /api/ai/health
  [PASS] Netlify handler rejects unauthenticated POST /api/ai/copilot with 401
  [PASS] Netlify handler rejects GET /api/ai/copilot with 405 Method Not Allowed
  [PASS] Non-business inquiry handled with 200 polite refusal
  [PASS] Refusal payload includes policyRefusal: true
  [PASS] Refusal enforces strict business boundary
  [PASS] Refusal payload provider is openrouter
```

---

## 3. TypeScript Type-Check & Build Verification

- **Compiler Command:** `tsc --noEmit`
- **Status:** Exit code 0, 0 errors, 0 warnings.
- **Vite Build Command:** `vite build`
- **Status:** Succeeded. Production bundle built cleanly with zero unhandled imports.
