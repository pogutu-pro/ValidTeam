# AI model strategy

**Status:** design. Verified claims about current provider handling:
[`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) §6.

---

## 1. Principle

> **A model is a cost line item and a quality lever, not a product feature.**

Users do not care which model produced a summary. They care that the summary is
right, that it was fast, and that the workspace did not get an unexpected bill.
Every routing decision below is therefore made **server-side, from a declared
task class**, and is invisible to the user unless they are an admin configuring
models.

---

## 2. What exists

| Element        | Reality                                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers      | `agent_provider` = `native \| openai \| anthropic \| azure \| custom` (`packages/db/src/schema/agents.ts:39`)                                                                                                                    |
| Credentials    | `lib/agents/credentials.ts` — encrypted workspace/platform envelope with environment fallback; `resolveProviderApiKeyFromSettings(orgSettings, provider, platformStore)`; `getProviderCredentialStatusFromSettings`              |
| Model registry | `agent_model_configs` (unique `(organizationId, name)`, `isDefault`, `isArchived`) + `agent_model_config_revisions` — a real, versioned registry                                                                                 |
| Catalog        | `lib/agents/model-catalog.ts` + `model-configs.ts` — `applyWorkspaceModelConfig()` resolves a config id to `{provider, model}` and overrides inline values                                                                       |
| Readiness      | `getAgentProviderReadiness(provider, model, credentialStatus)` → `{ready, summary, reasonCode}`; blocks runs when a provider has no key (except `native`)                                                                        |
| Config issues  | `getWorkspaceAgentConfigIssues` → `workspace_disabled`, `project_disabled`, `writes_preview_only`, `write_approval_required`, each with `blocksRuns`                                                                             |
| Cost           | `estimateCostUsd` from a **static per-model price table** (`lib/ai/budget.ts:98`); `checkAndReserveTokens` / `commitUsage` / `refundReservation` / `runWithBudget` / `BudgetExhaustedError`                                      |
| Metering       | `llm_call_audit`, append-only via DB trigger, `promptHash` only, with `cachedTokens`, `latencyMs`, `status`, `feature`                                                                                                           |
| Kill switch    | `org_token_budgets.killSwitchEnabled`, plus a global `agent_control_center.globalEnabled` that fails closed and returns a **404-shaped** response                                                                                |
| Caching        | Anthropic ephemeral prompt blocks, ≤4 breakpoints (`lib/ai/cache-blocks.ts`) + cache-usage telemetry (`lib/ai/audit-hook.ts`) — **both called only by `providers.ts`**                                                           |
| BYOK           | First-class: `platform-ai-credentials.tsx`, per-workspace encrypted secrets                                                                                                                                                      |
| Dormant        | `lib/ai/batch.ts` (OpenAI Batch, zero importers, `llm_batch_jobs` has no writers), `lib/ai/observability/langfuse.ts` (**one** caller: `traceLlmCall` in `lib/ai/draft-issue.ts`; Ask, triage, and the agent graph are untraced) |

### The problem: there is no abstraction

There is **no `Provider` interface, no routing policy, and no shared resolution
module.** Three assistant routes each reimplement the same ladder:

```text
requested 'native'          → native, no key needed
requested openai|anthropic  → if a key is resolvable
workspace default           → if a key is resolvable
anthropic key present       → anthropic
openai key present          → openai
otherwise                   → native
```

…duplicated verbatim in `draft-issue`, `draft-issues`, and `issue-assist`. Then
`ask.ts`, `standup.ts`, `triage.ts`, `janitor.ts`, `catch-me-up.ts`, and
`providers.ts` each reach for a provider **differently**. `catch-me-up` even has
its own order (anthropic preferred, then openai) and **never fails closed** — if
AI is off or there is nothing to summarize it silently returns a deterministic
native digest with `200`.

Adding a new model class on top of six divergent resolution paths is how a
product acquires an unmaintainable cost problem.

---

## 3. Provider abstraction — centralize, do not rewrite

The brief asks whether ValidTeam can change providers without rewriting the app.
The answer is yes, but only after the existing resolution is consolidated, and
**without introducing an SDK-abstraction framework**.

### 3.1 One resolver

🔵 `lib/ai/providers/resolve.ts`:

```ts
type TaskClass =
  | 'classify'        // triage classification, routing, intent classification
  | 'extract'         // action items, entities, fields, label suggestions
  | 'summarize'       // issue, document, standup, catch-me-up
  | 'assist'          // rewrite, suggest_next, suggest_labels
  | 'plan'            // agent planning, decomposition, proposals
  | 'reason'          // analytics interpretation, risk analysis, why-delayed
  | 'synthesize'      // Ask final answer, status reports, readiness reports
  | 'embed';          // embeddings only

resolve({ taskClass, actor, scope, policy }) → {
  provider, model, credentialsRef, reason, cacheStrategy, maxOutputTokens
}
```

Precedence, in order, all of it **server-side**:

1. `system_settings.agent_control_center` — the global kill switch and
   `allowWriteActions`. A killed switch is a hard stop, not a fallback.
2. `organizations.settings.aiAgents.modelConfigId` — the workspace's chosen
   config, resolved through `agent_model_configs` + revisions.
3. `projects.settings.aiAgents` — project overrides.
4. `PRODUCT_FEATURE_FLAGS` and the workspace `assistantEnabled` toggle.
5. 🔵 The task-class policy (§4) picks a **model** inside the resolved provider.
6. 🔵 Fallback to another _configured_ provider if the first has no usable key —
   **but only when `policy.allowProviderFallback`**, and the fallback must be
   recorded in the audit so a provider swap is never invisible.
7. `native` (deterministic, no key) as the final floor, so a workspace with zero
   credentials degrades instead of erroring.

### 3.2 A thin provider interface, not a framework

```ts
interface AiProvider {
  id: 'native' | 'openai' | 'anthropic' | 'azure' | 'custom';
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream?(req: CompletionRequest): AsyncIterable<CompletionChunk>;
  embed?(input: string): Promise<number[]>;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    embeddings: boolean;
    promptCaching: boolean;
    batch: boolean;
  };
  estimateTokens(input: string): number;
}
```

Rules:

- **No agent framework, no message-queue abstraction, no vendor-neutral
  "tool-calling DSL".** The existing bounded graph in
  `lib/agents/graph-runtime.ts` is the agent runtime; the provider interface
  does not duplicate it.
- **One `complete`, one optional `stream`, one optional `embed`.** Anything a
  provider cannot do is a `capabilities` flag, and callers must branch on it.
- **Timeouts and deadlines are the graph's job**, not the provider's
  (`provider-deadline.ts`, `provider-endpoint.ts` already exist).
- 🔵 Any new provider is one file implementing this interface plus a credential
  resolver. Target: **no application code outside `lib/ai/providers/` changes**
  when a provider is added.

### 3.3 Provider selection is not tenant isolation

`getAgentProviderReadiness` and `native` as the floor are about capability. The
separate concern — a workspace must never be billed to another workspace's key,
and org A must never see org B's model configuration — is enforced by
`resolveProviderApiKeyFromSettings(orgSettings, provider, platformStore)`. 🔵 The
resolver must take the actor's organization and never a provider or key from
the caller.

---

## 4. Routing policy

### 4.1 Task classes → model tiers

Not every task needs the most expensive model. The mapping below is the default;
a workspace can override per task class through `agent_model_configs`.

| Task class   | Examples (real surfaces)                                                              | Tier                        | Notes                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classify`   | Triage priority/label proposal; intent routing; notification type mapping; SLA bucket | **Cheap / fast**            | Small structured output; often no chain at all. `deriveTriagePriority` (`planner.ts:29`) is already deterministic — a rule-based first pass should run before any model |
| `extract`    | Action items; issue fields; assignee candidates; label suggestions                    | **Cheap / fast**            | Constrained JSON schema                                                                                                                                                 |
| `summarize`  | Issue summary, `suggest_labels`, standup digest, catch-me-up, document summary        | **Standard**                | Deterministic standup fallback already exists — use it when the event summary is sufficient                                                                             |
| `assist`     | `rewrite`, `suggest_next`, `summarize`                                                | **Standard**                | Existing surfaces                                                                                                                                                       |
| `plan`       | Project-agent `plan` node; task decomposition; proposals                              | **Standard → reasoning**    | Depends on graph size and blast radius                                                                                                                                  |
| `reason`     | Analytics interpretation, project risk, "why was this delayed", goal step selection   | **Reasoning**               | Where the extra budget actually earns something                                                                                                                         |
| `synthesize` | Ask final answer, status report, readiness report, knowledge answers                  | **Standard → long-context** | Escalate to long-context when retrieval exceeds a threshold                                                                                                             |
| `embed`      | `content_embeddings`                                                                  | **Embedding**               | Fixed at 1536 dims today                                                                                                                                                |

