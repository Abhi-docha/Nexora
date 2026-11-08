# NEXORA — Enterprise Operations Cloud

NEXORA is a production-minded, multi-tenant enterprise operations platform built for mission-critical SaaS operations. It unifies project portfolio management, visual multi-step workflow design, universal request & approval routing, strategic OKRs, CRM account management, vendor criticality registries, asset registers, operational incident war rooms, institutional knowledge base SOPs, decision logs, and business intelligence analytics into a coherent cloud operating system.

---

## 1. Architecture & Security Invariants

- **Multi-Tenant Isolation**: Every enterprise document belongs to an organization tenant (`/organizations/{orgId}/...`). Authoritative access is strictly governed by `firestore.rules`.
- **Zero-Trust Role-Based Access Control (RBAC)**: Supports 9 granular role tiers:
  - `OWNER`: Full administrative, billing, and tenancy ownership.
  - `ORG_ADMIN`: Organization and member lifecycle management.
  - `MANAGER`: Departmental approvals, KPI, and vendor governance.
  - `PROJECT_MANAGER`: Initiative and task assignment execution.
  - `TEAM_LEAD`: Work item coordination and sprint progression.
  - `ANALYST`: BI report generation and metric modeling.
  - `MEMBER`: General work item and task execution.
  - `VIEWER`: Read-only access across enabled tenant modules.
  - `GUEST`: Scoped external reviewer access.
- **Cryptographic Token Invitations**: Membership invitations generate 192-bit cryptographically random tokens (`window.crypto.getRandomValues`) enforced by security rules rather than sequential predictable IDs.
- **No Client Credentials or Cloud Storage Dependencies**: Operates with Zero-Trust principles without exposing service account private keys or requiring Cloud Functions / Firebase Cloud Storage in the frontend.

---

## 2. Concise Firebase Setup Instructions

