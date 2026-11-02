# Nexora Enterprise Business & Financial AI Copilot

Implement an enterprise-grade Business and Financial AI Copilot in Nexora using `@google/genai` (powered by `gemini-3.8-flash`). The assistant is strictly bounded to business, financial analytics, operations, requests, workflows, and incidents, and is architected to propose mutations to user data that execute only after explicit user review and approval.

---

> [!IMPORTANT]
> **Key Architecture Decisions for User Review**
> - **Strict Domain Boundary**: The assistant strictly deflects non-business and non-financial inquiries (such as casual chit-chat, creative writing, or personal trivia) and redirects the user to relevant organization metrics (cash flow, active requests, incident resolution, and operational throughput).
> - **Explicit User Permission for Data Mutations**: When the AI suggests modifying records (e.g., approving/updating a procurement request, triaging an incident, or updating organization settings), it presents an **Interactive Action Card** with a visual before/after diff. The data is only written to Firestore once the user explicitly clicks **"Approve & Commit"**.
> - **Dual Access Placement**: The Copilot is accessible both as a **Global Slide-over Drawer** from the top header / floating dock (usable across all screens) and as a dedicated **AI Copilot** workspace view in the sidebar.

---

## 1. Overview & Core Concept

- **What It Does**: Provides an intelligent, context-aware operations copilot embedded in Nexora. It can analyze revenue and invoice summaries, review open procurement requests, summarize active incidents, track OKRs, and propose database updates with one-click user authorization.
- **Target Audience / Persona**: Organization owners, CFOs/finance controllers, operations directors, and department leads managing enterprise workflows.
- **Key Value**: Accelerates executive decision-making and operational triage without risking unauthorized data mutations or ungrounded responses.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Launch**: User clicks the "AI Copilot" button in the top navigation bar (or floating assistant trigger at bottom-right), opening a slide-over panel.
2. **Contextual Ingestion**: The Copilot automatically attaches the current organization's active context (total revenue, pending requests count, high-severity incidents, active members) into the session context.
3. **Business Q&A**: User asks questions such as *"What is our current monthly burn rate vs revenue?"*, *"Summarize all high-priority pending requests"*, or *"How many open P1 incidents do we have?"*. The AI responds with structured, concise financial analysis.
4. **Guardrail Deflection**: If a user submits an off-topic question (e.g., *"Write a poem about dogs"*), the AI politely declines: *"I am Nexora's Business & Financial Copilot. I can only assist with enterprise operations, financial ledger analysis, requests, and organizational management. Would you like a breakdown of your current expenses instead?"*
5. **Data Modification with Approval**:
   - User asks: *"Approve request req-501 and update priority to high"*.
   - AI generates an **Action Proposal Card** inside the chat thread displaying:
     - Target collection and record ID (e.g., `requests/req-501`)
     - Proposed Field Changes: `status: "approved"`, `priority: "high"`
     - Reason / Impact summary
     - **[Approve & Update]** and **[Decline]** buttons
   - The user clicks **[Approve & Update]**: the app calls Firestore `setDoc/updateDoc`, verifies the write, updates local state, and the card transitions to a green "Applied" state with a timestamp.

### Visual Identity & Theme
- **Theme**: Dark enterprise palette consistent with Nexora (`bg-slate-950`, `bg-slate-900`, borders in `slate-800`).
- **Typography**: Clean sans (`Plus Jakarta Sans` / `Outfit`) for conversational text, paired with `font-mono tabular-nums` for all financial figures, currency amounts, and request IDs.
- **Anti-Slop Discipline**: No generic purple gradient blobs or floating badges. Clean slate surfaces, subtle 1px border dividers (`border-slate-800`), explicit unboxed metadata indicators, and compact action cards.
- **Message Bubbles**: Clean dark slate cards for assistant messages with Markdown formatting; discrete indigo-toned bubbles for user queries.

---

## 3. Key Product Decisions & Trade-Offs

