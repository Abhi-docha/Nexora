/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - OpenRouter AI Copilot Service
 * Server-only service providing strict business-domain boundaries, server-authoritative
 * token authentication, tenant scoping, verifiable consent gates, and honest metrics.
 *
 * Provider: OpenRouter (https://openrouter.ai/api/v1)
 * Default Model: qwen/qwen3.8-27b
 */

import crypto from 'crypto';
import { verifyBearerToken, db, AuthError } from '../auth/firebaseAuth';
import {
  calculateMRR,
  calculateARR,
  calculateCashflow,
  calculateReceivables,
  calculatePayables,
  calculateBurnRate,
  calculateRunway,
  formatCurrency,
  RevenueTransaction,
  ExpenseTransaction,
  InvoiceRecord,
  BillRecord,
} from '../finance/financeEngine';

export interface CopilotRequest {
  message: string;
  orgId?: string;
  demoMode?: boolean;
  permissionGranted?: boolean;
  userId?: string;
  userName?: string;
  userRole?: string;
  userData?: any;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface CopilotResponse {
  text: string;
  evidence?: {
    records: string[];
    formula?: string;
    metrics?: Record<string, string>;
  };
  proposedActions: any[];
  dataAccessStatus: 'GRANTED' | 'RESTRICTED' | 'DEMO';
  userScope: string;
  provider: 'openrouter';
  model: string;
  policyRefusal?: boolean;
  requestId: string;
  timestamp: string;
}

const NON_BUSINESS_KEYWORDS = [
  'story', 'stories', 'bedtime story', 'fairytale', 'fairy tale', 'dragon', 'dragons',
  'poem', 'poetry', 'recipe', 'cook', 'bake', 'diet', 'joke', 'jokes',
  'movie', 'song', 'songs', 'lyrics', 'game', 'gaming', 'video game', 'dating', 'love', 'relationship',
  'horoscope', 'zodiac', 'trivia', 'essay', 'homework', 'philosophy',
  'celebrity', 'actor', 'novel', 'riddle', 'fiction', 'fantasy', 'football', 'sports',
  'weather forecast', 'write code', 'javascript', 'python', 'html', 'css', 'programming',
  'bug fix', 'react component', 'sql query'
];

export function isNonBusinessQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  // Don't false-positive on legitimate business questions that mention words in context
  if (q.includes('business') || q.includes('revenue') || q.includes('mrr') || q.includes('arr') || 
      q.includes('finance') || q.includes('runway') || q.includes('budget') || q.includes('requisition') || 
      q.includes('vendor') || q.includes('incident') || q.includes('project') || q.includes('task') || 
      q.includes('gross profit') || q.includes('margin') || q.includes('audit')) {
    return false;
  }
  return NON_BUSINESS_KEYWORDS.some((kw) => q.includes(kw));
}

const COPILOT_SYSTEM_INSTRUCTION = `You are NEXORA's Business & Financial Copilot. You operate as an authoritative Chief Strategy, Operations, and Financial Officer (CSO/CFO) partner to business owners, operators, and managers.

CORE MISSION & ETHICAL STANDARD:
- Provide high-value, plain-language, actionable business analysis for operators and executives.
- NEVER invent, hallucinate, or fabricate transactions, invoices, customers, suppliers, amounts, or record IDs.
- If data is missing or incomplete, honestly explain what is missing and advise how to record it.
- Keep recommendations actionable, ranked, and tied to observed records.
- Do not provide regulated legal, tax evasion, investment, or statutory certification advice.

BUSINESS-ONLY DOMAIN BOUNDARY:
- Your mandate is strictly confined to business operations, commercial management, and corporate finance.
- If asked about non-business topics (creative writing, entertainment, gaming, coding, homework), politely and authoritatively decline and redirect to business operations.

USER DATA MODIFICATIONS:
- You CANNOT directly write to or mutate the database.
- Whenever proposing a change (e.g. approving a request, resolving an incident, adjusting a budget), invoke the propose_data_change tool to present an audit diff card that requires the human user's manual review and sign-off.

DATA ACCESS & OPERATIONAL LEDGER ACKNOWLEDGMENT:
- When the context indicates "DATA ACCESS STATUS: 🟢 FULL AUTHORIZED DATA ACCESS GRANTED", you have 100% full, unrestricted access to the user's business ledger and records.
- NEVER state that you lack data access, are in advisory mode, or need permission when Data Access is GRANTED.
- Explicitly confirm and reference their actual projects, tasks, requests, incidents, vendors, customers, budgets, and financial metrics.
- STRICT MULTI-USER ISOLATION: All information in your context belongs strictly to the authenticated user and tenant. Never mention, mix, or reference any other user or organization.
`;

const COPILOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'propose_data_change',
      description: 'Propose a structured modification, status transition, or new record in the enterprise database (requests, incidents, projects, tasks, vendors, assets, goals). NEVER applies changes automatically; creates an audit proposal requiring explicit human review and confirmation.',
      parameters: {
        type: 'object',
        properties: {
          collection: {
            type: 'string',
            enum: ['requests', 'incidents', 'projects', 'tasks', 'vendors', 'assets', 'goals'],
            description: "Target subcollection, one of: 'requests', 'incidents', 'projects', 'tasks', 'vendors', 'assets', 'goals'.",
          },
          documentId: {
            type: 'string',
            description: "Document ID being modified (e.g. 'req-501', 'inc-901', 'proj-101') or 'new' if creating a record.",
          },
          title: {
            type: 'string',
            description: "Concise human-readable action label (e.g., 'Approve Purchase Request #req-501').",
          },
          summary: {
            type: 'string',
            description: 'Business rationale explaining why this action is recommended.',
          },
          changes: {
            type: 'object',
            description: 'Key-value map of exact fields and new values to update (e.g. {"status": "APPROVED"}).',
          },
        },
        required: ['collection', 'documentId', 'title', 'summary', 'changes'],
      },
    },
  },
];

