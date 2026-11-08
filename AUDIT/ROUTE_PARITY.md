# NEXORA Enterprise Operations Cloud - Route Parity Matrix

## 1. Runtime Parity Overview

NEXORA operates across three distinct backend runtimes:
1. **Local Full-Stack Express (`server.ts`):** Port 3000 development server hosting Vite middlewares and API routes.
2. **Serverless Lambda (`netlify/functions/api.ts`):** Production serverless Netlify Functions environment.
3. **Microservices Entry Point (`functions/src/index.ts`):** Modular Cloud Functions and shared router definitions.

The table below catalogs every endpoint, verifying strict parity across all three environments.

---

## 2. Comprehensive Route Parity Matrix

| Route Path | HTTP Method | Auth Required | Minimum Role | Request Parameters / Body | Response Schema | `server.ts` | `netlify/functions/api.ts` | `functions/src/index.ts` | Parity Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/dodoWebhook` | `POST` | Signature | None (Webhook Key) | Raw HMAC bytes, Svix/Standard headers | `{ received: true, eventId, type, orgId }` | Yes | Yes | Yes | **FULL PARITY** |
| `/dodoWebhook` | `GET` | None | None | None | 405 Method Not Allowed | Yes | Yes | Yes | **FULL PARITY** |
| `/api/health` | `GET` | None | Public | None | `{ service, version, runtime, dodoConfigured, environment }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/createCheckoutSession` | `POST` | Bearer Token | `ORG_ADMIN` / `OWNER` | `{ planId, returnUrl? }` | `{ checkoutUrl, sessionId }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/getBillingState` | `GET` | Bearer Token | `MEMBER`+ | `query: orgId` | `{ planCode, status, billingPortalUrl?, renewalDate }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/changeSubscriptionPlan`| `POST` | Bearer Token | `ORG_ADMIN` / `OWNER` | `{ orgId, targetPlanCode }` | `{ success, planCode, effectiveDate }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/previewPlanChange` | `POST` | Bearer Token | `ORG_ADMIN` / `OWNER` | `{ orgId, targetPlanCode }` | `{ amountDue, prorationCredit, targetPriceInr }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/cancelSubscription` | `POST` | Bearer Token | `OWNER` | `{ orgId, immediately? }` | `{ message, canceledAt, effectiveEnd }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/reactivateSubscription`| `POST` | Bearer Token | `OWNER` | `{ orgId }` | `{ message, reactivated: true }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/createCustomerPortalSession`| `POST` | Bearer Token | `ORG_ADMIN` / `OWNER` | `{ orgId }` | `{ portalUrl }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/checkEntitlement` | `POST` | Bearer Token | `MEMBER`+ | `{ orgId, feature?, limitKey?, delta? }` | `{ allowed: boolean, reason?, usage? }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/ai/status` | `GET` | None | Public | None | `{ service, provider, primaryModel, configured }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/ai/health` | `GET` | None | Public | None | `{ ok: true, timestamp, model: 'qwen/qwen3.8-27b' }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/ai/copilot` | `POST` | Bearer Token | `MEMBER`+ | `{ prompt, history?, contextData?, userConsent }` | `{ reply, proposal?, tokenUsage? }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/status` | `GET` | Bearer Token | Platform Owner | None | `{ isPlatformOwner: boolean, email, uid }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/overview` | `GET` | Bearer Token | Platform Owner | None | `{ metrics: { fleet, revenue, incidents, webhooks } }`| Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/users` | `GET` | Bearer Token | Platform Owner | None | `{ users: Array<UserProfile> }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/users/action` | `POST` | Bearer Token | Platform Owner | `{ targetUid, action, payload }` | `{ success: true, targetUid, accountStatus }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/organizations` | `GET` | Bearer Token | Platform Owner | None | `{ organizations: Array<TenantOrg> }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/organizations/action`| `POST`| Bearer Token | Platform Owner | `{ orgId, action, payload }` | `{ success: true, orgId, status }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/billing` | `GET` | Bearer Token | Platform Owner | None | `{ activeSubscriptions, mrrInr, dodoConfigured }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/webhooks` | `GET` | Bearer Token | Platform Owner | None | `{ events: Array<WebhookLog>, stats }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/webhooks/retry` | `POST` | Bearer Token | Platform Owner | `{ eventId }` | `{ success: true, reprocessed: true }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/incidents` | `GET` | Bearer Token | Platform Owner | None | `{ incidents: Array<PlatformIncident> }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/incidents` | `POST` | Bearer Token | Platform Owner | `{ title, severity, affectedService, notes }` | `{ success: true, incidentId }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/export` | `POST` | Bearer Token | Platform Owner | `{ dataset, format }` | `{ rowCount, content?, data? }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/audit` | `GET` | Bearer Token | Platform Owner | None | `{ logs: Array<AuditLogEntry> }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/security` | `GET` | Bearer Token | Platform Owner | None | `{ zeroTrustRules, adminUid, ownerEmail, posture }`| Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/config` | `GET` | Bearer Token | Platform Owner | None | `{ general, credentials, secretsSummary }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/config` | `POST` | Bearer Token | Platform Owner | `{ platformName?, supportEmail?, maintenanceMode? }`| `{ success: true, updatedConfig }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/analytics` | `GET` | Bearer Token | Platform Owner | None | `{ revenueIntelligence, usageIntelligence }` | Yes | Yes | Yes | **FULL PARITY** |
| `/api/owner/data-quality` | `GET` | Bearer Token | Platform Owner | None | `{ orphanedRecords, missingAssignments, score }` | Yes | Yes | Yes | **FULL PARITY** |

---

## 3. Parity Guarantees

1. **Normalized Route Matching:**
   Both `server.ts` and `netlify/functions/api.ts` implement identical route normalization logic (stripping `/.netlify/functions/api`, stripping trailing slashes, stripping query strings).
2. **Uniform Error Structure:**
   Every error returned across both runtimes includes `{ error: string, code: string, timestamp: string }` with standardized HTTP status codes (401 for unauthorized, 403 for forbidden, 405 for wrong method, 400 for malformed input, 502 for upstream payment errors).
3. **Identical Cryptographic Webhook Handling:**
   Both runtimes preserve raw webhook request body bytes to ensure HMAC SHA256 signatures match bit-for-bit without parser interference.