- **Server-Side Gemini Execution (`/api/ai/copilot`)**:
  - *Chosen Approach*: The Express backend in `server.ts` initializes `@google/genai` using `process.env.GEMINI_API_KEY` with `User-Agent: 'aistudio-build'`. The browser communicates exclusively via `/api/ai/copilot`.
  - *Why*: Adheres strictly to security guidelines; ensures API keys are never exposed in browser bundles and enforces server-side system prompt integrity.
- **Two-Phase Action Authorization**:
  - *Chosen Approach*: The model returns structured tool call intentions (`propose_data_change`), but the server/client buffers the execution until the user manually triggers the Firestore write from the client UI.
  - *Why*: Eliminates accidental data corruption, meets the user's explicit requirement that changes occur *"only if user allow"*, and guarantees compliance with tenant security rules.
- **Session History Preservation**:
  - *Chosen Approach*: Multi-turn chat history preserved during the user's active session, with quick-clear and pre-built operational query prompts (e.g., "Analyze Pending Approvals", "Financial Health Check", "Incident Triage").

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        NEXORA CLIENT (index.html)                      │
│                                                                        │
│  ┌──────────────────────┐         ┌─────────────────────────────────┐  │
│  │ Global Header / Dock │ ──────> │  AI Business Copilot Drawer     │  │
│  └──────────────────────┘         │  - Multi-turn Message Stream    │  │
│                                   │  - Business Domain Guardrail    │  │
│                                   │  - Interactive Diff Cards       │  │
│                                   └──────────────┬──────────────────┘  │
│                                                  │                     │
│               User clicks [Approve]              │ POST /api/ai/copilot│
│                         │                        │ (Prompt + History   │
│                         ▼                        │  + Org Snapshot)    │
│           ┌───────────────────────────┐          │                     │
│           │ Firestore Client Library  │          ▼                     │
│           │ (updateInFirestore)       │   ┌─────────────────────────┐  │
│           └─────────────┬─────────────┘   │ Express Server Backend  │  │
│                         │                 │ (server.ts)             │  │
│                         ▼                 └────────────┬────────────┘  │
│           ┌───────────────────────────┐                │               │
│           │ Cloud Firestore Database  │                ▼               │
│           │ /organizations/{orgId}/   │   ┌─────────────────────────┐  │
│           │ requests, incidents, etc. │   │ Google GenAI SDK        │  │
│           └───────────────────────────┘   │ (gemini-3.8-flash)      │  │
│                                           └─────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State Handlers

1. **Chat Message State**:
   - `id`: Unique message ID
   - `role`: `'user' | 'assistant'`
   - `content`: Markdown text response
   - `timestamp`: Date/time
   - `proposedAction`: Optional structured change object:
     ```ts
     interface ProposedChange {
       actionId: string;
       collection: 'requests' | 'incidents' | 'workflows' | 'goals';
       documentId: string;
       description: string;
       changes: Record<string, any>;
       status: 'pending' | 'applied' | 'rejected';
     }
     ```

2. **Server-Side API Endpoint (`POST /api/ai/copilot`)**:
   - Accepts: `{ message: string, history: Array<{role: string, text: string}>, orgContext: object }`
   - Enforces strict System Instruction:
     - Role: Chief Operations & Financial Intelligence Officer of Nexora.
     - Strict Scope: Only discuss business, enterprise finance, revenue, operational bottlenecks, requests, incidents, and team workflows.
     - Rejection Rule: Strictly deflect questions outside business and finance.
     - Action Function Calling: When user intends to update or create records, emit a structured `propose_data_change` tool invocation.
   - Returns: `{ text: string, proposedActions?: ProposedChange[] }`

3. **Client-Side Authorization Flow**:
   - When `proposedActions` is received, the client renders the Diff Card.
   - Clicking **"Approve & Commit"** calls `updateInFirestore(collection, docId, changes)`.
   - On completion, local state and Firestore update synchronously, notifying the user with a confirmation toast.