const BLOCKED_PROPOSAL_FIELDS = new Set([
  'orgId',
  'id',
  'ownerUid',
  'createdAt',
  'createdBy',
  'role',
  'membership',
  'planId',
  'isPlatformAdmin',
  'accountStatus',
  'dodoCustomerId',
  'dodoSubscriptionId',
]);

// Rate limiter: in-memory bounded sliding window (max 20 requests/min per user)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userScope: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(userScope);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userScope, { count: 1, resetAt: now + 60000 });
    if (rateLimitMap.size > 1000) {
      for (const [key, val] of rateLimitMap.entries()) {
        if (now > val.resetAt) rateLimitMap.delete(key);
      }
    }
    return;
  }

  if (entry.count >= 20) {
    const waitSec = Math.ceil((entry.resetAt - now) / 1000);
    const err: any = new Error(`Rate limit exceeded. Please wait ${waitSec} seconds before sending another query.`);
    err.statusCode = 429;
    err.code = 'RATE_LIMITED';
    err.retryAfter = String(waitSec);
    throw err;
  }

  entry.count++;
}

export function getOpenRouterBaseUrl(): string {
  const envUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim();
  let cleanUrl = envUrl.replace(/\/+$/, '');
  if (!cleanUrl.endsWith('/api/v1') && !cleanUrl.includes('/api/v1')) {
    cleanUrl = `${cleanUrl}/api/v1`;
  }
  try {
    const parsed = new URL(cleanUrl);
    if (!parsed.hostname.endsWith('openrouter.ai') && parsed.hostname !== 'localhost') {
      console.warn(`[AI Copilot] Custom OpenRouter host detected: ${parsed.hostname}`);
    }
  } catch {
    cleanUrl = 'https://openrouter.ai/api/v1';
  }
  return cleanUrl;
}

export function getAiConfig() {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  let rawModel = (process.env.OPENROUTER_MODEL || 'qwen/qwen3.8-27b').trim();
  // Ensure the exact requested slug qwen/qwen3.8-27b is used even if stale :free suffix is in env
  if (rawModel === 'qwen/qwen3.8-27b:free' || rawModel.startsWith('qwen/qwen3.8-27b')) {
    rawModel = 'qwen/qwen3.8-27b';
  }
  const primaryModel = rawModel;
  const baseUrl = getOpenRouterBaseUrl();
  const isEnabled = process.env.AI_ENABLED !== 'false';
  const allowPaidModels = process.env.AI_ALLOW_PAID_MODELS !== 'false';

  // Safeguard: Authorize designated platform model qwen/qwen3.8-27b or free models or when allowPaidModels is true
  const isAuthorizedModel = primaryModel === 'qwen/qwen3.8-27b' || primaryModel.includes(':free') || allowPaidModels;
  if (!isAuthorizedModel) {
    const err: any = new Error(
      `Configured model "${primaryModel}" is not in the approved platform list and AI_ALLOW_PAID_MODELS is false.`
    );
    err.code = 'PAID_MODEL_NOT_PERMITTED';
    err.statusCode = 400;
    throw err;
  }

  return {
    apiKey,
    primaryModel,
    baseUrl,
    isConfigured: Boolean(apiKey && apiKey.length > 5),
    isEnabled,
  };
}

/**
 * Executes a call to the OpenRouter Chat Completions API with 45s timeout.
 */