### 4.2 Adaptive escalation, bounded

🔵 Two rules only, both auditable:

1. **Retrieve-then-decide.** Read tools first. Only ask a reasoning model when a
   cheap model's structured output is missing a required field or fails
   validation. Never escalate on a hunch.
2. **Context-size threshold.** If assembled context exceeds the standard model's
   window with headroom for output, route to a long-context model. Record the
   decision.

Hard rules: at most **one** escalation per run. Never escalate during a live
approval. Never escalate silently — the audit records which tier ran and why.

### 4.3 Do not route around a policy decision

⚠️ If a capability is APPROVE tier, a cheaper model does not make it low risk. If
a workspace has the safety mode at `strict`, model choice does not change the
injection scan. **Model tier is orthogonal to capability tier, approval, and
safety.** Conflating them is how a cost optimisation becomes a security
regression.

---

## 5. Cost controls

Already strong; extend rather than replace.

| Control                           | Exists                                                                                           | Delta                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token reservation before the call | ✅ `checkAndReserveTokens` with row locks                                                        | none                                                                                                                                                                                |
| True-up and refund after          | ✅ `commitUsage` / `refundReservation`                                                           | none                                                                                                                                                                                |
| Wrapper enforcing all of it       | ✅ `runWithBudget`                                                                               | none — **every** new AI path must use it                                                                                                                                            |
| Per-org budget + period           | ✅ `org_token_budgets`, unique per org, lazy UTC rollover                                        | none                                                                                                                                                                                |
| Exhaustion behaviour              | ✅ `BudgetExhaustedError` → `429`                                                                | 🔵 Goals must stop, not retry, and must notify the owner                                                                                                                            |
| Per-org kill switch               | ✅                                                                                               | 🔵 Add the "what was it doing" summary ([`AI_AUDIT.md`](AI_AUDIT.md) §5.3)                                                                                                          |
| Global kill switch                | ✅ fails closed, 404-shaped                                                                      | none — **preserve**                                                                                                                                                                 |
| Static price table                | ⚠️ `estimateCostUsd` is a hardcoded table (`budget.ts:98`) with no refresh mechanism and no test | 🔵 Source it from a checked-in price config validated by a test, or move budget enforcement to pre-consumption tokens and treat cost as reporting. A stale table silently mis-bills |
| Per-feature attribution           | ✅ `feature` on `llm_call_audit` (`draft_multi`, `assist:<action>`, `ask`, …)                    | 🔵 Add `runId` and `operationId`                                                                                                                                                    |
| Per-user limits                   | ⛔                                                                                               | 🔵 Only if abuse appears; org budgets come first                                                                                                                                    |

