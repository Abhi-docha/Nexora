# NEXORA Enterprise Operations Cloud - Feature & Control Inventory

## 1. Feature & UI Control Catalog

This document registers every end-user and administrator-facing UI control, navigation route, modal dialog, action button, and data mutation in NEXORA. Every control is cataloged with its verification status, data binding, and permission requirement.

| Module / View | Control / Button / Action | Target Endpoint or Store | Required Role | State Mutation / Action | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Global Shell** | Google Sign-In | `signInWithPopup(Google)` | Unauthenticated | Authenticates user via Firebase Auth, registers `/users/{uid}`, syncs organization | REAL / VERIFIED |
| **Global Shell** | Sign Out | `signOut()` | Authenticated | Clears privileged state, terminates session, reverts to landing page | REAL / VERIFIED |
| **Global Shell** | Command Palette (`Cmd+K`) | `openCommandPalette()` | All users | Opens modal quick-jump palette for workspace & owner commands | REAL / VERIFIED |
| **Global Shell** | Date Range Filter | `setDateRange(range)` | All users | Re-filters metrics across 7D, 30D, 90D, 12M | REAL / VERIFIED |
| **Global Shell** | Org Switcher | `openOrgSwitcherModal()` | All users | Switches active tenant organization context | REAL / VERIFIED |
| **AI Copilot** | Toggle Drawer (`Cmd+J`) | `toggleAiCopilot()` | All users | Slides out conversational AI side drawer | REAL / VERIFIED |
| **AI Copilot** | Consent Toggle Switch | `setAiDataPermission(bool)` | Current User | Updates `localStorage` and writes `/users/{uid}/ai_consent/active` | REAL / VERIFIED |
| **AI Copilot** | Send Prompt | `sendAiCopilotMessage()` | Current User | Sends prompt with scoped tenant data payload to `qwen/qwen3.8-27b` | REAL / VERIFIED |
| **AI Copilot** | Clear History | `clearUserCopilotHistory()` | Current User | Purges user-specific isolated chat history in localStorage | REAL / VERIFIED |
| **AI Copilot** | Persona Switcher | `switchSimulatedUser(key)` | Demo Mode Only | Switches simulated user; blocked with warning in Live Mode | HARDENED |
| **AI Copilot** | Approve Proposal | `approveAndApplyProposal()` | `MANAGER`+ | Commits AI-proposed field mutations directly to Firestore record | REAL / VERIFIED |
| **AI Copilot** | Decline Proposal | `declineProposal()` | All users | Rejects proposal and prevents any mutation | REAL / VERIFIED |
| **Command Center**| Quick Create Modal | `openQuickCreateModal()` | `MEMBER`+ | Rapid creation of project, task, request, or incident | REAL / VERIFIED |
| **Command Center**| Platform Diagnostics | `openAuditSuiteModal()` | All users | Opens 10-layer forensic audit modal | REAL / VERIFIED |
| **Diagnostics** | Run Deep Audit | `runDeepAudit()` | All users | Executes 10 live probes, displays true PASS/WARN/FAIL metrics | REAL / VERIFIED |
| **Diagnostics** | Copy Audit JSON | `exportAuditReport()` | All users | Copies actual probe execution results as JSON to clipboard | REAL / VERIFIED |
| **Projects** | Create Project Modal | `saveNewProject()` | `PROJECT_MANAGER`+ | Inserts new project into `/organizations/{orgId}/projects` | REAL / VERIFIED |
| **Projects** | Project Details Modal | `viewProjectDetails(id)` | All users | Inspects milestones, linked tasks, budget burn | REAL / VERIFIED |
| **Tasks & Kanban** | Create Task Modal | `saveNewTask()` | `MEMBER`+ | Inserts new task into `/organizations/{orgId}/tasks` | REAL / VERIFIED |
| **Tasks & Kanban** | Advance Task Status | `advanceTaskStatus(id)` | `MEMBER`+ | Advances `TODO` -> `IN_PROGRESS` -> `REVIEW` -> `DONE` | REAL / VERIFIED |
| **Workflow Studio**| Save Draft | `saveWorkflowDraft()` | `MANAGER`+ | Persists workflow graph nodes and updates status to `DRAFT` | REAL / VERIFIED |
| **Workflow Studio**| Publish Flow | `publishWorkflow()` | `ORG_ADMIN`+ | Updates status to `PUBLISHED`, increments version, announces runner status | REAL / VERIFIED |
| **Workflow Studio**| Add Step (+Trigger) | `addWorkflowNode('TRIGGER')` | `MANAGER`+ | Appends new reactive trigger node to canvas graph | REAL / VERIFIED |
| **Workflow Studio**| Add Step (+Approval)| `addWorkflowNode('APPROVAL')`| `MANAGER`+ | Appends new approval node to canvas graph | REAL / VERIFIED |
| **Workflow Studio**| Add Step (+Gate) | `addWorkflowNode('CONDITION')`| `MANAGER`+ | Appends new condition branching gate to canvas graph | REAL / VERIFIED |
| **Workflow Studio**| Add Step (+Action) | `addWorkflowNode('ACTION')` | `MANAGER`+ | Appends new automated dispatch action to canvas graph | REAL / VERIFIED |
| **Workflow Studio**| Remove Step Node | `removeWorkflowNode(id)` | `MANAGER`+ | Removes node from graph array and triggers reactive re-render | REAL / VERIFIED |
| **Requests** | Submit Requisition | `saveNewRequest()` | `MEMBER`+ | Inserts new request into `/organizations/{orgId}/requests` | REAL / VERIFIED |
| **Requests** | Approve / Reject | `decideRequest(id, dec)` | `MANAGER`+ | Updates request status to `APPROVED` or `REJECTED` | REAL / VERIFIED |
| **Goals & OKRs** | Create Goal | `saveNewGoal()` | `MANAGER`+ | Inserts strategic objective into `/organizations/{orgId}/goals` | REAL / VERIFIED |
| **Incidents** | Declare Incident | `saveNewIncident()` | `MEMBER`+ | Inserts incident and triggers war room response pipeline | REAL / VERIFIED |
| **Incidents** | Resolve Incident | `resolveIncident(id)` | `PROJECT_MANAGER`+ | Marks incident `RESOLVED` with timestamp | REAL / VERIFIED |
| **CRM & Accounts** | Create Customer | `saveNewCustomer()` | `MEMBER`+ | Inserts customer account into `/organizations/{orgId}/customers` | REAL / VERIFIED |
| **Vendors** | Register Contract | `saveNewVendor()` | `MANAGER`+ | Inserts vendor contract into `/organizations/{orgId}/vendors` | REAL / VERIFIED |
| **Knowledge Base** | Publish SOP | `saveNewArticle()` | `MEMBER`+ | Inserts documentation article into `/organizations/{orgId}/knowledgeArticles`| REAL / VERIFIED |
| **Meetings** | Schedule Briefing | `saveNewMeeting()` | `MEMBER`+ | Inserts calendar briefing into `/organizations/{orgId}/meetings` | REAL / VERIFIED |
| **Members & RBAC** | Manage Role | `updateMemberRole()` | `ORG_ADMIN` | Authoritative RBAC role mutation in `/organizations/{orgId}/members` | REAL / VERIFIED |
| **Billing & Usage**| Initiate Checkout | `initiateCheckout(plan)` | `OWNER` / `ORG_ADMIN`| Calls `/api/createCheckoutSession` for real Dodo checkout session | REAL / VERIFIED |
| **Billing & Usage**| Change Plan | `executePlanChange()` | `OWNER` / `ORG_ADMIN`| Calls `/api/changeSubscriptionPlan` with proration preview | REAL / VERIFIED |
| **Billing & Usage**| Cancel Subscription| `executeCancellation()` | `OWNER` / `ORG_ADMIN`| Calls `/api/cancelSubscription` via Dodo Payments API | REAL / VERIFIED |
| **Billing & Usage**| Reactivate Sub | `reactivateSubscription()` | `OWNER` / `ORG_ADMIN`| Calls `/api/reactivateSubscription` | REAL / VERIFIED |
| **Billing & Usage**| Customer Portal | `openCustomerPortal()` | `OWNER` / `ORG_ADMIN`| Calls `/api/createCustomerPortalSession` to open Dodo Portal | REAL / VERIFIED |
| **Billing & Usage**| Sync Billing | `refreshBillingState()` | `OWNER` / `ORG_ADMIN`| Fetches `/api/getBillingState` and synchronizes entitlements | REAL / VERIFIED |
| **Owner Center** | Export Dataset | `executeOwnerExport(ds, fmt)`| Platform Owner | Calls `/api/owner/export` for sanitized CSV / JSON platform data | REAL / VERIFIED |
| **Owner Center** | Retry Webhook | `retryOwnerWebhook(id)` | Platform Owner | Calls `/api/owner/webhooks/retry` to reprocess past webhook | REAL / VERIFIED |
| **Owner Center** | User Mutation | `executeOwnerUserAction()` | Platform Owner | Calls `/api/owner/users/action` to suspend/activate user | REAL / VERIFIED |
| **Owner Center** | Org Mutation | `executeOwnerOrgAction()` | Platform Owner | Calls `/api/owner/organizations/action` to freeze/manage tenant | REAL / VERIFIED |

