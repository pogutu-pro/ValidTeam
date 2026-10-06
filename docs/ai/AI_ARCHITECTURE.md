# AI architecture

**Status:** design, built on a verified audit of the existing system
([`AI_CURRENT_STATE.md`](AI_CURRENT_STATE.md) ·
[`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md)).

**Thesis in one line:**

> **The model thinks. ValidTeam provides context, permissions, tools, data, and
> execution.**

The model is never a principal. It is never a service with database
credentials. It never decides what it may reach. Every boundary in this
architecture exists to make that sentence true in code rather than in policy
documents.

---

## 1. Layer map

```text
                              USER
                                │
                                ▼
                     ┌─────────────────────┐
                     │   VALIDTEAM AI      │   one surface
                     │   GATEWAY           │   apps/web route handlers
                     └──────────┬──────────┘
                                │  ApiActor (server-derived)
                                ▼
                     ┌─────────────────────┐
                     │   ORCHESTRATOR      │   planning, routing,
                     │   / PLANNER         │   step tracking
                     └──────────┬──────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ CONTEXT       │      │ PERMISSION      │      │ TOOL ROUTER     │
│ ENGINE        │      │ ENGINE          │      │                 │
│               │      │                 │      │                 │
│ pgvector      │      │ global policy   │      │ registered      │
│ hybrid search │      │ org policy      │      │ catalogue only  │
│ recent        │      │ role            │      │ bound per step  │
│ activity      │      │ resource scope  │      │                 │
└───────┬───────┘      │ approval policy │      └────────┬────────┘
        │              └────────┬────────┘               │
        └───────────────────────┼────────────────────────┘
                                ▼
              ┌─────────────────────────────────────┐
              │     EXISTING VALIDTEAM SERVICES     │
              │  the same functions the routes call │
              └────────────────┬────────────────────┘
                               │
     ┌──────────────┬──────────┴─────────┬──────────────┐
     ▼              ▼                    ▼              ▼
 PostgreSQL      pgvector          Permissions      Workflow engine
 (source of      (semantic          (authorize)      (transitions,
  truth)          memory)                              locks, CAS)
     │              │                    │              │
     └──────────────┴────────────────────┴──────────────┘
                               │
                               ▼
                    AUDIT · RECEIPTS · EVENTS
```

**Every arrow crossing the model boundary is a validated, authorized, audited
operation.** The model sees text in, and text out. It never holds a credential.

---

## 2. The model boundary

This is the single most important section in the document.

### 2.1 What the model is given

| Given                 | How                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| A **system prompt**   | Static, built by ValidTeam. Not user-editable                                                       |
| A **user utterance**  | Treated as untrusted data, always wrapped                                                           |
| **Retrieved context** | From the context engine, each block labelled with source identity, retrieval time, and tenant scope |
| **A tool catalogue**  | Name, description, JSON schema, permission, risk, approval requirement — and nothing else           |
| **A bound**           | The maximum this step may do. Fixed before the model runs                                           |
| **Budget**            | Tokens, cost, steps, tool calls, wall time. Fixed before the model runs                             |

### 2.2 What the model never receives

| Never                          | Why                                                          |
| ------------------------------ | ------------------------------------------------------------ |
| Database credentials           | The model cannot run SQL itself. Ever                        |
| An API key for any provider    | The backend holds it; the model calls the backend            |
| A raw permission check         | It receives tool results, not the authorization system       |
| A tenant id it can choose      | The tenant comes from the `ApiActor`, resolved server-side   |
| Another tenant's data          | Scope is applied by the query layer, not by the prompt       |
| The tool implementations       | Schemas only, so it cannot infer a bypass                    |
| The system prompt's successors | 🔵 One system prompt per run, never appended to by the model |

⚠️ **The rule that follows from this table:**

> If the AI must not do something, that is enforced by a tool being absent from
> the catalogue or by the permission engine rejecting it. It is **never** enforced
> by prompt wording.

---

## 3. The gateway

`apps/web/src/app/api/**/route.ts` handlers, plus a new internal module boundary.
The gateway is responsible for exactly five things:

| #   | Responsibility                       | Reuse                                                                                        |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1   | Authenticate the caller              | `auth()`, `resolveApiActor` — ✅ exists                                                      |
| 2   | Resolve the tenant and scope         | `resolveApiActor`, `resolveOrganizationAccess`, `resolveProjectCapabilityAccess` — ✅ exists |
| 3   | Enforce the feature and policy gates | `/api/ai/capability` checks, `organizations.settings.aiAgents` — ✅ exists                   |
| 4   | Enter the orchestrator               | 🔵 new                                                                                       |
| 5   | Stream or return the result          | ✅ SSE exists on the agent runs                                                              |

🔵 The gateway is **not** a new service and **not** a new process. It is the
existing Next.js route layer with one new module behind it. See §11.

---

## 4. The orchestrator

Reuses `runBoundedGraph` (`apps/web/src/lib/agents/graph.ts`) unchanged. It is
already the correct execution substrate: declared routes, fails-closed on an
undeclared edge, leases, checkpoints, heartbeat, SSE resumption, and the bounds
in `AGENT_RUNTIME.md`.

### 4.1 Node graph

```text
        ┌──────────┐
  START │ resolve  │  load context, resolve actor, read policy
        └────┬─────┘
             ▼
        ┌──────────┐
        │  plan    │  model emits a typed plan (zod-validated)
        └────┬─────┘
             ▼
        ┌──────────┐
        │ gather   │  READ tools only; parallel where independent
        └────┬─────┘
             ▼
        ┌──────────┐
        │  reason  │  model reasons over gathered facts; may loop to gather
        └────┬─────┘
             ▼
        ┌──────────┐
        │ propose  │  render previews; compute tiers; no writes
        └────┬─────┘
             ▼
        ┌──────────┐
        │  gate    │  authorization + approval policy + budget
        └──┬────┬──┘
     allow  │    │  need approval
           ▼    └──────────┐
     ┌──────────┐          ▼
     │ execute  │   ┌────────────┐
     │ (effects)│   │  suspend   │ persist effects, notify, return
     └────┬─────┘   └────────────┘
          ▼
        ┌──────────┐
        │ reflect  │  receipts, summary, explanation, cost
        └────┬─────┘
             ▼
           END
```

### 4.2 Why not one big model call

Because every one of those nodes is a place where **ValidTeam, not the model,
makes a decision**. `resolve`, `gate`, and `execute` are deterministic code.
That is the design: the model is given the fewest possible responsibilities.

### 4.3 Multi-step safety

The spec requires that "if step 7 fails, it should not blindly repeat steps
1–6." The existing runtime already provides this:

| Mechanism                  | Where                                           | Effect                                     |
| -------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Checkpoints                | `agent_runs.checkpoint`, graph-versioned        | Resume from the failed step                |
| No-progress detection      | `maxConsecutiveNoProgress`                      | A looping plan aborts instead of repeating |
| Step bounds                | `maxSteps`, `maxVisitsPerNode`                  | Bounded traversal                          |
| Absolute deadline          | `provider-deadline.ts`, 120s from admission     | Wall-clock ceiling                         |
| Effects claimed atomically | `agent_run_effects` unique `(runId, effectKey)` | A committed effect never re-runs           |

🔵 Two additions required by the spec: **max tool calls** and **max LLM turns**
(`AGENT_RUNTIME.md:79–81` already mandates bounding them; nothing enforces it
today).

---

## 5. The provider abstraction

### 5.1 What exists today — and why DeepSeek cannot simply be added

Verified: there is **no provider abstraction**. Provider base URLs are
hardcoded string literals in **20 call sites across 14 files**:

```text
apps/web/src/lib/agents/{providers,ask,triage,standup,janitor}.ts
apps/web/src/lib/ai/{draft-issue,draft-issues-multi,issue-assist,catch-me-up,
                    batch,safety/sandbox}.ts
apps/web/src/lib/search/embeddings.ts
apps/web/src/app/api/analytics/insight/route.ts
apps/web/src/lib/onboarding/bootstrapper.ts
```

`agent_provider` is a `pgEnum` of `native | openai | anthropic | azure |
custom` (`packages/db/src/schema/agents.ts:39–45`), with 28 hardcoded catalog
entries in `lib/agents/model-catalog.ts` — GPT and Claude families only.

**Consequence:** adding DeepSeek the current way means a third hardcoded URL in
twelve more places, plus a migration, plus a catalog entry, plus a credential
slot that does not exist (§5.4). That is the wrong fix.

### 5.2 🔵 The target

```ts
interface AIProvider {
  readonly id: ProviderId;
  chat(req: ChatRequest, signal: AbortSignal): Promise<ChatResponse>;
  embed?(req: EmbedRequest): Promise<EmbedResponse>;
  capabilities(): ProviderCapabilities; // tools, json mode, reasoning, caching
  estimateCost(usage: TokenUsage): Money;
}
```

| Implementation                | Backing                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `DeepSeekProvider`            | `https://api.deepseek.com` — **OpenAI-compatible**, so it can share a transport              |
| `OpenAIProvider`              | `https://api.openai.com/v1`                                                                  |
| `AnthropicProvider`           | `https://api.anthropic.com/v1` — native Messages shape                                       |
| `AzureOpenAIProvider`         | Deployment-scoped base URL + `api-version`                                                   |
| 🔵 `OpenAICompatibleProvider` | Any provider exposing `/chat/completions`. **This is the "any model in the dashboard" path** |
| `NativeProvider`              | `validteam-planner-v1`, the deterministic planner — unchanged                                |

**One transport, many adapters.** Because DeepSeek, OpenAI, Azure, and most
third-party providers all speak the OpenAI chat-completions shape, the honest
implementation is a single `openaiCompatibleTransport` plus a small
Anthropic-specific transport. Not 6 SDKs.

### 5.3 One resolver, replacing six

```ts
resolveAIProvider(input: {
  organizationId: string
  role: AiRole                  // plan | classify | reason | generate | embed
  request: { requiresTools, requiresJson, budgetTier }
}): Promise<ResolvedProvider>   // { provider, model, apiKeyRef, baseUrl, limits }
```

Resolution order, all existing concepts:

1. **Workspace override** — `agent_model_configs` (✅ exists: per-org saved
   profiles with temperature, `maxOutputTokens`, `reasoningEffort`)
2. **Workspace default** — `organizations.settings.aiAgents.provider` + `.model`
3. **Platform default** — `systemSettings.value.aiDefaults` (🔵 new; super-admin
   picks the fleet default)
4. **Role-based routing** — 🔵 policy: which model serves which role
5. **Server env fallback** — `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / 🔵
   `DEEPSEEK_API_KEY` (✅ pattern exists)

🔵 **This deletes the copy-pasted ladders** in `providers.ts`, `draft-issue.ts`,
`issue-assist.ts`, and `catch-me-up.ts`.

### 5.4 🔵 Credential generalization — the blocker for "any model in the dashboard"

Verified defects, all on the path the requirement depends on:

| #   | Defect                                                                                                                                                                                      | Location                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `CredentialKey = 'openai' \| 'anthropic'` — the secret store holds **two** slots                                                                                                            | `lib/agents/credentials.ts:17`                                                                                |
| 2   | `CREDENTIAL_KEY_FOR_PROVIDER` omits `azure` and `custom`, so `resolveProviderApiKeyFromSettings` **returns `null` before reaching the env fallback** — `AZURE_OPENAI_API_KEY` is never read | `lib/agents/credentials.ts:32–34, 148–158`                                                                    |
| 3   | Status and resolver disagree: `getProviderCredentialStatusFromSettings` can report `configured: true` from env for `azure` while the resolver returns `null`                                | `lib/agents/credentials.ts:92–147` vs `148–158`                                                               |
| 4   | The org credential endpoint accepts `z.enum(['openai','anthropic'])` but its write branch handles **`openai` only** — selecting Anthropic returns 200 and stores nothing                    | `app/api/organizations/[organizationId]/ai-agents/route.ts:49, 317–334`                                       |
| 5   | `POST /api/admin/agent-control/credentials` **does not exist**. The super-admin credentials UI calls it                                                                                     | `components/admin/platform-ai-credentials.tsx:30, 40` vs `app/api/admin/agent-control/**` (no `credentials/`) |
| 6   | The dashboard renders a fixed provider list: `(['openai','anthropic'] as const).map(...)`                                                                                                   | `components/admin/platform-ai-credentials.tsx:12, 136`                                                        |

🔵 **Target:**

```ts
type ProviderCredential = {
  providerId: string; // 'openai' | 'anthropic' | 'deepseek' | 'custom:<label>'
  baseUrl: string | null; // required for openai-compatible
  envelope: SecretEnvelope; // ✅ existing AES-256-GCM shape, reused verbatim
};
```

| Change                              | Detail                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Store keyed by `providerId: string` | Drops the 2-value union                                                                    |
| Add `baseUrl` to the envelope       | 🔵 required for DeepSeek (`https://api.deepseek.com`) and every OpenAI-compatible endpoint |
| Fix #2/#3                           | Single resolution function, used by both status and resolver                               |
| Fix #4                              | Drive the write branch from the schema, not a hardcoded `openai` comparison                |
| Create #5                           | Implement the route the UI already calls                                                   |
| Fix #6                              | Render `provider_catalog`; 🔵 admin-entered "custom" providers get a generated row         |
| 🔵 Super-admin policy               | Which providers exist at all, and the max key an org may store                             |

🔵 **Note on `custom` today:** `AGENT_PROVIDER_DEFAULT_MODELS.custom = ''` and
`CREDENTIAL_KEY_FOR_PROVIDER` has no `custom` entry — so the `custom` provider is
**selectable but non-functional**. It is the natural home for DeepSeek and any
OpenAI-compatible key, and the requirement is precisely to make it work.

---

## 6. The context engine

🔵 New module. `lib/ai/context/`. Its job is to assemble the smallest correct
context — never the database.

```ts
buildAIContext({
  actor: ApiActor,            // server-derived
  utterance: string,          // untrusted
  intent: Intent,             // from classification
  scope: Scope,               // project / query / document / none
  budget: ContextBudget,      // max tokens, max chunks, max records
}) → { messages, citations, tools, bound, costEstimate }
```

### 6.1 Context blocks

| Block                 | Source                                                        | Bound                                                  |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Actor summary         | `ApiActor` — org, role, permissions, visible projects         | Never more than a summary. **Never** a permission dump |
| Current page / record | Route params + one `GET`                                      | 🔵 one record, fields the actor can read               |
| Structured facts      | Tool calls ([`AI_DATABASE_ACCESS.md`](AI_DATABASE_ACCESS.md)) | 🔵 row limit + selected columns                        |
| Semantic recall       | pgvector ([`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md))         | 🔵 chunk limit + similarity floor                      |
| Recent activity       | `issue_activities`, `issue_status_history`                    | 🔵 last N, actor-visible only                          |
| Conversation          | `agent_messages` ([`AI_MEMORY.md`](AI_MEMORY.md))             | 🔵 token-bounded window                                |
| Memory                | Preference / decision / project memory                        | 🔵 only rows the actor may read                        |
| Policy                | Resolved approval rules + bound                               | Small. **Deterministic, not model-generated**          |

### 6.2 The assembly rules

| Rule                                                              | Reason                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| 🔵 Every block is labelled with source, scope, and retrieval time | Citations become possible; injection becomes detectable |
| 🔵 Retrieved text enters inside `wrapUntrustedContent`            | `lib/ai/safety/sandbox.ts` already exists               |
| 🔵 Tenant filter applied in SQL, not in the prompt                | Non-negotiable                                          |
| 🔵 Hard token ceiling, checked **before** the model call          | Prevents a surprise bill                                |
| 🔵 Never the full permission set                                  | Leaks the security model and wastes tokens              |
| ⛔ Never raw secrets                                              | No block can contain one                                |
| ⛔ Never "here is the org, only use org X" instructions           | Scope is a SQL predicate                                |

---

## 7. The tool router

Three stages, all existing concepts plus one new module.

```text
1. REGISTER   lib/agents/tool-registry.ts — at boot, validated
              name · description · inputSchema · outputSchema
              permission · riskLevel · approval · reversible · idempotent
                    │
2. BOUND      per step: maxCalls · allowedNames · tenant · deadline · budget
              resolved BEFORE the model runs
                    │
3. DISPATCH   zod parse → resolve actor → authorize → preview-or-execute
                    │
              ├─ READ   → return minimized output
              ├─ WRITE  → receipt + audit
              └─ APPROVE → persist effect, suspend, notify
```

**The model cannot widen its own bound.** The bound is a property of the node,
not of the conversation. Full contract:
[`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md). Per-tool specification:
[`AI_TOOL_CATALOG.md`](AI_TOOL_CATALOG.md).

---

## 8. The permission engine

Composition, evaluated fresh on every invocation — never cached across a run,
so a revocation is immediate.

```text
  effectiveAiPermission(capability) =
      registry.requirement          // what the tool demands
    ∧ globalPolicy                  // super admin: provider/tool/autonomy envelope
    ∧ organizationPolicy            // org admin: capability + scope allowlists
    ∧ actorPermission               // existing hasPermission / capability access
    ∧ resourceScope                 // project/team membership
    ∧ approvalPolicy                // risk tier → approve / execute / deny
    ∧ budget                        // level 4 never auto-executes
```

🔵 `globalPolicy` and `organizationPolicy` are new; `actorPermission`,
`resourceScope`, `approvalPolicy`, and `budget` all exist. The composition order
is the design: **any `∧` term can only remove authority, never add it.**

Full model, including the role mapping to ValidTeam's real
`owner | admin | member | viewer | guest` + `team_role lead | member`:
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md).

---

## 9. Audit and observability

The chain the spec requires — request → model → tokens → tools → queries →
permission decisions → approvals → execution → result → cost — maps onto
**tables that already exist**:

| Stage                 | Existing store                                                      |
| --------------------- | ------------------------------------------------------------------- |
| Request / run         | `agent_runs`, `agent_run_steps`                                     |
| Model + tokens + cost | `llm_call_audit` (append-only trigger, hash-only prompt)            |
| Tool call             | 🔵 `agent_run_tool_calls`                                           |
| Permission decision   | `audit_logs` — `agent.policy.allow` / `.deny` / `.require_approval` |
| Approval              | `agent_approval_requests`, `agent_approval_effect_outbox`           |
| Execution             | `agent_run_effects` (effect key, atomic claim)                      |
| Cost                  | `llm_usage_stats`, `org_token_budgets`                              |
| Product activity      | `createAuditLog`                                                    |

🔵 One **deliberate omission:** `llm_call_audit` stores a `promptHash`, not the
prompt. That is correct and must not change — see [`AI_AUDIT.md`](AI_AUDIT.md).

---

## 10. Background execution

Spec §20: the browser must not have to stay open.

🔵 **No new queue broker, no new worker process.** ValidTeam already has the right
substrate:

| Need                    | Existing mechanism                                             |
| ----------------------- | -------------------------------------------------------------- |
| Durable work            | `agent_runs` + lease + heartbeat + `POST /api/cron/agent-runs` |
| Reconciliation          | The 7 `/api/cron/*` routes, externally scheduled               |
| Fan-out wakeup          | `pg_notify` + `LISTEN` — ✅ used by the embedding worker       |
| Transient coordination  | Redis (`getRedisClient`, nullable → in-process fallback)       |
| Progress to the browser | ✅ SSE with resumption from a persisted event position         |

**Autonomous and long work is the same machinery as approval execution**, which
is why approvals already survive a deploy. Extend it; do not replace it.

⚠️ The one real gap: **`agent_run_kind` has only four values**
(`project_tracking`, `backlog_triage`, `sprint_planning`, `bulk_sprint_creation`).
Long-running research, monitoring sweeps, and goal evaluation need kinds. That is
a `pgEnum` migration, and it is in Phase 2.

---

## 11. Why there is no AI microservice

Spec §31 asks explicitly. The evidence:

| Test                                                                           | Finding                                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the AI need its own protocol, its own port, its own connection lifecycle? | ⛔ No — it is HTTP in, SSE out                                                                                                                 |
| Does it need to scale independently of the app?                                | ⛔ Not yet — every tool call is a DB/service call **in the same process**                                                                      |
| Does it need secrets it must not share?                                        | ⛔ No — it needs the app's credentials to call its services                                                                                    |
| Does the repo already do this anywhere?                                        | ⛔ **No.** The only separate service is `services/hocuspocus`, and it exists because Yjs needs a persistent WebSocket process. That is the bar |
| Would a split make security better?                                            | ⛔ **Worse** — a network hop and a second credential to authorize                                                                              |

**Decision: the AI orchestration layer lives inside `apps/web`**, as a set of
modules under `apps/web/src/lib/ai/` and `apps/web/src/lib/agents/`. It runs in
the Next.js runtime and calls existing services in-process.

🔵 The extraction boundary is designed now so the decision is reversible:
`lib/ai/gateway.ts` is the only module that talks to a provider;
`lib/ai/context/`, `lib/ai/tools/`, `lib/ai/agents/` never import a provider
client. If a split is ever justified — independent scaling, GPU-local models,
a different release cadence — it happens behind that one module.

---

## 12. What the architecture deliberately is not

| Not                                  | Reason                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| A second application                 | Every tool calls an existing service. See `AGENT_RUNTIME.md`                                      |
| A model with a database connection   | It never sees SQL or a credential                                                                 |
| A prompt that remembers tenant rules | SQL does that                                                                                     |
| A new permission system              | Composes the existing one                                                                         |
| A new scheduler                      | `agent_runs` + cron already exist                                                                 |
| A new workflow engine                | `prepareIssueStatusTransition` is authoritative                                                   |
| Six vendor SDKs                      | One transport, adapters                                                                           |
| A fine-tuned model                   | Data stays in the platform; retrieval is current by construction ([`AI_MEMORY.md`](AI_MEMORY.md)) |

---

## 13. Document map

| Concern                         | Document                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| North star                      | [`AI_VISION.md`](AI_VISION.md)                                                                                                                                   |
| This architecture               | [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md)                                                                                                                       |
| What is true today              | [`AI_CURRENT_STATE.md`](AI_CURRENT_STATE.md) · [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md)                                                        |
| Agents and multi-step execution | [`AI_AGENT_SYSTEM.md`](AI_AGENT_SYSTEM.md)                                                                                                                       |
| Tools                           | [`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md) · [`AI_TOOL_CATALOG.md`](AI_TOOL_CATALOG.md)                                                                            |
| Structured data                 | [`AI_DATABASE_ACCESS.md`](AI_DATABASE_ACCESS.md)                                                                                                                 |
| Semantic memory                 | [`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md)                                                                                                                       |
| Authority                       | [`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) · [`AI_APPROVALS.md`](AI_APPROVALS.md)                                                                                  |
| Autonomy                        | [`AI_AUTONOMOUS_EXECUTION.md`](AI_AUTONOMOUS_EXECUTION.md) · [`AI_AUTOMATION.md`](AI_AUTOMATION.md) · [`AUTONOMOUS_WORKFLOWS.md`](AUTONOMOUS_WORKFLOWS.md)       |
| Memory                          | [`AI_MEMORY.md`](AI_MEMORY.md)                                                                                                                                   |
| Adversarial analysis            | [`AI_SECURITY.md`](AI_SECURITY.md)                                                                                                                               |
| Accountability                  | [`AI_AUDIT.md`](AI_AUDIT.md)                                                                                                                                     |
| Providers and cost              | [`AI_MODEL_STRATEGY.md`](AI_MODEL_STRATEGY.md) · [`AI_COST_CONTROL.md`](AI_COST_CONTROL.md)                                                                      |
| Interface                       | [`AI_UX.md`](AI_UX.md) · [`AI_UX_SIMPLIFICATION.md`](AI_UX_SIMPLIFICATION.md)                                                                                    |
| Inventory and sequencing        | [`AI_FEATURE_MATRIX.md`](AI_FEATURE_MATRIX.md) · [`AI_FEATURE_MATRIX.md`](AI_FEATURE_MATRIX.md) · [`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md) |

The runtime contract in [`../AGENT_RUNTIME.md`](../AGENT_RUNTIME.md) is binding
and this document must never contradict it.