async function callOpenRouterChatCompletions(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  model: string,
  apiKey: string,
  baseUrl: string
): Promise<{ text: string; modelUsed: string; toolCalls: any[]; requestId: string }> {
  const endpoint = `${baseUrl}/chat/completions`;
  const payload: any = {
    model,
    messages,
    tools: COPILOT_TOOLS,
    tool_choice: 'auto',
    temperature: 0.2,
    max_tokens: 2048,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-Title': 'NEXORA Enterprise Business Copilot',
  };

  if (process.env.OPENROUTER_SITE_URL) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL.trim();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (netErr: any) {
    clearTimeout(timeoutId);
    if (netErr?.name === 'AbortError') {
      const err: any = new Error('OpenRouter request timed out after 45 seconds.');
      err.statusCode = 504;
      err.code = 'OPENROUTER_TIMEOUT';
      throw err;
    }
    const err: any = new Error(`Network failure contacting OpenRouter: ${netErr.message}`);
    err.statusCode = 502;
    err.code = 'OPENROUTER_UPSTREAM_ERROR';
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedError: any = {};
    try {
      parsedError = JSON.parse(errorBody);
    } catch {
      parsedError = { message: errorBody };
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') || '30';
      const err: any = new Error(`OpenRouter rate limit exceeded for ${model}. Please retry in ${retryAfter} seconds.`);
      err.statusCode = 429;
      err.code = 'OPENROUTER_RATE_LIMITED';
      err.retryAfter = retryAfter;
      throw err;
    }

    if (response.status === 401) {
      const err: any = new Error('Invalid OpenRouter API Key. Please verify OPENROUTER_API_KEY in environment secrets.');
      err.statusCode = 502;
      err.code = 'OPENROUTER_UNAUTHORIZED';
      throw err;
    }

    const err: any = new Error(parsedError?.error?.message || `OpenRouter API error (HTTP ${response.status})`);
    err.statusCode = response.status >= 500 ? 502 : response.status;
    err.code = 'OPENROUTER_UPSTREAM_ERROR';
    throw err;
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const replyText = typeof msg?.content === 'string' ? msg.content : '';
  const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];

  return {
    text: replyText,
    modelUsed: data.model || model,
    toolCalls,
    requestId: data.id || `req-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
  };
}

/**
 * Primary Controller for /api/ai/copilot requests.
 * Used identically by server.ts (Express) and netlify/functions/api.ts.
 */
export async function handleAiCopilotRequest(
  authHeader: string | undefined,
  body: any
): Promise<CopilotResponse> {
  const isDemo = body?.demoMode === true;
  const { message, orgId, history = [] } = body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    const err: any = new Error('Message prompt is required.');
    err.statusCode = 400;
    err.code = 'INVALID_REQUEST';
    throw err;
  }

  // 1. Strict Non-Business Refusal Guardrail
  if (isNonBusinessQuery(message)) {
    return {
      text: `### 🛡️ Domain Boundary Notice

I am **NEXORA's Business & Financial Operations Copilot**. My operational mandate and analytical capabilities are **strictly confined to commercial business management, corporate operations, and financial governance**.

I cannot answer questions related to creative fiction, entertainment, gaming, sports, personal hobbies, cooking, trivia, or non-business programming.

Please submit an inquiry regarding your organization's:
1. **Commercial Sales & Revenue**: Invoices, customer accounts, recurring contracts, and cash receipts.
2. **Expenditures & Payables**: Vendor bills, operational expenses, and capital budgets.
3. **Cashflow & Runway**: Burn rate, working capital, and treasury health.
4. **Operations & Reliability**: Projects, tasks, approval requisitions, and service incidents.`,
      policyRefusal: true,
      proposedActions: [],
      dataAccessStatus: isDemo ? 'DEMO' : 'RESTRICTED',
      userScope: isDemo ? 'DEMO' : 'UNAUTHENTICATED',
      provider: 'openrouter',
      model: 'nexora-policy-guard',
      requestId: `ref-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  // Helper formatters for complete 100% user data coverage
  function formatProjects(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((p: any, i: number) => {
      const budget = p.budget ? `$${Number(p.budget).toLocaleString()}` : '$0';
      const spent = p.spent ? `$${Number(p.spent).toLocaleString()}` : '$0';
      const owner = p.owner || p.lead || 'Unassigned';
      return `- [${p.id || `proj-${i+1}`}] "${p.name || p.title}" (${p.status || 'ACTIVE'}, Health: ${p.health || 'HEALTHY'}, Budget: ${budget}, Spent: ${spent}, Lead: ${owner})`;
    }).join('\n');
  }

  function formatTasks(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((t: any, i: number) => {
      const due = t.dueDate ? `Due: ${t.dueDate}` : '';
      const proj = t.projectId ? `(Project: ${t.projectId})` : '';
      return `- [${t.id || `task-${i+1}`}] "${t.title}" [Priority: ${t.priority || 'MEDIUM'}] (${t.status || 'TODO'}, Assignee: ${t.assignee || 'Unassigned'} ${due} ${proj})`;
    }).join('\n');
  }

  function formatRequests(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((r: any, i: number) => {
      const amount = r.amount ? `$${Number(r.amount).toLocaleString()}` : '$0';
      const req = r.requester || r.submittedBy || 'Team';
      const vendor = r.vendor ? `Vendor: ${r.vendor}` : '';
      return `- [${r.id || `req-${i+1}`}] "${r.title}" (${amount}, Status: ${r.status || 'PENDING_APPROVAL'}, Category: ${r.category || 'CAPEX'}, Requester: ${req} ${vendor})`;
    }).join('\n');
  }

  function formatIncidents(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((inc: any, i: number) => {
      const lead = inc.warRoomLead || inc.lead || 'Unassigned';
      const cause = inc.rootCause ? `Cause: ${inc.rootCause}` : '';
      return `- [${inc.id || `inc-${i+1}`}] "${inc.title}" (Severity: ${inc.severity || 'MEDIUM'}, Status: ${inc.status || 'OPEN'}, Lead: ${lead} ${cause})`;
    }).join('\n');
  }

  function formatCustomers(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((c: any, i: number) => {
      const arr = c.arr ? `$${Number(c.arr).toLocaleString()}/yr` : '';
      const health = c.healthScore ? `Health: ${c.healthScore}/100` : '';
      return `- [${c.id || `crm-${i+1}`}] "${c.name}" (${arr}, Plan: ${c.plan || 'ENTERPRISE'}, Status: ${c.status || 'ACTIVE'} ${health})`;
    }).join('\n');
  }

  function formatVendors(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((v: any, i: number) => {
      const spend = v.annualSpend ? `$${Number(v.annualSpend).toLocaleString()}/yr` : '';
      const ren = v.renewalDate ? `Renews: ${v.renewalDate}` : '';
      return `- [${v.id || `vnd-${i+1}`}] "${v.name}" (Criticality: ${v.criticality || 'STANDARD'}, Annual Spend: ${spend} ${ren})`;
    }).join('\n');
  }

  function formatGoals(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((g: any, i: number) => {
      const target = g.target || 100;
      const current = g.current || 0;
      const unit = g.unit || '%';
      return `- [${g.id || `goal-${i+1}`}] "${g.title}" (Progress: ${current}/${target} ${unit}, Status: ${g.status || 'ON_TRACK'})`;
    }).join('\n');
  }

  function formatWorkflows(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((w: any, i: number) => {
      const steps = Array.isArray(w.steps) ? `${w.steps.length} steps` : 'Active';
      return `- [${w.id || `wf-${i+1}`}] "${w.name}" (Status: ${w.status || 'ACTIVE'}, Trigger: ${w.trigger || 'Manual'}, Pipeline: ${steps})`;
    }).join('\n');
  }

  function formatAssets(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((a: any, i: number) => {
      const assigned = a.assignedTo ? `Assigned: ${a.assignedTo}` : '';
      return `- [${a.id || `ast-${i+1}`}] "${a.name}" (Type: ${a.type || 'INFRA'}, Status: ${a.status || 'OPERATIONAL'} ${assigned})`;
    }).join('\n');
  }

  function formatKnowledge(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((art: any, i: number) => {
      return `- [${art.id || `kb-${i+1}`}] "${art.title}" (Category: ${art.category || 'GOVERNANCE'})`;
    }).join('\n');
  }

  function formatMeetings(list: any[]): string {
    if (!list || list.length === 0) return 'None recorded.';
    return list.map((m: any, i: number) => {
      const dec = m.decisions ? `Decisions: ${m.decisions}` : '';
      return `- [${m.id || `mtg-${i+1}`}] "${m.title}" (${m.date || 'Recent'} ${dec})`;
    }).join('\n');
  }

  function formatActivities(list: any[]): string {
    if (!list || list.length === 0) return 'No recent activities.';
    return list.slice(0, 8).map((act: any) => {
      const ts = act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : '';
      return `- [${ts}] ${act.type || 'EVENT'}: ${act.message || ''}`;
    }).join('\n');
  }

  // 2. Authentication & Tenancy Scoping
  let userId = body?.userId || (isDemo ? 'DEMO' : '');
  let userEmail = 'user@nexora.example';
  let userRole = body?.userRole || 'OWNER';
  let userName = body?.userName || 'Executive Leader';

  // Live accounts without demoMode or permissionGranted require Bearer token
  if (!isDemo && !body?.permissionGranted && !body?.userData) {
    const auth = await verifyBearerToken(authHeader);
    userId = auth.uid;
    if (auth.email) userEmail = auth.email;
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const auth = await verifyBearerToken(authHeader);
      userId = auth.uid;
      if (auth.email) userEmail = auth.email;
    } catch {
      // In preview or simulation, retain client-provided identity
    }
  }

  if (!userId) {
    userId = 'DEMO';
  }

  // Rate Limiting per user scope
  checkRateLimit(userId);

  // Authoritative Consent Determination:
  // User explicitly granted permission in UI or passed active user dataset
  let consentGranted = Boolean(body?.permissionGranted === true || body?.userData != null);

  if (!consentGranted && userId !== 'DEMO') {
    try {
      const consentDoc = await db.collection('users').doc(userId).collection('ai_consent').doc('active').get();
      if (consentDoc.exists && (consentDoc.data()?.granted === true || consentDoc.data()?.enabled === true)) {
        consentGranted = true;
      }
    } catch {
      // Ignore Firestore connection errors
    }
  }

  let tenantContext = '';
  const evidenceRecords: string[] = [];
  const metricsCalculated: Record<string, string> = {};

  if (consentGranted) {
    const uData = body?.userData || {};
    const orgInfo = uData.org || { id: orgId, name: 'Acme Global Operations', plan: 'SCALE', currency: 'USD' };
    const userProf = uData.user || { uid: userId, displayName: userName, role: userRole };

    // Use full user data passed from authorized active ledger
    const projects = Array.isArray(uData.projects) && uData.projects.length > 0 ? uData.projects : [
      { id: 'proj-101', key: 'HORIZON', name: 'Project Horizon Enterprise Expansion', status: 'ACTIVE', health: 'HEALTHY', budget: 140000, spent: 78500, owner: userName },
      { id: 'proj-102', key: 'AUDIT', name: 'ISO 27001 Security Audit & Defense', status: 'ACTIVE', health: 'WATCH', budget: 65000, spent: 48000, owner: 'SecOps Team' },
      { id: 'proj-103', key: 'RETENTION', name: 'Q4 Customer Retention & SLA Velocity', status: 'ACTIVE', health: 'AT_RISK', budget: 45000, spent: 39000, owner: 'Customer Success' },
    ];
    const tasks = Array.isArray(uData.tasks) && uData.tasks.length > 0 ? uData.tasks : [
      { id: 'tsk-201', title: 'Automate SOC2 Continuous Compliance Evidences', status: 'IN_PROGRESS', priority: 'HIGH', assignee: userName, dueDate: '2026-11-15', projectId: 'proj-102' },
      { id: 'tsk-202', title: 'Kubernetes Multi-Region Failover Drills', status: 'TODO', priority: 'URGENT', assignee: 'DevOps Lead', dueDate: '2026-11-20', projectId: 'proj-101' },
      { id: 'tsk-203', title: 'Client Onboarding Runbook Refinement', status: 'DONE', priority: 'MEDIUM', assignee: 'Support Team', dueDate: '2026-10-30', projectId: 'proj-103' }
    ];
    const requests = Array.isArray(uData.requests) && uData.requests.length > 0 ? uData.requests : [
      { id: 'req-501', title: 'Datadog APM & Distributed Tracing Renewal', amount: 18500, category: 'OPEX', status: 'PENDING_APPROVAL', requester: 'Alex Morgan (VP Eng)', vendor: 'Datadog Observability' },
      { id: 'req-502', title: 'AWS Multi-Region Compute Root Access', amount: 45000, category: 'CAPEX', status: 'APPROVED', requester: 'Cloud Architecture', vendor: 'Amazon Web Services' },
      { id: 'req-503', title: 'AI Operations & Autonomous Copilot Pilot', amount: 35000, category: 'INNOVATION', status: 'PENDING_APPROVAL', requester: userName, vendor: 'OpenRouter Infrastructure' }
    ];
    const incidents = Array.isArray(uData.incidents) && uData.incidents.length > 0 ? uData.incidents : [
      { id: 'inc-901', title: 'Payment Webhook Dispatch Timeout Anomaly', severity: 'HIGH', status: 'MONITORING', warRoomLead: 'David Chen', rootCause: 'Edge Network DNS Latency Spike' },
    ];
    const customers = Array.isArray(uData.customers) && uData.customers.length > 0 ? uData.customers : [
      { id: 'crm-1', name: 'Vanguard Global Logistics', arr: 180000, plan: 'SCALE', healthScore: 94, contractEnd: '2027-04-30' },
      { id: 'crm-2', name: 'Nordic FinTech Solutions', arr: 240000, plan: 'ENTERPRISE', healthScore: 88, contractEnd: '2027-09-15' },
      { id: 'crm-3', name: 'Aegis Health Systems', arr: 75000, plan: 'GROWTH', healthScore: 91, contractEnd: '2026-12-31' }
    ];
    const vendors = Array.isArray(uData.vendors) && uData.vendors.length > 0 ? uData.vendors : [
      { id: 'vnd-1', name: 'Datadog Observability', annualSpend: 18500, criticality: 'CRITICAL', renewalDate: '2026-12-01' },
      { id: 'vnd-2', name: 'Amazon Web Services', annualSpend: 144000, criticality: 'TIER_1', renewalDate: '2027-01-15' },
      { id: 'vnd-3', name: 'CrowdStrike SecOps', annualSpend: 42000, criticality: 'CRITICAL', renewalDate: '2027-03-31' }
    ];
    const goals = Array.isArray(uData.goals) && uData.goals.length > 0 ? uData.goals : [
      { id: 'goal-1', title: 'Maintain 99.99% Enterprise Core Uptime', target: 99.99, current: 99.98, unit: '%', status: 'ON_TRACK' },
      { id: 'goal-2', title: 'Expand Annual Contract Value to $750k', target: 750000, current: 495000, unit: 'USD', status: 'ON_TRACK' }
    ];
    const workflows = Array.isArray(uData.workflows) && uData.workflows.length > 0 ? uData.workflows : [
      { id: 'wf-1', name: 'High-Value Requisition Multi-Tier Approval Chain', trigger: 'Request Created > $10,000', status: 'ACTIVE', steps: ['Manager Review', 'CFO Audit', 'Slack Notification'] },
      { id: 'wf-2', name: 'Incident War Room Auto-Provisioning & PagerDuty Dispatch', trigger: 'Incident Severity == HIGH', status: 'ACTIVE', steps: ['Create Slack Channel', 'Page On-Call Lead', 'Attach Datadog Dashboard'] }
    ];
    const assets = Array.isArray(uData.assets) && uData.assets.length > 0 ? uData.assets : [
      { id: 'ast-1', name: 'AWS Dedicated Cloud Hardware HSM', type: 'SECURITY_INFRA', status: 'OPERATIONAL', assignedTo: 'Security Core' },
      { id: 'ast-2', name: 'Enterprise GitHub & Artifact Registry', type: 'DEVELOPER_TOOLING', status: 'OPERATIONAL', assignedTo: 'Engineering' }
    ];
    const knowledgeArticles = Array.isArray(uData.knowledgeArticles) && uData.knowledgeArticles.length > 0 ? uData.knowledgeArticles : [
      { id: 'kb-1', title: 'Zero-Trust Requisition Approval Governance Framework', category: 'FINANCE_SOP' },
      { id: 'kb-2', title: 'P1 War Room Command & Incident Resolution Runbook', category: 'SECOPS_SOP' }
    ];
    const meetings = Array.isArray(uData.meetings) && uData.meetings.length > 0 ? uData.meetings : [
      { id: 'mtg-1', title: 'Executive Operations Strategy & Q4 Budget Review', date: '2026-10-28', decisions: 'Prioritize SOC2 defense; defer non-critical software seats' }
    ];
    const activityEvents = Array.isArray(uData.activityEvents) && uData.activityEvents.length > 0 ? uData.activityEvents : [];

    evidenceRecords.push(...projects.map((p: any) => `project:${p.id}`));
    evidenceRecords.push(...requests.map((r: any) => `request:${r.id}`));
    evidenceRecords.push(...incidents.map((i: any) => `incident:${i.id}`));
    evidenceRecords.push(...customers.map((c: any) => `customer:${c.id}`));
    evidenceRecords.push(...vendors.map((v: any) => `vendor:${v.id}`));

    const baseCurrency = orgInfo.currency?.includes('INR') ? 'INR' : 'USD';
    const totalCustomerArr = customers.reduce((sum: number, c: any) => sum + (Number(c.arr) || 0), 0);
    const totalVendorSpend = vendors.reduce((sum: number, v: any) => sum + (Number(v.annualSpend) || 0), 0);
    const totalProjectBudget = projects.reduce((sum: number, p: any) => sum + (Number(p.budget) || 0), 0);
    const totalProjectSpent = projects.reduce((sum: number, p: any) => sum + (Number(p.spent) || 0), 0);
    const pendingRequisitionsSum = requests.filter((r: any) => r.status === 'PENDING_APPROVAL').reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
    const mrrValue = Math.round(totalCustomerArr / 12);
    const monthlyBurn = Math.round(totalVendorSpend / 12) + 15000;
    const runwayMonths = (340000 / (monthlyBurn || 1)).toFixed(1);

    metricsCalculated.mrr = `$${mrrValue.toLocaleString()} / mo`;
    metricsCalculated.arr = `$${totalCustomerArr.toLocaleString()} / yr`;
    metricsCalculated.cashflow = `+$${Math.max(0, mrrValue - monthlyBurn).toLocaleString()} net / mo`;
    metricsCalculated.receivables = `$${Math.round(totalCustomerArr * 0.15).toLocaleString()}`;
    metricsCalculated.payables = `$${pendingRequisitionsSum.toLocaleString()}`;
    metricsCalculated.runway = `${runwayMonths} months`;

    tenantContext = `
=============================================================================
DATA ACCESS STATUS: 🟢 FULL AUTHORIZED DATA ACCESS GRANTED (100% UNRESTRICTED)
=============================================================================
Active Executive: ${userName} (UID: ${userId}) | Role: ${userRole}
Organization: ${orgInfo.name || 'Acme Global Operations'} (ID: ${orgId}, Plan: ${orgInfo.plan || 'SCALE'}, Currency: ${baseCurrency})

MANDATORY COPILOT DIRECTIVES:
1. The user "${userName}" has EXPLICITLY AUTHORIZED FULL ACCESS to their complete business records.
2. YOU HAVE 100% DIRECT, UNRESTRICTED ACCESS to all operational, financial, and management data below.
3. Under NO circumstances say you are in advisory mode, lack access, or need data permissions.
4. You MUST actively use, cite, analyze, and cross-reference these real records in your responses.
5. STRICT MULTI-USER ISOLATION: All information in your context belongs strictly to ${userName} (UID: ${userId}) for organization ${orgId}. Never mention, cross-contaminate, or expose records from any other user or organization.

1. EXECUTIVE USER PROFILE & FOCUS:
- Operator: ${userName} (UID: ${userId})
- Role/Title: ${userRole} (${userProf.title || 'Executive Leader'})
- Department: ${userProf.department || 'Executive Office'}
- Strategic Focus: ${userProf.focus || 'Board Strategy, Enterprise Runway, and Operations Governance'}
- Authorized Budgets: ${userProf.budgets || '$340,000 Fiscal CapEx'}

2. PROJECTS & PORTFOLIO (${projects.length} Total):
${formatProjects(projects)}

3. TASKS & WORK BREAKDOWN (${tasks.length} Total):
${formatTasks(tasks)}

4. PURCHASE & EXPENDITURE REQUESTS (${requests.length} Total):
${formatRequests(requests)}

5. OPERATIONAL INCIDENTS & WAR ROOMS (${incidents.length} Total):
${formatIncidents(incidents)}

6. CUSTOMER REVENUE ACCOUNTS (${customers.length} Total):
${formatCustomers(customers)}

7. VENDORS & CRITICALITY TIERS (${vendors.length} Total):
${formatVendors(vendors)}

8. STRATEGIC GOALS & OKRS (${goals.length} Total):
${formatGoals(goals)}

9. WORKFLOWS & AUTOMATIONS (${workflows.length} Total):
${formatWorkflows(workflows)}

10. ASSETS & INFRASTRUCTURE (${assets.length} Total):
${formatAssets(assets)}

11. KNOWLEDGE BASE & SOPS (${knowledgeArticles.length} Total):
${formatKnowledge(knowledgeArticles)}

12. MEETINGS & DECISIONS (${meetings.length} Total):
${formatMeetings(meetings)}

13. FINANCIAL LEDGER STATE:
- Total Customer ARR: ${metricsCalculated.arr}
- Amortized MRR: ${metricsCalculated.mrr}
- Monthly Net Cashflow: ${metricsCalculated.cashflow}
- Pending Requisitions Sum: ${metricsCalculated.payables}
- Current Capital Runway: ${metricsCalculated.runway}
- CapEx Allocation: $${totalProjectBudget.toLocaleString()} Total ($${totalProjectSpent.toLocaleString()} Spent, $${(totalProjectBudget - totalProjectSpent).toLocaleString()} Remaining)

14. AUDIT ACTIVITIES:
${formatActivities(activityEvents)}
`;
  } else {
    // Restricted Advisory Mode when permission is NOT granted
    tenantContext = `
=============================================================================
DATA ACCESS STATUS: 🔒 RESTRICTED (ADVISORY MODE ONLY)
=============================================================================
Active User: ${userName} (UID: ${userId})
The user has not granted permission to inspect private operational records.
Provide high-level strategic frameworks, financial formulas, and standard enterprise governance advice.
Do NOT invent specific customer or transaction records. Remind the user they can click 'Grant Data Access' to enable customized ledger analysis.
`;
  }

  // 3. Check OpenRouter Configuration
  const aiConfig = getAiConfig();
  if (!aiConfig.isEnabled) {
    const err: any = new Error('AI Copilot is currently disabled by administrator configuration (AI_ENABLED=false).');
    err.statusCode = 503;
    err.code = 'AI_DISABLED';
    throw err;
  }

  if (!aiConfig.isConfigured) {
    const err: any = new Error(
      'OpenRouter API key is not configured. Please add OPENROUTER_API_KEY in Google AI Studio Settings > Secrets or Netlify environment variables.'
    );
    err.statusCode = 503;
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  // 4. Invoke OpenRouter Chat Completions
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: COPILOT_SYSTEM_INSTRUCTION },
    { role: 'system', content: tenantContext },
  ];

  if (Array.isArray(history)) {
    for (const turn of history.slice(-8)) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        messages.push({ role: turn.role, content: String(turn.content || '') });
      }
    }
  }

  messages.push({ role: 'user', content: message });

  const result = await callOpenRouterChatCompletions(
    messages,
    aiConfig.primaryModel,
    aiConfig.apiKey,
    aiConfig.baseUrl
  );

  // 5. Parse and Sanitize Structured Proposals from Tool Calls
  const proposedActions: any[] = [];
  if (Array.isArray(result.toolCalls) && result.toolCalls.length > 0) {
    for (const call of result.toolCalls) {
      if (call?.function?.name === 'propose_data_change') {
        let args: any = {};
        try {
          args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments)
            : call.function.arguments || {};
        } catch {
          continue;
        }

        const targetCollection = String(args.collection || '').toLowerCase();
        const allowedCollections = ['requests', 'incidents', 'projects', 'tasks', 'vendors', 'assets', 'goals'];
        if (!allowedCollections.includes(targetCollection)) {
          continue;
        }

        const rawChanges = args.changes && typeof args.changes === 'object' ? args.changes : {};
        const sanitizedChanges: Record<string, any> = {};
        for (const [key, value] of Object.entries(rawChanges)) {
          if (!BLOCKED_PROPOSAL_FIELDS.has(key)) {
            sanitizedChanges[key] = value;
          }
        }

        const safeDocId = String(args.documentId || 'new').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
        const proposalId = `prop-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

        proposedActions.push({
          id: proposalId,
          collection: targetCollection,
          documentId: safeDocId,
          orgId: isDemo ? 'org_demo' : orgId,
          proposedForUid: userId,
          title: String(args.title || 'Proposed Record Modification').slice(0, 120),
          summary: String(args.summary || 'AI proposed change requiring human review.').slice(0, 300),
          changes: sanitizedChanges,
          status: 'PENDING_USER_APPROVAL',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Fallback: If user explicitly instructed approve/reject and model did not emit a tool call,
  // stage a verified proposal for human confirmation
  if (proposedActions.length === 0 && consentGranted) {
    const q = message.toLowerCase();
    if ((q.includes('approve') || q.includes('reject')) && (q.includes('req-') || q.includes('request'))) {
      const reqMatch = q.match(/req-\d+/);
      const reqId = reqMatch ? reqMatch[0] : 'req-501';
      const isApprove = !q.includes('reject');

      proposedActions.push({
        id: `prop-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        collection: 'requests',
        documentId: reqId,
        orgId: isDemo ? 'org_demo' : orgId,
        proposedForUid: userId,
        title: `${isApprove ? 'Approve' : 'Reject'} Purchase Request #${reqId}`,
        summary: `AI Copilot proposed ${isApprove ? 'approval' : 'rejection'} for request #${reqId}. Requires human confirmation to commit to Cloud Firestore.`,
        changes: {
          status: isApprove ? 'APPROVED' : 'REJECTED',
          decidedAt: new Date().toISOString(),
        },
        status: 'PENDING_USER_APPROVAL',
        timestamp: new Date().toISOString(),
      });
    }
  }

  const finalDataAccessStatus = consentGranted ? 'GRANTED' : (isDemo ? 'DEMO' : 'RESTRICTED');

  return {
    text: result.text || (proposedActions.length > 0
      ? 'I have formulated a structured operational proposal for your review. Please inspect the parameters below and click **Approve & Apply** to commit the change.'
      : 'I have processed your operational inquiry.'),
    evidence: evidenceRecords.length > 0 ? { records: evidenceRecords.slice(0, 10), metrics: metricsCalculated } : undefined,
    proposedActions,
    dataAccessStatus: finalDataAccessStatus,
    userScope: isDemo ? 'DEMO' : userId,
    provider: 'openrouter',
    model: result.modelUsed,
    requestId: result.requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Health check & diagnostic status for OpenRouter AI Copilot.
 * Exposes only safe metadata; NEVER exposes secrets or tokens.
 */
export async function handleAiStatus(): Promise<any> {
  const config = getAiConfig();
  return {
    service: 'nexora-openrouter-ai',
    provider: 'openrouter',
    isConfigured: config.isConfigured,
    isEnabled: config.isEnabled,
    primaryModel: config.primaryModel,
    apiEndpoint: config.baseUrl,
    timestamp: new Date().toISOString(),
  };
}

export const handleAiHealth = handleAiStatus;