---

## 2. Elimination of Fake / Showpiece Controls

1. **Eliminated Simulated User Impersonation in Live Mode:**
   - Pre-repair behavior: In live mode, clicking simulated user buttons replaced `this.currentUser` with in-memory mock identities, allowing accidental or simulated identity spoofing.
   - Remediation: Restricted `switchSimulatedUser` exclusively to Demo Mode. In live mode, invoking this method displays an immediate security warning toast and rejects the action.
2. **Eliminated Hardcoded 10/10 PASS Diagnostics:**
   - Pre-repair behavior: `runDeepAudit()` caught network errors and logged them as PASS, and hardcoded `ALL 10 VERIFICATION AUDIT CHECKS PASSED (100% HEALTHY)` regardless of reality.
   - Remediation: Rewritten to execute genuine probes measuring live HTTP status codes, network latency, sanitization effectiveness, storage throughput, and frame rate. Results calculate true `passCount`, `warnCount`, and `failCount`, with honest badges and exportable JSON.
3. **Eliminated Static Workflow Canvas:**
   - Pre-repair behavior: Clicking `+ Form Trigger` or `+ Approval Step` only displayed a toast notification without altering the canvas; publishing reported "Deployed to active execution engine".
   - Remediation: Wired canvas to `getActiveWorkflow()` node state. Nodes can be appended and deleted dynamically. Publishing updates the version and displays the truthful status: `Definition Published (Background engine pending worker deployment)`.
4. **Eliminated Swallowed Firestore Errors & False Success Toasts:**
   - Pre-repair behavior: `saveToFirestore` and `updateInFirestore` logged errors to console without re-throwing, causing callers to show false "Success" toasts when Firestore security rules rejected writes.
   - Remediation: Configured methods to re-throw exceptions, ensuring callers detect rejections, suppress false success notifications, and surface authoritative error feedback to users.
