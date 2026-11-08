# NEXORA Enterprise Operations Cloud - Repository & Architectural Inventory

## 1. Executive Summary & Architecture Overview

NEXORA Enterprise Operations Cloud is an enterprise multi-tenant operations platform built on a zero-trust architecture. It combines real-time operational commanding, project management, financial intelligence, visual workflow automation, and AI business copilot capabilities with cryptographic security, Cloud Firestore persistence, and Dodo Payments subscription billing.

### High-Level Architectural Stack
- **Client Frontend Architecture:**
  - High-performance modular single-page shell (`index.html`) serving as the primary Vite entry point.
  - Tailwind CSS 4 engine loaded dynamically via CDN script with bespoke enterprise typography, dark/light themes, and high-DPI canvas integration.
  - Lucide icons (`lucide.min.js`) with dynamic lifecycle rendering.
  - Chart.js 4.4.1 for multi-dimensional financial and fleet data visualization with memory leak prevention (`chart.destroy()` guards).
  - Firebase Client SDK v10.14.1 (ESM modules for `firebase-app`, `firebase-auth`, and `firebase-firestore`).
- **Server & Backend Runtimes:**
  - `server.ts`: Full-stack Node.js Express server running on port 3000 in development, mounting Vite dev middlewares and proxying API routes.
  - `netlify/functions/api.ts`: Production serverless AWS Lambda / Netlify Functions handler handling all `/api/*` and `/dodoWebhook` endpoints.
  - `functions/src/index.ts`: Modular backend microservices library exporting auth, billing, finance, entitlement, and platform governance engines.
- **Database & Identity:**
  - Database: Google Cloud Firestore in multi-tenant mode (`ai-studio-3b092059-520b-4f77-ac8f-80dfcc7fc88d`), hosted under GCP project `nexora-enterprise`.
  - Authentication: Firebase Authentication with Google OAuth Provider and Bearer ID Token verification.
  - Security Rules: Zero-trust `firestore.rules` enforcing strict RBAC (`OWNER`, `ORG_ADMIN`, `MANAGER`, `PROJECT_MANAGER`, `TEAM_LEAD`, `MEMBER`, `VIEWER`), tenant partition isolation (`/organizations/{orgId}`), and platform governance safeguards.
- **Commerce & Billing Engine:**
  - Dodo Payments SDK integration with HMAC SHA256 Standard Webhook verification, event deduplication, and automated proration and entitlement provisioning.
- **AI Copilot & Business Intelligence:**
  - OpenRouter API integration running `qwen/qwen3.8-27b`.
  - Explicit user consent gate (`nexora_ai_data_consent_{uid}`), complete tenant-scoped multi-user isolation, and business policy guards refusing non-work inquiries.

---

## 2. Comprehensive File Inventory

| Path | Size (Bytes) | Lines | Purpose & Function |
| :--- | :--- | :--- | :--- |
| `index.html` | ~540 KB | ~8,980 | Monolithic client application shell, routing, DOM views, reactive state stores, AI copilot drawer, and modal dialogs. |
| `server.ts` | ~34.5 KB | 853 | Local Express development and full-stack runtime server on port 3000 with Vite middleware, `/dodoWebhook` raw body handler, and `/api/*` routes. |
| `netlify/functions/api.ts` | ~28.7 KB | 969 | Serverless Netlify Functions API handler providing complete route parity for billing, owner governance, AI copilot, and webhooks. |
| `functions/src/index.ts` | ~6.9 KB | 201 | Central export entry point for backend billing router, Dodo webhook processor, and entitlement engine. |
| `functions/src/auth/firebaseAuth.ts` | ~5.8 KB | 170 | Server-side Bearer ID token verification, Firebase Admin SDK initialization, and fallback token verification. |
| `functions/src/billing/checkout.ts` | ~4.2 KB | 134 | Authoritative checkout session creation via Dodo Payments API with currency resolution and customer metadata binding. |
| `functions/src/billing/billingState.ts` | ~5.1 KB | 158 | Authoritative subscription retrieval, billing portal link generation, and plan status computation. |
| `functions/src/billing/subscriptions.ts` | ~8.4 KB | 260 | Subscription lifecycle mutations: plan upgrades, downgrades, proration previews, cancellations, and reactivations. |
| `functions/src/billing/portal.ts` | ~2.5 KB | 76 | Customer billing portal session generator via Dodo Payments API. |
| `functions/src/billing/webhook.ts` | ~18.5 KB | 610 | Standard Webhooks HMAC SHA256 cryptographic verification, deduplication/idempotency store, and tenant plan upgrade handler. |
| `functions/src/config/dodo.ts` | ~4.8 KB | 152 | Dodo Payments configuration manager, secret credential validator, and product catalog resolver. |
| `functions/src/config/plans.ts` | ~5.8 KB | 185 | Canonical plan catalog definitions (`FREE`, `STARTER`, `GROWTH`, `SCALE`) with pricing in INR, limits, and feature flags. |
| `functions/src/entitlements/entitlementEngine.ts` | ~6.2 KB | 195 | Tier-based permission and limit enforcement engine preventing tenant over-consumption. |
| `functions/src/finance/financeEngine.ts` | ~8.5 KB | 275 | GAAP-conscious financial intelligence engine calculating MRR, ARR, cashflow, net burn, and runway with zero mocked figures. |
| `functions/src/ai/copilotService.ts` | ~8.9 KB | 280 | Server-side AI Copilot service managing OpenRouter `qwen/qwen3.8-27b` requests, prompt scoping, and policy guard interception. |
| `functions/src/owner/ownerService.ts` | ~67.8 KB | 2,167 | Platform Owner Command Center backend service providing executive overview, user 360, tenant fleet, and audit trail services. |
| `functions/src/types.ts` | ~3.8 KB | 120 | Shared TypeScript interface and type declarations for backend services. |
| `firestore.rules` | ~18.2 KB | 430 | Zero-trust Cloud Firestore security rules with platform admin bypass, org tenancy verification, and RBAC helpers. |
| `firebase-blueprint.json` | ~3.4 KB | 110 | Canonical database schema and security rules mapping for Cloud Firestore provisioning. |
| `scripts/test-verification.ts` | ~25.6 KB | 531 | Automated verification test suite executing 195 assertions against auth, billing, webhooks, finance, and AI copilot. |
| `package.json` | ~2.1 KB | 58 | Package dependencies, build scripts (`build`, `dev`, `lint`), and environment configuration. |
| `vite.config.ts` | ~1.1 KB | 38 | Vite build and preview configuration with Tailwind plugins and asset bundling rules. |
| `metadata.json` | ~1.2 KB | 40 | AI Studio application metadata, required permissions, and capabilities. |

---

## 3. Technology & Dependency Roster

### Runtime Dependencies
- `express` (v4.21.2) - High-throughput HTTP routing engine.
- `cors` (v2.8.5) - Cross-Origin Resource Sharing middleware.
- `dotenv` (v16.4.7) - Environment variable management.
- `dodopayments` (v2.8.0) - Official Dodo Payments Node.js SDK.
- `firebase` (v10.14.1) - Client SDK for Authentication and Firestore.
- `firebase-admin` (v12.7.0) - Server-side privileged authentication and database client.
- `standardwebhooks` (v1.0.0) - Cryptographic HMAC signature verification for webhooks.

### Build & Tooling
- `typescript` (v5.6.3) - Strict static type checker.
- `vite` (v6.0.7) - High-performance frontend bundler.
- `tsx` (v4.19.2) - Native TypeScript execution engine for server and test scripts.
- `@types/node`, `@types/express`, `@types/cors` - Ambient TypeScript definitions.