### Prompt caching

`cache-blocks.ts` implements Anthropic ephemeral caching with ≤4 breakpoints and
`audit-hook.ts` reports cache usage — both **only wired into `providers.ts`**.
🔵 Move breakpoint construction into the provider interface so every task class
benefits, and surface cache-hit ratio to admins. Cached tokens are already
recorded in `llm_call_audit.cachedTokens`, so the data exists; only the plumbing
and the report are missing.

### Batch

`lib/ai/batch.ts` and `llm_batch_jobs` are complete and unused, with six workload
kinds already declared (`embedding_backfill`, `weekly_summary`,
`stale_janitor`, `release_notes`, `triage_backfill`, `other`). Batch is only
worth wiring for genuinely deferred work — embedding backfill, stale janitor
sweeps, weekly summaries. **Do not batch anything an approval or a user is
waiting on.** Leaving this dormant is currently correct; the declared workloads
are a good backlog.

---

## 6. Embeddings and retrieval models

| Property         | Today                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider / model | OpenAI `text-embedding-3-small`                                                                                                                                     |
| Dimension        | **1536** (`content_embeddings.embedding vector(1536)`)                                                                                                              |
| Pipeline         | `content_embeddings_queue` → `pg_notify('content_embeddings_jobs')` → `/api/cron/embeddings`, with an MD5 content-hash short-circuit and a `version`-bumping UPSERT |
| Index            | HNSW (`0051`) + hybrid full-text/vector indexes (`0035`)                                                                                                            |
| Query            | `lib/search/hybrid.ts` — `websearch_to_tsquery('simple')` + `ts_rank_cd`, cosine `<=>`, fused with **RRF k=60**                                                     |
| Tuning           | `withEfSearch()` via `SET LOCAL hnsw.ef_search`, clamped 10–1000, default from `PGVECTOR_EF_SEARCH`                                                                 |
| Coverage         | **Issues and comments only.** `EmbedContentType` admits only `issue` and `comment`                                                                                  |
| Status           | The pgvector Ask leg is **intentionally dormant** (`STATUS.md:113–114`) — "until an organization-safe embedder is supplied"                                         |