1. **Create Firebase Project**:
   - Go to the [Firebase Console](https://console.firebase.google.com/).
   - Click **Add project** and name it (e.g. `nexora-enterprise-cloud`).

2. **Enable Firebase Authentication**:
   - In the Firebase Console, navigate to **Build** &rarr; **Authentication**.
   - Under the **Sign-in method** tab, enable the **Google** provider.
   - Configure your project support email and authorized domain.

3. **Provision Cloud Firestore Database**:
   - Navigate to **Build** &rarr; **Firestore Database**.
   - Click **Create database** and select your preferred regional location (e.g. `nam5` or `asia-southeast1`).
   - Start in **Production mode** (rules will be deployed in the next step).

4. **Configure Web Application Credentials**:
   - In Project Settings &rarr; General, register a **Web app**.
   - Open `index.html` and replace the placeholder `firebaseConfig` object at the top of the `<script type="module">` block:
     ```javascript
     export const firebaseConfig = {
       apiKey: "AIzaSy...",
       authDomain: "your-project.firebaseapp.com",
       projectId: "your-project-id",
       storageBucket: "<DO_NOT_USE_FIREBASE_STORAGE>",
       messagingSenderId: "1234567890",
       appId: "1:1234567890:web:abcdef..."
     };
     ```

---

## 3. Security Deployment Instructions

1. **Install Firebase CLI**:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore
   ```

2. **Configure Platform Super Admin UID**:
   - Sign in with your Google account on the web application.
   - Look up your Firebase Authentication UID in the Firebase Authentication console.
   - Open `firestore.rules` and replace `REPLACE_WITH_REAL_PLATFORM_ADMIN_UID` with your actual UID.
   - Also update `PLATFORM_ADMIN_UID` in `index.html`.

3. **Deploy Authoritative Rules & Indexes**:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

---

## 4. Security Testing Checklist

- [x] **Unauthenticated Deny**: Anonymous or signed-out requests cannot read or write organization tenant records.
- [x] **Cross-Tenant Guard**: User in Tenant A cannot read, query, or mutate documents in Tenant B under `/organizations/{orgId}/...`.
- [x] **Role Privilege Escalation Prevention**: Standard members cannot alter their own `role` or grant themselves `ORG_ADMIN` or `OWNER` privileges.
- [x] **Immutable Identity Fields**: Updating business documents strictly forbids changing `orgId`, `id`, `createdBy`, or `createdAt`.
- [x] **Terminal State Locking**: Resolved incidents and approved requests cannot be casually manipulated by unauthorized users.
- [x] **Super Admin Gate**: Platform control plane collections (`/platform/...`) can only be accessed by the allowlisted Platform Admin UID.
- [x] **Append-Only Activity Log**: Activity events in `/organizations/{orgId}/activityEvents/{eventId}` are strictly append-only (updates and deletions are denied).

---

## 5. Explanation of Features Intentionally Requiring a Future Backend

NEXORA's core frontend runs entirely via Firebase Authentication and Cloud Firestore without server functions. The following enterprise capabilities are designed with clean adapter boundaries and intentionally require a future backend server:

1. **Dodo Payments Integration (`DodoPaymentsBackend`)**:
   - *Architecture*: Production Firebase Cloud Functions 2nd Generation and Express backend (`/dodoWebhook` and `/api/*`).
   - *Security & Verification*: Secret API key (`DODO_PAYMENTS_API_KEY`) and webhook signature secret (`DODO_PAYMENTS_WEBHOOK_KEY`) stored strictly server-side. Webhooks are authenticated via Standard Webhooks HMAC-SHA256 signatures with Firestore idempotency registers.
   - *Subscription Tiers*: STARTER (₹199/mo), GROWTH (₹499/mo), and SCALE (₹1,999/mo) backed by real Dodo hosted checkout sessions, proration engine, and customer billing portal.
   - *Entitlements*: Authoritative server-side feature flagging and volumetric limit enforcement (seats, projects, workflows). Users are forbidden from changing their own tier in Firestore.

2. **Server-Side Workflow Worker (`WorkflowExecutionAdapter`)**:
   - *Why Backend Required*: Cron schedules, multi-day delays (`WAIT 48h`), external API polling, and unprompted background workers require a durable daemon or Cloud Run container.
   - *Current Implementation*: Visual interactive workflow designer, node parameter inspector, client-side step simulation, and status lifecycle state transitions.

3. **External SMTP / Transactional Email Adapter (`EmailAdapter`)**:
   - *Why Backend Required*: Sending transactional emails directly from browser code exposes mail server credentials or causes spam-block reputation penalties.
   - *Current Implementation*: Cryptographically secure token link generation with one-click clipboard copying.

4. **Hard Auth Administration Adapter (`AuthAdministrationAdapter`)**:
   - *Why Backend Required*: The Firebase Web Client SDK cannot disable, purge, or forcefully revoke OAuth refresh tokens of another user. This requires Firebase Admin SDK on a secure server.
   - *Current Implementation*: Application-level account suspension (`accountStatus: 'SUSPENDED'`) enforced by Firestore security rules.

---

## 6. OpenRouter AI Operations Copilot Integration

NEXORA features a server-authoritative, zero-leakage AI Operations Copilot powered by **OpenRouter** (`https://openrouter.ai/api/v1`) using the designated model **`qwen/qwen3.8-27b`**.

### Architecture & Security Invariants
- **Zero API Key Leakage**: `OPENROUTER_API_KEY` is loaded exclusively inside server environments (`server.ts` in dev preview, `netlify/functions/api.ts` in Netlify production). The client browser never receives or possesses the API key.
- **Strict Business & Financial Domain Boundary**: The copilot strictly intercepts and refuses non-business inquiries (fiction, gaming, entertainment, cooking, sports, non-business code).
- **Zero Hallucination / No Mock Fallback**: If `OPENROUTER_API_KEY` is missing or the upstream provider fails, the copilot returns a truthful status code (`503 AI_NOT_CONFIGURED`, `429 OPENROUTER_RATE_LIMITED`, `502 OPENROUTER_UNAUTHORIZED`), never canned numbers.
- **Mutual Exclusivity (Demo vs Live)**:
  - **Demo Mode (`demoMode: true`)**: Uses fixed synthetic fixtures labeled `[SYNTHETIC DEMO DATA]`. Never queries or exposes real customer records.
  - **Live Account Mode (`demoMode: false`)**: Verifies Firebase ID Token cryptographically, verifies tenant membership in `/organizations/{orgId}/members/{uid}`, verifies explicit user consent in `/users/{uid}/ai_consent/active`, and computes metrics using the integer-cent GAAP finance engine.
- **Explicit Human Confirmation for Database Mutations**: The copilot cannot directly mutate Firestore. It outputs structured `propose_data_change` actions that render review cards in the UI requiring the user's manual sign-off.
- **Model Slug**: `qwen/qwen3.8-27b` (exact OpenRouter slug).

### Environment Configuration Variables
```env
# OpenRouter AI Copilot
OPENROUTER_API_KEY="sk-or-v1-..."
OPENROUTER_MODEL="qwen/qwen3.8-27b"
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
AI_ENABLED="true"
AI_ALLOW_PAID_MODELS="true"
```

### Manual Verification Script (cURL)
```bash
# 1. Check AI Health Status (No auth required)
curl -s http://localhost:3000/api/ai/status | jq .

# 2. Test Policy Guard Refusal (Demo Mode)
curl -s -X POST http://localhost:3000/api/ai/copilot \
  -H "Content-Type: application/json" \
  -d '{"message": "tell me a bedtime story about dragons", "demoMode": true}' | jq .

# 3. Test Synthetic Demo Inquiry (Requires OPENROUTER_API_KEY)
curl -s -X POST http://localhost:3000/api/ai/copilot \
  -H "Content-Type: application/json" \
  -d '{"message": "Analyze our budget and cash burn runway", "demoMode": true}' | jq .
```