Three consequences:

1. 🔵 **Widening `EmbedContentType` to `document_page` is the single
   highest-value retrieval change available** and it needs no new table, no new
   store, and no re-architecture. The wiki has revisions, trees, links, and
   shares; it is simply not indexed by meaning. Until it is, the Knowledge Agent
   must honestly say documents are keyword-searchable only.
2. 🔵 **"Organization-safe embedder" is an unresolved policy question.** Today
   issue and comment text is sent to a third-party embedding provider. That is a
   data-egress decision the control center must make explicit and per-workspace,
   not an implicit one. It belongs in
   [`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) §7 and in
   the admin's data-access view.
3. ⚠️ `lib/search/hybrid.ts:213` reads labels from the **legacy
   `issues.labels` JSON array**, not the `issue_labels` table migration `0054`
   created. The Jira-parity layer is half-adopted, so label-filtered search is
   reading a field that is no longer the source of truth. Fix or drop the array
   before the AI relies on label filters.
4. ⚠️ A stale comment in `lib/search/embeddings.ts:6` references migration
   `0028_hybrid_search.sql`; the file is `0035`. Harmless, but it is exactly the
   kind of drift that makes an audit unreliable.

---

## 7. Quality, evaluation, and lifecycle

### 7.1 There is no evaluation today

Nothing measures whether a model change made the product better or worse. The
closest signals are incidental: `issue_triage_suggestions` deliberately keeps
multiple suggestions per issue so model changes _can_ be compared, and
`llm_call_audit` records latency and status. Neither is an evaluation loop.

🔵 Minimum viable evaluation, in order of value per unit of effort:

| Signal                        | Where it comes from                                                                                                                 | Existing?                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Suggestion acceptance rate    | `issue_triage_suggestions.appliedAt` vs `dismissedAt` — a **natural labelled dataset** that already exists and is already collected | Data exists, no report                                  |
| Suggestion _correctness_      | Compare applied suggestions to what the field actually became after a human edited it                                               | 🔵 derivable from `agent_run_effects` before/after      |
| Answer usefulness             | Ask citation resolution rate, unresolved-marker rate, retry rate, `sources`-clicked rate                                            | 🔵 needs a client event; `usage` telemetry should exist |
| Assists reverted              | `estimateSource = 'ai_suggest'` then hand-edited; drafts edited before submit                                                       | 🔵 derivable                                            |
| Cost & latency per task class | `llm_call_audit` grouped by `feature`                                                                                               | Report exists for admins                                |
| Approval friction             | Approve/reject ratio, time-to-decision, edits-before-approval                                                                       | 🔵 needs `decisionReason` + timing                      |

⚠️ Do not build a framework. Build a query per signal and put the six numbers on
one admin page. If a model swap cannot be evaluated against these numbers, the
swap is not allowed.

### 7.2 Lifecycle

- **Deprecation must be handled.** Providers deprecate models. 🔵 The registry
  needs: `deprecatedAt`, `successorModelConfigId`, and a read-only fallback so
  existing workspaces keep working.
- **Archiving already exists.** `agent_model_configs.isArchived`, with a `409`
  when a config is still applied to a workspace. Preserve that.
- **Revision history already exists.** `agent_model_config_revisions`, unique
  `(configId, revision)`. Any model change should be auditable through it.
- 🔵 Pin a model for reproducibility: a run must record which model produced it,
  as a first-class column ([`AI_AUDIT.md`](AI_AUDIT.md) §3.1).
  Reconstructing the model from `run.output`, as `/api/ai/trace/[id]` does today,
  is not adequate.

---

## 8. BYOK and provider neutrality

BYOK is already a differentiator. Keep it first-class.

- Workspace-scoped encrypted secrets with environment fallback
  (`credentials.ts`); admin-managed platform credentials
  (`platform-ai-credentials.tsx`); readiness surfaced in the UI with a
  `reasonCode`.
- ⚠️ **Verified defect to fix:** `api/organizations/[orgId]/ai-agents/route.ts:49`
  validates `credential.provider: z.enum(['openai','anthropic'])`, but the write
  logic at `:321` and `:331` only handles `provider === 'openai'`. Posting an
  Anthropic credential **validates, writes nothing, and returns 200**. Silent
  credential loss. This belongs in Phase 1 — it is a five-line fix and a
  credential-integrity bug.
- 🔵 **Provider neutrality means the resolver, not a neutral API.** The 51-string
  permission model, the 49-key project matrix, `guardAgentAction`, the workflow
  transition service, the approval tables, and the budget guard are all
  provider-independent already. That is the property to preserve: **no provider
  SDK type may appear in a signature that crosses a domain boundary.**
- 🔵 `custom` provider is in the enum and `local://` endpoints already work for
  local Claude/Codex runners (`lib/agents/local-runner.ts`,
  `/api/admin/agent-control/local-runners`). That is the natural self-host /
  air-gapped path and it needs no new work.

---

## 9. Anti-patterns

| Anti-pattern                                       | Why                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exposing model choice to end users                 | Users pick a product, not a checkpoint. Model config belongs to admins                                                                                               |
| Adding a sixth divergent provider-resolution path  | The problem already exists three times                                                                                                                               |
| Using the most expensive model everywhere          | Cost scales linearly; quality on a summary does not                                                                                                                  |
| Introducing an agent framework                     | `graph-runtime.ts` already provides versioned topology, bounds, checkpoints, cancellation, and idempotent effects. A framework is duplication with more dependencies |
| A stale hardcoded price table                      | Silently mis-bills. Either validate it in CI or move enforcement to pre-consumption tokens                                                                           |
| Egress to a third-party embedder without saying so | Issue and comment text leaves the platform. That must be an explicit, per-workspace decision                                                                         |
| Batching anything a human is waiting on            | Batch has latency by definition                                                                                                                                      |
| Routing around an approval or safety decision      | Capability tier is orthogonal to model tier                                                                                                                          |
| Trusting a model name reconstructed from output    | A run must record its model as data                                                                                                                                  |

---

## 10. Acceptance criteria

- [ ] One `resolve()` replaces the three copy-pasted ladders and the six
      ad-hoc provider reaches.
- [ ] `catch-me-up` fails closed like every other path, or is documented as an
      intentional exception with a reason.
- [ ] Every AI path — old and new — goes through `runWithBudget`.
- [ ] Cost accounting is validated against a checked-in price source, or budget
      enforcement is based on tokens with cost as reporting only.
- [ ] Adding a provider touches only `lib/ai/providers/`.
- [ ] `EmbedContentType` includes documents, or the Knowledge Agent states the
      limitation.
- [ ] Third-party embedding egress is an explicit, visible, per-workspace
      decision.
- [ ] Label-filtered search reads `issue_labels`, not the legacy JSON array.
- [ ] Every run records provider and model as first-class columns.
- [ ] Six quality signals exist and are visible to admins, including
      triage-apply rate, which needs no new instrumentation.
- [ ] Model deprecation has a fallback path and a successor pointer.

Related: [`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) ·
[`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md) ·
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md)
